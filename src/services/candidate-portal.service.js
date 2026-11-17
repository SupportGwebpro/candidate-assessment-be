const crypto = require('crypto');
const fs = require('fs/promises');
const net = require('net');
const path = require('path');
const nodemailer = require('nodemailer');
const prisma = require('../lib/prisma');
const env = require('../config/env');
const { HttpError, badRequest, forbidden, notFound, conflict } = require('../utils/http');

const CODE_TTL_MS = 5 * 60 * 1000;
const CODE_RESEND_MS = 30 * 1000;
const CODE_MAX_ATTEMPTS = 5;
const CONTACT_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const FACE_WARNING_SECONDS = 5;

function smtpConfigurationStarted() {
  const { host, user, password, from } = env.smtp;
  return !!(host || user || password || from);
}

function smtpConfigurationComplete() {
  const { host, port, user, password, from } = env.smtp;
  return !!host && Number.isInteger(port) && port > 0 && port <= 65535 &&
    !!user && !!password && !!from;
}

function hashDevice(req) {
  const id = req.get('X-Candidate-Device');
  if (!id || !/^[a-zA-Z0-9_-]{20,128}$/.test(id)) {
    throw badRequest('A valid browser device identifier is required. Reload the candidate page and try again.');
  }
  return crypto.createHmac('sha256', env.jwtSecret).update(id).digest('hex');
}

function codeDigest(candidateId, method, contact, sentAt, code) {
  return crypto.createHmac('sha256', env.jwtSecret)
    .update(`${candidateId}:${method}:${contact}:${sentAt}:${code}`)
    .digest('hex');
}

function safeEqualHex(a, b) {
  return /^[a-f0-9]{64}$/i.test(a) && /^[a-f0-9]{64}$/i.test(b) &&
    crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function normalizeContact(method, contact) {
  if (method === 'email') {
    const value = contact.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw badRequest('Enter a valid email address.');
    return value;
  }
  const value = contact.replace(/[\s().-]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(value)) {
    throw badRequest('Enter a phone number with its international country code.');
  }
  return value;
}

function expectedContact(candidate, method) {
  return method === 'email' ? candidate.email.trim().toLowerCase() : candidate.phone ? normalizeContact('phone', candidate.phone) : null;
}

function deviceType(userAgent = '') {
  if (/ipad|tablet|android(?!.*mobile)/i.test(userAgent)) return 'tablet';
  return /mobile|iphone|ipod/i.test(userAgent) ? 'mobile' : 'desktop';
}

function isPublicIp(value) {
  const ip = String(value || '').replace(/^::ffff:/, '');
  const version = net.isIP(ip);
  if (!version) return false;
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  return !/^(::|fc|fd|fe[89ab])/i.test(ip);
}

async function lookupLocation(ip) {
  if (!isPublicIp(ip)) return { city: null, region: null };
  try {
    // ip-api.com's free endpoint is HTTP-only and restricted to non-commercial use.
    const response = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,city,regionName`,
      {
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!response.ok) {
      console.warn(`[candidate location lookup] ip-api.com returned HTTP ${response.status}`);
      return { city: null, region: null };
    }
    const data = await response.json();
    if (data.status !== 'success') {
      console.warn(`[candidate location lookup] ip-api.com lookup failed: ${data.message || data.status || 'unknown error'}`);
      return { city: null, region: null };
    }
    return {
      city: typeof data.city === 'string' ? data.city : null,
      region: typeof data.regionName === 'string' ? data.regionName : null,
    };
  } catch (error) {
    console.warn('[candidate location lookup] ip-api.com request failed', {
      code: error.cause?.code || error.name || 'UNKNOWN',
    });
    return { city: null, region: null };
  }
}

async function findCandidate(token, includeAttempt = true) {
  const candidate = await prisma.candidate.findUnique({
    where: { accessToken: token },
    include: {
      assessment: {
        include: {
          sections: { orderBy: { order: 'asc' } },
          readingTask: true,
          speakingTask: true,
        },
      },
      questions: { orderBy: [{ order: 'asc' }, { id: 'asc' }] },
      contactVerification: true,
      ...(includeAttempt ? { attempt: { include: { answers: true, progress: true, recordings: true } } } : {}),
    },
  });
  if (!candidate) throw notFound('This candidate invitation could not be found.');
  return candidate;
}

function invitationState(candidate, now = new Date()) {
  if (candidate.status === 'CANCELLED' || candidate.attempt?.state === 'CANCELLED') return 'cancelled';
  if (candidate.status === 'COMPLETED' || candidate.attempt?.state === 'SUBMITTED') return 'completed';
  const assessment = candidate.assessment;
  if (assessment.status === 'DRAFT') return 'revoked';
  if (assessment.opensAt && assessment.opensAt > now) return 'not_yet_open';
  if (assessment.closesAt && assessment.closesAt <= now) return 'expired';
  if (candidate.attempt?.state === 'IN_PROGRESS' || candidate.attempt?.state === 'DRAFT') return 'in_progress';
  return 'active';
}

function assertInvitationAvailable(candidate, now = new Date()) {
  const state = invitationState(candidate, now);
  if (state === 'not_yet_open') throw forbidden('This assessment is not open yet.');
  if (state === 'expired') throw forbidden('This invitation has expired.');
  if (state === 'revoked') throw forbidden('This invitation is unavailable.');
  if (state === 'completed' || state === 'cancelled') throw conflict('This assessment has already ended.');
}

function contactStatus(candidate, deviceHashValue, now = new Date()) {
  const v = candidate.contactVerification;
  const valid = !!v && !!v.verifiedAt && v.deviceHash === deviceHashValue &&
    now.getTime() - v.verifiedAt.getTime() < CONTACT_VERIFICATION_TTL_MS &&
    v.contact === expectedContact(candidate, v.method.toLowerCase());
  return {
    verified: valid,
    method: valid ? v.method.toLowerCase() : null,
    verifiedContact: valid ? v.contact : null,
    deliveryConfigured: !!env.contactCodeDeliveryUrl || smtpConfigurationComplete() ||
      env.nodeEnv !== 'production',
    phoneAvailable: !!candidate.phone,
  };
}

function requireContactVerified(candidate, hash, now = new Date()) {
  if (!contactStatus(candidate, hash, now).verified) {
    throw forbidden('Verify your invited email address or HR-registered phone on this browser before continuing.');
  }
}

function allowedValues(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
}

async function securityResult(candidate, req, consent) {
  if (!consent) throw forbidden('Consent to the approximate IP location lookup is required.');
  const hash = hashDevice(req);
  const type = deviceType(req.get('User-Agent'));
  //convert to uppercase for comparison with allowedDeviceTypes, which are stored in uppercase
  const normalizedType = type ? type.toUpperCase() : null;

  const allowedDevices = allowedValues(candidate.assessment.allowedDeviceTypes);
  const deviceAllowed = allowedDevices.length === 0 || allowedDevices.includes(normalizedType);
  const cities = allowedValues(candidate.assessment.cities);
  const regions = allowedValues(candidate.assessment.regions);
  const hasLocationRule = cities.length > 0 || regions.length > 0;
  const location = hasLocationRule ? await lookupLocation(req.ip) : { city: null, region: null };
  const normalize = (s) => s.normalize('NFKC').trim().toLocaleLowerCase('en');
  const locationAllowed = !hasLocationRule ||
    (!!location.city && cities.some((x) => normalize(x) === normalize(location.city))) ||
    (!!location.region && regions.some((x) => normalize(x) === normalize(location.region)));
  const existingHash = candidate.attempt?.deviceHash;
  const singleDeviceAllowed = !existingHash || existingHash === hash;
  const allowed = deviceAllowed && locationAllowed && singleDeviceAllowed;
  const message = !deviceAllowed ? 'This device type is not permitted for the assessment.' :
    !singleDeviceAllowed ? 'This assessment is bound to another browser/device.' :
    !locationAllowed ? location.city || location.region
      ? 'Your approximate location is not on the approved list.'
      : 'Your location could not be verified; access is blocked because this assessment has a location restriction.'
    : 'Device and location checks passed. IP-based location is approximate.';
  return {
    allowed,
    deviceType: type,
    deviceAllowed,
    singleDeviceAllowed,
    locationAllowed,
    city: location.city,
    region: location.region,
    message,
    deviceHash: hash,
  };
}

function questionPayload(question, progress, answer, now) {
  const options = Array.isArray(question.options) ? question.options : [];
  const deadlineAt = progress && question.estimatedTimeSeconds
    ? new Date(progress.startedAt.getTime() + question.estimatedTimeSeconds * 1000)
    : null;
  const expired = !!deadlineAt && deadlineAt <= now;
  return {
    id: question.id,
    sectionName: question.sectionName,
    type: question.type === 'MCQ' ? 'mcq' : 'written',
    prompt: question.prompt,
    options,
    estimatedTimeSeconds: question.estimatedTimeSeconds,
    startedAt: progress?.startedAt ?? null,
    deadlineAt,
    status: progress?.lockedAt || expired ? 'locked' : progress ? 'active' : 'pending',
    answer: answer?.answer ?? '',
  };
}

function attemptPayload(candidate, now = new Date()) {
  const attempt = candidate.attempt;
  if (!attempt) return null;
  const progressByQuestion = new Map(attempt.progress.map((p) => [p.candidateQuestionId, p]));
  const answersByQuestion = new Map(attempt.answers.map((a) => [a.candidateQuestionId, a]));
  const questions = candidate.questions.map((q) =>
    questionPayload(q, progressByQuestion.get(q.id), answersByQuestion.get(q.id), now));
  const active = questions.find((q) => q.id === attempt.activeQuestionId) ?? null;
  return {
    id: attempt.id,
    status: attempt.state.toLowerCase(),
    roleTitle: candidate.assessment.role,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    remainingSeconds: Math.max(0, Math.ceil((attempt.deadlineAt.getTime() - now.getTime()) / 1000)),
    currentQuestionId: attempt.activeQuestionId,
    activeQuestion: active,
    questions,
    responses: attempt.answers.map((a) => ({ questionId: a.candidateQuestionId, answer: a.answer, savedAt: a.savedAt })),
    answeredCount: attempt.answers.filter((a) => a.answer.trim()).length,
    questionCount: candidate.questions.length,
    faceState: attempt.faceState,
    phase: attempt.phase.toLowerCase(),
    allowDraftResume: candidate.assessment.saveAndResume,
    finalTasks: {
      reading: {
        status: attempt.readingStatus.toLowerCase(),
        deadlineAt: attempt.phase === 'READING' ? attempt.taskDeadlineAt : null,
        recording: attempt.recordings.find((r) => r.kind === 'READING')
          ? {
            durationSeconds: attempt.recordings.find((r) => r.kind === 'READING').durationSeconds,
            contentType: attempt.recordings.find((r) => r.kind === 'READING').contentType,
          }
          : null,
      },
      speaking: {
        status: attempt.speakingStatus.toLowerCase(),
        deadlineAt: attempt.phase === 'SPEAKING' ? attempt.taskDeadlineAt : null,
        recording: attempt.recordings.find((r) => r.kind === 'SPEAKING')
          ? {
            durationSeconds: attempt.recordings.find((r) => r.kind === 'SPEAKING').durationSeconds,
            contentType: attempt.recordings.find((r) => r.kind === 'SPEAKING').contentType,
          }
          : null,
      },
    },
    submittedAt: attempt.submittedAt,
  };
}

function scoreAttempt(candidate) {
  const attempt = candidate.attempt;
  const answers = new Map(attempt.answers.map((a) => [a.candidateQuestionId, a.answer]));
  const questions = candidate.questions;
  if (questions.some((q) => q.type !== 'MCQ') || candidate.readingTaskSnapshot || candidate.speakingTaskSnapshot) {
    return { score: null, evaluationStatus: 'manual_review' };
  }
  const max = questions.reduce((sum, q) => sum + (q.marks ?? 1), 0);
  if (!max) return { score: null, evaluationStatus: 'manual_review' };
  const earned = questions.reduce((sum, q) => {
    const options = Array.isArray(q.options) ? q.options : [];
    const correctAnswer = q.correctOption == null ? null : options[q.correctOption];
    return sum + (correctAnswer != null && answers.get(q.id) === String(correctAnswer) ? (q.marks ?? 1) : 0);
  }, 0);
  return { score: Math.round((earned / max) * 1000) / 10, evaluationStatus: 'evaluated' };
}

function receiptPayload(candidate) {
  const attempt = candidate.attempt;
  if (!attempt || !['SUBMITTED', 'CANCELLED'].includes(attempt.state)) {
    throw conflict('This assessment has not been submitted.');
  }
  const cancelled = attempt.state === 'CANCELLED';
  return {
    referenceId: `CA-${candidate.id}-${attempt.id}`,
    submittedAt: attempt.submittedAt,
    message: cancelled
      ? 'The assessment was cancelled after a tab switch. No overall score was produced.'
      : attempt.evaluationStatus === 'manual_review'
        ? 'Submission received. A person will review any written answers and recorded tasks.'
        : 'Submission received and evaluated.',
    score: cancelled ? null : attempt.score,
    evaluationStatus: cancelled ? 'cancelled' : attempt.evaluationStatus,
    cancelled,
    submissionMode: attempt.submissionReason === 'timer_expired' ? 'automatic' : 'manual',
  };
}

async function getInvitation(token, req) {
  const candidate = await findCandidate(token);
  const now = new Date();
  const hash = hashDevice(req);
  const bySection = new Map();
  for (const q of candidate.questions) bySection.set(q.sectionName, (bySection.get(q.sectionName) || 0) + 1);
  const sections = [...bySection].map(([name, questionCount]) => ({ name, questionCount }));
  return {
    state: invitationState(candidate, now),
    candidateName: candidate.name,
    candidateEmail: candidate.email,
    roleTitle: candidate.assessment.role,
    durationSeconds: candidate.timerApprovedSeconds ?? (candidate.assessment.durationMinutes || 0) * 60,
    startAt: candidate.assessment.opensAt,
    endAt: candidate.assessment.closesAt,
    sections,
    allowDraftResume: candidate.assessment.saveAndResume,
    allowedDeviceTypes: allowedValues(candidate.assessment.allowedDeviceTypes),
    approvedCities: allowedValues(candidate.assessment.cities),
    approvedRegions: allowedValues(candidate.assessment.regions),
    allowSectionSwitching: candidate.assessment.allowSectionSwitching,
    questionCount: candidate.questions.length,
    contactVerification: contactStatus(candidate, hash, now),
    attempt: invitationState(candidate, now) === 'in_progress' ? attemptPayload(candidate, now) : null,
    message: invitationState(candidate, now) === 'active'
      ? 'Review the instructions, complete the checks, and start when ready.'
      : invitationState(candidate, now) === 'in_progress'
        ? 'Your assessment is in progress. Resume it using this invitation link.'
        : 'This invitation is not currently available.',
  };
}

async function deliverCode(method, contact, code, expiresAt) {
  if (env.contactCodeDeliveryUrl) {
    let deliveryUrl;
    try {
      deliveryUrl = new URL(env.contactCodeDeliveryUrl);
    } catch {
      throw new HttpError(503, 'Contact code delivery is not configured correctly.', 'DELIVERY_UNAVAILABLE');
    }
    if ((env.nodeEnv === 'production' && deliveryUrl.protocol !== 'https:') ||
        (env.nodeEnv === 'production' && !env.contactCodeDeliveryToken)) {
      throw new HttpError(503, 'Production contact delivery requires HTTPS and an authorization token.', 'DELIVERY_UNAVAILABLE');
    }
    let response;
    try {
      response = await fetch(deliveryUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.contactCodeDeliveryToken ? { Authorization: `Bearer ${env.contactCodeDeliveryToken}` } : {}),
        },
        body: JSON.stringify({ channel: method, to: contact, code, expiresAt }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      throw new HttpError(503, `Contact code delivery failed: ${error.message}`, 'DELIVERY_FAILED');
    }
    if (!response.ok) throw new HttpError(503, 'Contact code delivery provider rejected the request.', 'DELIVERY_FAILED');
    return true;
  }

  if (smtpConfigurationStarted()) {
    if (!smtpConfigurationComplete()) {
      throw new HttpError(503, 'SMTP contact-code delivery is partially configured.', 'DELIVERY_UNAVAILABLE');
    }
    if (method !== 'email') {
      throw new HttpError(503, 'SMTP can deliver email codes only. Configure the contact delivery relay for phone codes.', 'DELIVERY_UNAVAILABLE');
    }

    const transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: { user: env.smtp.user, pass: env.smtp.password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
    try {
      await transporter.sendMail({
        from: env.smtp.from,
        to: contact,
        subject: 'Your candidate assessment verification code',
        text: `Your candidate assessment verification code is ${code}. It expires at ${expiresAt}. If you did not request this code, you can ignore this email.`,
      });
    } catch (error) {
      console.error('[contact-code SMTP delivery failed]', {
        code: error.code || 'UNKNOWN',
        responseCode: Number.isInteger(error.responseCode) ? error.responseCode : undefined,
      });
      throw new HttpError(503, 'Email verification could not be delivered. Check SMTP settings and try again.', 'DELIVERY_FAILED');
    } finally {
      transporter.close();
    }
    return true;
  }

  if (env.nodeEnv === 'production') {
    throw new HttpError(503, 'Contact code delivery is not configured. Contact HR for assistance.', 'DELIVERY_UNAVAILABLE');
  }
  return false;
}

async function sendContactCode(token, input, req) {
  const candidate = await findCandidate(token, false);
  assertInvitationAvailable(candidate);
  if (candidate.status !== 'INVITED') throw conflict('Contact verification is only available before an attempt starts.');
  const method = input.method.toUpperCase();
  const contact = normalizeContact(input.method, input.contact);
  if (contact !== expectedContact(candidate, input.method)) {
    throw forbidden('Use the email or phone number registered by HR for this invitation.');
  }
  if (candidate.attempt) throw conflict('Contact verification cannot be changed after the assessment starts.');
  const browserHash = hashDevice(req);
  const existing = await prisma.candidateContactVerification.findUnique({ where: { candidateId: candidate.id } });
  const now = new Date();
  if (existing && now.getTime() - existing.sentAt.getTime() < CODE_RESEND_MS) {
    throw new HttpError(429, 'Wait 30 seconds before requesting another verification code.', 'RATE_LIMITED');
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  const delivered = await deliverCode(input.method, contact, code, expiresAt.toISOString());
  const data = {
    method,
    contact,
    codeHash: codeDigest(candidate.id, method, contact, now.toISOString(), code),
    deviceHash: browserHash,
    sentAt: now,
    expiresAt,
    attempts: 0,
    verifiedAt: null,
  };
  await prisma.candidateContactVerification.upsert({
    where: { candidateId: candidate.id },
    create: { candidateId: candidate.id, ...data },
    update: data,
  });
  return {
    method: input.method,
    maskedTarget: input.method === 'email'
      ? `${contact[0]}***@${contact.split('@')[1]}`
      : `+******${contact.slice(-4)}`,
    expiresAt,
    retryAfterSeconds: Math.ceil(CODE_RESEND_MS / 1000),
    ...(delivered ? {} : { developmentCode: code }),
  };
}

async function verifyContactCode(token, input, req) {
  const candidate = await findCandidate(token, false);
  assertInvitationAvailable(candidate);
  if (candidate.status !== 'INVITED') throw conflict('Contact verification is only available before an attempt starts.');
  const method = input.method.toUpperCase();
  const contact = normalizeContact(input.method, input.contact);
  if (contact !== expectedContact(candidate, input.method)) {
    throw forbidden('Use the email or phone number registered by HR for this invitation.');
  }
  const browserHash = hashDevice(req);
  const verification = await prisma.candidateContactVerification.findUnique({ where: { candidateId: candidate.id } });
  if (!verification || verification.method !== method || verification.contact !== contact ||
      verification.deviceHash !== browserHash) {
    throw forbidden('Request a verification code for this contact on this browser first.');
  }
  if (verification.verifiedAt) return { verified: true, method: input.method, verifiedContact: contact };
  if (verification.expiresAt <= new Date()) throw badRequest('This verification code expired. Request a new one.');
  if (verification.attempts >= CODE_MAX_ATTEMPTS) {
    throw forbidden('Too many incorrect verification attempts. Request a new code.');
  }
  const expected = codeDigest(candidate.id, method, contact, verification.sentAt.toISOString(), input.code);
  if (!safeEqualHex(expected, verification.codeHash)) {
    await prisma.candidateContactVerification.update({
      where: { candidateId: candidate.id },
      data: { attempts: { increment: 1 } },
    });
    throw badRequest('That verification code was not accepted.');
  }
  await prisma.candidateContactVerification.update({
    where: { candidateId: candidate.id },
    data: { verifiedAt: new Date(), codeHash: '' },
  });
  return { verified: true, method: input.method, verifiedContact: contact };
}

async function checkSecurity(token, req) {
  const candidate = await findCandidate(token);
  assertInvitationAvailable(candidate);
  const result = await securityResult(candidate, req, req.body.consent === true);
  const { deviceHash: _deviceHash, ...publicResult } = result;
  return publicResult;
}

function assertCandidateIdentity(candidate, input) {
  if (input.name.trim().toLocaleLowerCase('en') !== candidate.name.trim().toLocaleLowerCase('en')) {
    throw forbidden('The name does not match this invitation. Contact HR if it is incorrect.');
  }
  if (input.email.trim().toLowerCase() !== candidate.email.trim().toLowerCase()) {
    throw forbidden('The email does not match this invitation. Use the email address HR registered.');
  }
}

function addSeconds(date, seconds, cap) {
  const result = new Date(date.getTime() + seconds * 1000);
  return cap && result > cap ? cap : result;
}

async function startAttempt(token, input, req) {
  const candidate = await findCandidate(token);
  const now = new Date();
  assertInvitationAvailable(candidate, now);
  assertCandidateIdentity(candidate, input);
  if (!candidate.questionsApproved || !candidate.timerApproved) {
    throw conflict('This invitation is not ready. Contact HR.');
  }
  if (!candidate.questions.length) throw conflict('This assessment has no questions.');
  const hash = hashDevice(req);
  requireContactVerified(candidate, hash, now);
  const security = await securityResult(candidate, req, input.privacyConsent);
  if (!security.allowed) throw forbidden(security.message);
  const durationSeconds = candidate.timerApprovedSeconds ?? (candidate.assessment.durationMinutes || 0) * 60;
  if (!durationSeconds) throw conflict('No approved assessment duration is configured.');

  if (candidate.attempt?.state === 'IN_PROGRESS') return attemptPayload(candidate, now);
  if (candidate.attempt?.state === 'DRAFT') {
    await prisma.$transaction(async (tx) => {
      const current = await lockAttempt(tx, candidate.attempt.id);
      if (!current) throw conflict('This assessment attempt could not be resumed.');
      if (current.state !== 'DRAFT') return;
      const pauseSeconds = Math.max(0, Math.floor((now.getTime() - current.draftedAt.getTime()) / 1000));
      const deadlineAt = addSeconds(current.deadlineAt, pauseSeconds, candidate.assessment.closesAt);
      const progress = await tx.candidateQuestionProgress.findMany({
        where: { attemptId: current.id, lockedAt: null },
        select: { id: true, startedAt: true },
      });
      for (const item of progress) {
        await tx.candidateQuestionProgress.update({
          where: { id: item.id },
          data: { startedAt: new Date(item.startedAt.getTime() + pauseSeconds * 1000) },
        });
      }
      await tx.candidateAttempt.update({
        where: { id: current.id },
        data: {
          state: 'IN_PROGRESS',
          deadlineAt,
          taskDeadlineAt: current.taskDeadlineAt
            ? addSeconds(current.taskDeadlineAt, pauseSeconds, candidate.assessment.closesAt)
            : null,
          draftedAt: null,
          deviceHash: hash,
          securityCheck: {
          deviceType: security.deviceType, city: security.city, region: security.region,
          },
        },
      });
      await tx.candidate.update({ where: { id: candidate.id }, data: { status: 'IN_PROGRESS' } });
    });
    return attemptPayload(await findCandidate(token), now);
  }
  if (candidate.attempt) throw conflict('This assessment attempt has already ended.');

  const deadlineAt = addSeconds(now, durationSeconds, candidate.assessment.closesAt);
  const firstQuestion = candidate.questions[0];
  try {
    await prisma.$transaction(async (tx) => {
      const attempt = await tx.candidateAttempt.create({
        data: {
          candidateId: candidate.id,
          state: 'IN_PROGRESS',
          startedAt: now,
          deadlineAt,
          activeQuestionId: firstQuestion.id,
          privacyConsentAt: now,
          recordingConsentAt: now,
          deviceHash: hash,
          securityCheck: { deviceType: security.deviceType, city: security.city, region: security.region },
        },
      });
      await tx.candidateQuestionProgress.create({
        data: { attemptId: attempt.id, candidateQuestionId: firstQuestion.id, startedAt: now },
      });
      await tx.candidate.update({ where: { id: candidate.id }, data: { status: 'IN_PROGRESS' } });
    });
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    const latest = await findCandidate(token);
    if (latest.attempt?.state === 'IN_PROGRESS') return attemptPayload(latest, now);
    throw conflict('The assessment attempt could not be started.');
  }
  return attemptPayload(await findCandidate(token), now);
}

async function getActiveCandidate(token, req) {
  const candidate = await findCandidate(token);
  const hash = hashDevice(req);
  if (!candidate.attempt || candidate.attempt.deviceHash !== hash) {
    throw forbidden('This assessment can only be opened in the verified browser used to start it.');
  }
  if (candidate.attempt.state !== 'IN_PROGRESS') throw conflict('This assessment attempt is no longer active.');
  return candidate;
}

async function lockAttempt(tx, attemptId) {
  await tx.$executeRaw`UPDATE \`candidate_attempts\` SET \`id\` = \`id\` WHERE \`id\` = ${attemptId}`;
  return tx.candidateAttempt.findUnique({
    where: { id: attemptId },
    include: { answers: true, progress: true, recordings: true },
  });
}

async function finalizeAttempt(candidate, reason, cancelled = false) {
  if (!candidate.attempt) throw conflict('This assessment has not started.');
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const current = await lockAttempt(tx, candidate.attempt.id);
    if (!current || current.state !== 'IN_PROGRESS') return;
    await tx.candidateAttempt.update({
      where: { id: current.id },
      data: {
        state: cancelled ? 'CANCELLED' : 'SUBMITTED',
        submittedAt: now,
        submissionReason: reason,
        cancellationReason: cancelled ? 'tab_switch' : null,
        score: null,
        evaluationStatus: cancelled ? 'cancelled' : 'pending',
      },
    });
    await tx.candidate.update({
      where: { id: candidate.id },
      data: { status: cancelled ? 'CANCELLED' : 'COMPLETED' },
    });
    if (!cancelled) {
      const currentCandidate = await tx.candidate.findUnique({
        where: { id: candidate.id },
        include: { questions: true, attempt: { include: { answers: true } } },
      });
      const evaluation = scoreAttempt(currentCandidate);
      await tx.candidateAttempt.update({
        where: { id: current.id },
        data: evaluation,
      });
    }
  });
  return receiptPayload(await findCandidate(candidate.accessToken));
}

async function saveAnswer(token, questionId, answer, req) {
  const candidate = await getActiveCandidate(token, req);
  const attempt = candidate.attempt;
  const now = new Date();
  const question = candidate.questions.find((q) => q.id === questionId);
  if (!question) throw notFound('Question not found for this invitation.');
  if (question.type === 'MCQ') {
    const options = Array.isArray(question.options) ? question.options : [];
    if (!options.some((option) => String(option) === answer)) {
      throw badRequest('Choose one of the listed answer options.');
    }
  }
  let result = 'saved';
  await prisma.$transaction(async (tx) => {
    const current = await lockAttempt(tx, attempt.id);
    if (!current || current.state !== 'IN_PROGRESS') throw conflict('This assessment attempt is no longer active.');
    if (current.deadlineAt <= now) { result = 'attempt-expired'; return; }
    if (current.faceState !== 'present') throw conflict('Answering is paused until face presence is restored.');
    if (current.activeQuestionId !== questionId) throw conflict('Open this question before saving an answer.');
    const progress = current.progress.find((p) => p.candidateQuestionId === questionId);
    if (!progress || progress.lockedAt) throw conflict('This question is locked.');
    if (question.estimatedTimeSeconds &&
        now.getTime() >= progress.startedAt.getTime() + question.estimatedTimeSeconds * 1000) {
      await tx.candidateQuestionProgress.update({
        where: { id: progress.id },
        data: { lockedAt: now },
      });
      result = 'question-expired';
      return;
    }
    await tx.candidateAnswer.upsert({
      where: { attemptId_candidateQuestionId: { attemptId: attempt.id, candidateQuestionId: questionId } },
      create: { attemptId: attempt.id, candidateQuestionId: questionId, answer, savedAt: now },
      update: { answer, savedAt: now },
    });
  });
  if (result === 'attempt-expired') {
    await finalizeAttempt(candidate, 'timer_expired');
    throw conflict('Assessment time has ended. Your saved answers were submitted.');
  }
  if (result === 'question-expired') {
    throw conflict('This question timer has ended. Its last saved answer is retained.');
  }
  return { saved: true, questionId, savedAt: now };
}

async function updateSession(token, questionId, req) {
  const candidate = await getActiveCandidate(token, req);
  const attempt = candidate.attempt;
  const now = new Date();
  if (attempt.deadlineAt <= now) {
    await finalizeAttempt(candidate, 'timer_expired');
    throw conflict('Assessment time has ended. Your saved answers were submitted.');
  }
  const question = candidate.questions.find((q) => q.id === questionId);
  if (!question) throw notFound('Question not found for this invitation.');
  let expired = false;
  let questionExpired = false;
  await prisma.$transaction(async (tx) => {
    const current = await lockAttempt(tx, attempt.id);
    if (!current || current.state !== 'IN_PROGRESS') throw conflict('This assessment attempt is no longer active.');
    if (current.deadlineAt <= now) { expired = true; return; }
    if (current.faceState !== 'present') throw conflict('Question navigation is paused until face presence is restored.');
    const progress = current.progress.find((p) => p.candidateQuestionId === questionId);
    if (progress?.lockedAt ||
        (progress && question.estimatedTimeSeconds &&
         now.getTime() >= progress.startedAt.getTime() + question.estimatedTimeSeconds * 1000)) {
      if (!progress.lockedAt) {
        await tx.candidateQuestionProgress.update({ where: { id: progress.id }, data: { lockedAt: now } });
      }
      questionExpired = true;
      return;
    }
    if (!progress) {
      await tx.candidateQuestionProgress.create({
        data: { attemptId: attempt.id, candidateQuestionId: questionId, startedAt: now },
      });
    }
    await tx.candidateAttempt.update({ where: { id: attempt.id }, data: { activeQuestionId: questionId } });
  });
  if (expired) {
    await finalizeAttempt(candidate, 'timer_expired');
    throw conflict('Assessment time has ended. Your saved answers were submitted.');
  }
  if (questionExpired) throw conflict('This question is locked because its time has ended.');
  return attemptPayload(await findCandidate(token), now);
}

async function submitAttempt(token, req) {
  const candidate = await findCandidate(token);
  const hash = hashDevice(req);
  if (!candidate.attempt || candidate.attempt.deviceHash !== hash) {
    throw forbidden('This assessment can only be submitted from the browser used to start it.');
  }
  if (candidate.attempt.state === 'SUBMITTED' || candidate.attempt.state === 'CANCELLED') {
    return receiptPayload(candidate);
  }
  if (candidate.attempt.state !== 'IN_PROGRESS') throw conflict('This assessment attempt is not active.');
  return finalizeAttempt(candidate, candidate.attempt.deadlineAt <= new Date() ? 'timer_expired' : 'candidate_submit');
}

async function getReceipt(token, req) {
  const candidate = await findCandidate(token);
  const hash = hashDevice(req);
  if (!candidate.attempt || candidate.attempt.deviceHash !== hash) {
    throw forbidden('The receipt is available only in the verified browser used for this invitation.');
  }
  return receiptPayload(candidate);
}

async function saveDraft(token, req) {
  const candidate = await getActiveCandidate(token, req);
  const attempt = candidate.attempt;
  const now = new Date();
  if (!candidate.assessment.saveAndResume) throw forbidden('HR has not enabled saving this assessment as a draft.');
  if (attempt.deadlineAt <= now) {
    await finalizeAttempt(candidate, 'timer_expired');
    throw conflict('Assessment time has ended and cannot be saved as a draft.');
  }
  let expired = false;
  await prisma.$transaction(async (tx) => {
    const current = await lockAttempt(tx, attempt.id);
    if (!current || current.state !== 'IN_PROGRESS') throw conflict('This assessment attempt is no longer active.');
    if (current.deadlineAt <= now) { expired = true; return; }
    await tx.candidateAttempt.update({
      where: { id: attempt.id },
      data: { state: 'DRAFT', draftedAt: now },
    });
  });
  if (expired) {
    await finalizeAttempt(candidate, 'timer_expired');
    throw conflict('Assessment time has ended and cannot be saved as a draft.');
  }
  return attemptPayload(await findCandidate(token), now);
}

function finalTaskData(candidate, kind) {
  const raw = kind === 'reading' ? candidate.readingTaskSnapshot : candidate.speakingTaskSnapshot;
  if (!raw || typeof raw !== 'object') return null;
  return kind === 'reading'
    ? { prompt: raw.passage, maxMarks: raw.maxMarks, windowSeconds: raw.windowSeconds ?? 120 }
    : { prompt: raw.topic, maxMarks: raw.maxMarks, windowSeconds: raw.windowSeconds ?? 180 };
}

function candidateFinalTasks(candidate) {
  const attempt = candidate.attempt;
  const reading = finalTaskData(candidate, 'reading');
  const speaking = finalTaskData(candidate, 'speaking');
  return {
    phase: attempt.phase.toLowerCase(),
    reading: reading ? {
      ...reading,
      status: attempt.readingStatus.toLowerCase(),
      deadlineAt: attempt.phase === 'READING' ? attempt.taskDeadlineAt : null,
    } : null,
    speaking: speaking ? {
      ...speaking,
      minDurationSeconds: 60,
      status: attempt.speakingStatus.toLowerCase(),
      deadlineAt: attempt.phase === 'SPEAKING' ? attempt.taskDeadlineAt : null,
    } : null,
  };
}

async function settleExpiredFinalTask(candidate, now = new Date()) {
  const attempt = candidate.attempt;
  if (!attempt.taskDeadlineAt || attempt.taskDeadlineAt > now ||
      !['READING', 'SPEAKING'].includes(attempt.phase)) return candidate;
  let settled = false;
  await prisma.$transaction(async (tx) => {
    const current = await lockAttempt(tx, attempt.id);
    if (!current || current.state !== 'IN_PROGRESS' || !current.taskDeadlineAt ||
        current.taskDeadlineAt > now || !['READING', 'SPEAKING'].includes(current.phase)) return;
    const statusField = current.phase === 'READING' ? 'readingStatus' : 'speakingStatus';
    const nextPhase = current.phase === 'READING' && candidate.speakingTaskSnapshot ? 'SPEAKING' : current.phase;
    await tx.candidateAttempt.update({
      where: { id: current.id },
      data: { [statusField]: 'SKIPPED', phase: nextPhase, taskDeadlineAt: null },
    });
    settled = true;
  });
  return settled ? findCandidate(candidate.accessToken) : candidate;
}

async function getFinalTasks(token, req) {
  let candidate = await getActiveCandidate(token, req);
  if (candidate.attempt.deadlineAt <= new Date()) {
    await finalizeAttempt(candidate, 'timer_expired');
    throw conflict('Assessment time has ended.');
  }
  candidate = await settleExpiredFinalTask(candidate);
  return candidateFinalTasks(candidate);
}

async function startFinalTask(token, kind, req) {
  const candidate = await getActiveCandidate(token, req);
  const now = new Date();
  const task = finalTaskData(candidate, kind);
  if (!task || !task.prompt) throw conflict(`No approved ${kind} task is available for this invitation.`);
  const attempt = candidate.attempt;
  const statusField = kind === 'reading' ? 'readingStatus' : 'speakingStatus';
  let expired = false;
  let taskExpired = false;
  await prisma.$transaction(async (tx) => {
    const current = await lockAttempt(tx, attempt.id);
    if (!current || current.state !== 'IN_PROGRESS') throw conflict('This assessment attempt is no longer active.');
    if (current.deadlineAt <= now) { expired = true; return; }
    const status = current[statusField];
    if (status === 'RECORDED' || status === 'SKIPPED') {
      throw conflict(`The ${kind} task has already ended.`);
    }
    if (status === 'READY' && current.phase === kind.toUpperCase()) {
      if (!current.taskDeadlineAt || current.taskDeadlineAt <= now) {
        taskExpired = true;
        return;
      }
      return;
    }
    if (kind === 'reading') {
      if (current.phase !== 'QUESTIONS') throw conflict('Complete the question section before starting the reading task.');
      const lastQuestion = candidate.questions[candidate.questions.length - 1];
      if (current.activeQuestionId !== lastQuestion?.id) {
        throw conflict('Finish the questions before moving to the reading task.');
      }
    } else {
      if (candidate.readingTaskSnapshot && current.readingStatus !== 'RECORDED' &&
          current.readingStatus !== 'SKIPPED') {
        throw conflict('Complete the reading task before starting the speaking task.');
      }
      if (current.phase !== 'READING' && current.phase !== 'SPEAKING' &&
          !(current.phase === 'QUESTIONS' && !candidate.readingTaskSnapshot)) {
        throw conflict('The speaking task is not available yet.');
      }
    }
    const taskDeadlineAt = addSeconds(now, task.windowSeconds, current.deadlineAt);
    await tx.candidateAttempt.update({
      where: { id: current.id },
      data: { phase: kind.toUpperCase(), [statusField]: 'READY', taskDeadlineAt },
    });
  });
  if (expired) {
    await finalizeAttempt(candidate, 'timer_expired');
    throw conflict('Assessment time has ended.');
  }
  if (taskExpired) {
    await settleExpiredFinalTask(await findCandidate(token), now);
    throw conflict(`The ${kind} task time has ended.`);
  }
  const refreshed = await findCandidate(token);
  return { attempt: attemptPayload(refreshed, now), task: candidateFinalTasks(refreshed)[kind] };
}

function detectAudioType(file) {
  const b = file.buffer;
  if (b.length >= 4 && b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'audio/webm';
  if (b.length >= 4 && b.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  return null;
}

async function uploadFinalTaskRecording(token, kind, file, durationSeconds, req) {
  if (!file || !file.buffer?.length) throw badRequest('Attach an audio recording in the file field.');
  const detectedType = detectAudioType(file);
  if (!detectedType || detectedType !== file.mimetype) {
    throw badRequest('The uploaded file is not a supported audio recording.');
  }
  const candidate = await getActiveCandidate(token, req);
  const attempt = candidate.attempt;
  const now = new Date();
  if ((kind === 'reading' && attempt.phase !== 'READING') ||
      (kind === 'speaking' && attempt.phase !== 'SPEAKING')) {
    throw conflict(`Start the ${kind} task before uploading its recording.`);
  }
  const status = kind === 'reading' ? attempt.readingStatus : attempt.speakingStatus;
  if (status !== 'READY') throw conflict(`The ${kind} task is not accepting a recording.`);
  if (attempt.deadlineAt <= now) {
    await finalizeAttempt(candidate, 'timer_expired');
    throw conflict('Assessment time has ended.');
  }
  if (!attempt.taskDeadlineAt || attempt.taskDeadlineAt <= now) {
    await settleExpiredFinalTask(candidate, now);
    throw conflict(`The ${kind} task time has ended.`);
  }
  const baseDirectory = path.resolve(env.candidateMediaDirectory);
  const relativePath = path.join(
    String(candidate.id),
    String(attempt.id),
    `${kind}-${crypto.randomUUID()}.${detectedType === 'audio/mp4' ? 'mp4' : detectedType.slice(6)}`
  );
  const absolutePath = path.resolve(baseDirectory, relativePath);
  if (!absolutePath.startsWith(`${baseDirectory}${path.sep}`)) throw badRequest('Invalid recording path.');
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, file.buffer, { flag: 'wx', mode: 0o600 });

  const taskKind = kind.toUpperCase();
  const statusField = kind === 'reading' ? 'readingStatus' : 'speakingStatus';
  let old = null;
  let attemptExpired = false;
  let taskExpired = false;
  try {
    await prisma.$transaction(async (tx) => {
      const current = await lockAttempt(tx, attempt.id);
      if (!current || current.state !== 'IN_PROGRESS') {
        throw conflict('This assessment attempt is no longer active.');
      }
      const completedAt = new Date();
      if (current.deadlineAt <= completedAt) { attemptExpired = true; return; }
      if (!current.taskDeadlineAt || current.taskDeadlineAt <= completedAt) { taskExpired = true; return; }
      if (current.phase !== kind.toUpperCase() || current[statusField] !== 'READY') {
        throw conflict(`The ${kind} task is not accepting a recording.`);
      }
      old = await tx.candidateRecording.findUnique({
        where: { attemptId_kind: { attemptId: attempt.id, kind: taskKind } },
      });
      await tx.candidateRecording.upsert({
        where: { attemptId_kind: { attemptId: attempt.id, kind: taskKind } },
        create: {
          attemptId: attempt.id,
          kind: taskKind,
          storagePath: relativePath,
          contentType: detectedType,
          byteSize: file.size,
          durationSeconds,
        },
        update: {
          storagePath: relativePath,
          contentType: detectedType,
          byteSize: file.size,
          durationSeconds,
        },
      });
      await tx.candidateAttempt.update({
        where: { id: attempt.id },
        data: {
          [statusField]: 'RECORDED',
          taskDeadlineAt: null,
          ...(kind === 'reading' && candidate.speakingTaskSnapshot ? { phase: 'SPEAKING' } : {}),
        },
      });
    });
  } catch (error) {
    await fs.unlink(absolutePath).catch(() => undefined);
    throw error;
  }
  if (attemptExpired) {
    await fs.unlink(absolutePath).catch(() => undefined);
    await finalizeAttempt(candidate, 'timer_expired');
    throw conflict('Assessment time has ended.');
  }
  if (taskExpired) {
    await fs.unlink(absolutePath).catch(() => undefined);
    await settleExpiredFinalTask(await findCandidate(token), now);
    throw conflict(`The ${kind} task time has ended.`);
  }
  if (old?.storagePath) {
    const oldPath = path.resolve(baseDirectory, old.storagePath);
    if (oldPath.startsWith(`${baseDirectory}${path.sep}`)) await fs.unlink(oldPath).catch(() => undefined);
  }
  const refreshed = await findCandidate(token);
  return { attempt: attemptPayload(refreshed), tasks: candidateFinalTasks(refreshed) };
}

async function getCandidateRecording(candidateId, kind) {
  const record = await prisma.candidateRecording.findFirst({
    where: { kind: kind.toUpperCase(), attempt: { candidateId } },
  });
  if (!record) throw notFound('Candidate recording not found.');
  const baseDirectory = path.resolve(env.candidateMediaDirectory);
  const absolutePath = path.resolve(baseDirectory, record.storagePath);
  if (!absolutePath.startsWith(`${baseDirectory}${path.sep}`)) throw notFound('Candidate recording not found.');
  try {
    await fs.access(absolutePath);
  } catch {
    throw notFound('Candidate recording file is unavailable.');
  }
  return { absolutePath, contentType: record.contentType };
}

async function logIncident(token, input, req) {
  const candidate = await getActiveCandidate(token, req);
  try {
    await prisma.$transaction(async (tx) => {
      const current = await lockAttempt(tx, candidate.attempt.id);
      if (!current || current.state !== 'IN_PROGRESS') throw conflict('This assessment attempt is no longer active.');
      await tx.candidateIncident.create({
        data: {
          attemptId: candidate.attempt.id,
          eventId: input.eventId,
          type: input.type,
          detail: input.detail || null,
        },
      });
    });
    return { logged: true, duplicate: false };
  } catch (error) {
    if (error.code === 'P2002') return { logged: true, duplicate: true };
    throw error;
  }
}

async function updateFacePresence(token, input, req) {
  const candidate = await getActiveCandidate(token, req);
  const attempt = candidate.attempt;
  const now = new Date();
  let warning = '';
  let skippedQuestionId = null;
  let duplicate = false;
  let state = input.state;
  await prisma.$transaction(async (tx) => {
    const current = await lockAttempt(tx, attempt.id);
    if (!current || current.state !== 'IN_PROGRESS') throw conflict('This assessment attempt is no longer active.');
    const existingEvent = await tx.candidateIncident.findFirst({
      where: { attemptId: attempt.id, eventId: input.eventId },
      select: { id: true },
    });
    if (existingEvent) {
      duplicate = true;
      state = current.faceState;
      return;
    }
    const changed = current.faceState !== input.state;
    let absentSince = current.faceAbsentSince;
    let counted = current.faceAbsenceCounted;
    if (input.state === 'present') {
      absentSince = null;
      counted = false;
    } else if (input.state === 'absent' && current.faceState !== 'absent') {
      absentSince = now;
      counted = false;
    }
    if (input.state === 'absent' && absentSince && !counted &&
        now.getTime() - absentSince.getTime() >= FACE_WARNING_SECONDS * 1000) {
      const progress = current.progress.find((p) => p.candidateQuestionId === current.activeQuestionId);
      if (progress && !progress.lockedAt) {
        const count = progress.faceWarningCount + 1;
        await tx.candidateQuestionProgress.update({
          where: { id: progress.id },
          data: { faceWarningCount: count, ...(count >= 3 ? { lockedAt: now } : {}) },
        });
        if (count >= 3) {
          const currentIndex = candidate.questions.findIndex((q) => q.id === current.activeQuestionId);
          const next = candidate.questions.slice(currentIndex + 1).find((q) =>
            !current.progress.some((p) => p.candidateQuestionId === q.id && p.lockedAt));
          skippedQuestionId = current.activeQuestionId;
          if (next) {
            const progressExists = await tx.candidateQuestionProgress.findUnique({
              where: { attemptId_candidateQuestionId: { attemptId: attempt.id, candidateQuestionId: next.id } },
            });
            if (!progressExists) await tx.candidateQuestionProgress.create({
              data: { attemptId: attempt.id, candidateQuestionId: next.id, startedAt: now },
            });
            await tx.candidateAttempt.update({ where: { id: attempt.id }, data: { activeQuestionId: next.id } });
          }
          warning = 'This question was skipped after repeated face-presence warnings.';
        } else {
          warning = `Face-presence warning ${count} of 2. Answering resumes when your face returns.`;
        }
      }
      counted = true;
    }
    await tx.candidateAttempt.update({
      where: { id: attempt.id },
      data: { faceState: input.state, faceAbsentSince: absentSince, faceAbsenceCounted: counted },
    });
    if (changed || warning) {
      await tx.candidateIncident.create({
        data: {
          attemptId: attempt.id,
          eventId: input.eventId,
          type: input.state === 'present' ? 'face_restored' : input.state === 'absent' ? 'face_missing' : 'face_monitoring_unavailable',
          detail: warning || (input.state === 'present' ? 'Face presence restored.' : 'Answering paused until face monitoring recovers.'),
        },
      });
    }
  });
  return { state, paused: state !== 'present', warning, skippedQuestionId, duplicate };
}

async function recordViolation(token, eventId, req) {
  const candidate = await findCandidate(token);
  const hash = hashDevice(req);
  if (!candidate.attempt || candidate.attempt.deviceHash !== hash) {
    throw forbidden('This assessment can only be accessed in the browser used to start it.');
  }
  const attempt = candidate.attempt;
  if (attempt.state === 'CANCELLED') return receiptPayload(candidate);
  let ended = false;
  try {
    await prisma.$transaction(async (tx) => {
      const current = await lockAttempt(tx, attempt.id);
      if (!current) throw conflict('This assessment attempt was not found.');
      if (current.state === 'CANCELLED' || current.state === 'SUBMITTED') { ended = true; return; }
      if (current.state !== 'IN_PROGRESS') throw conflict('This assessment attempt has already ended.');
      await tx.candidateIncident.create({
        data: {
          attemptId: attempt.id,
          eventId,
          type: 'tab_switch',
          detail: 'Assessment cancelled after the first tab-switch event. Saved answers are preserved.',
        },
      });
      await tx.candidateAttempt.update({
        where: { id: attempt.id },
        data: {
          state: 'CANCELLED',
          submittedAt: new Date(),
          cancellationReason: 'tab_switch',
          submissionReason: 'tab_switch_cancelled',
          score: null,
          evaluationStatus: 'cancelled',
        },
      });
      await tx.candidate.update({ where: { id: candidate.id }, data: { status: 'CANCELLED' } });
    });
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    ended = true;
  }
  if (ended) return receiptPayload(await findCandidate(token));
  return receiptPayload(await findCandidate(token));
}

module.exports = {
  getInvitation,
  sendContactCode,
  verifyContactCode,
  checkSecurity,
  startAttempt,
  saveAnswer,
  updateSession,
  submitAttempt,
  getReceipt,
  saveDraft,
  logIncident,
  updateFacePresence,
  getFinalTasks,
  startFinalTask,
  uploadFinalTaskRecording,
  getCandidateRecording,
  recordViolation,
};
