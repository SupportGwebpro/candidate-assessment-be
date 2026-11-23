const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const env = require('../config/env');
const { notFound, conflict, badRequest } = require('../utils/http');
const ai = require('./ai.service');
const { sendCandidateAssessmentLink } = require('./mail.service');

// --- lookups / helpers -----------------------------------------------------

async function findAssessment(id) {
  const a = await prisma.assessment.findUnique({ where: { id } });
  if (!a) throw notFound('Assessment not found');
  return a;
}
function ensureAssignable(a) {
  if (a.status === 'ARCHIVED') throw conflict('Restore this assessment before assigning candidates');
}
async function findCandidate(id, candidateId) {
  const c = await prisma.candidate.findFirst({ where: { id: candidateId, assessmentId: id } });
  if (!c) throw notFound('Candidate not found for this assessment');
  return c;
}

function buildLink(token) {
  const base = (env.candidateLinkBaseUrl || '').replace(/\/$/, '');
  return `${base}/assess/${token}`;
}

const serialize = (c, questionCount) => ({
  id: c.id,
  assessmentId: c.assessmentId,
  name: c.name,
  email: c.email,
  phone: c.phone ?? null,
  status: c.status,
  questionSource: c.questionSource,
  assessmentVersionNumber: c.assessmentVersionNumber ?? null,
  questionsApproved: c.questionsApproved,
  questionsApprovedAt: c.questionsApprovedAt ?? null,
  timerApproved: c.timerApproved,
  timerApprovalNote: c.timerApprovalNote ?? null,
  timerApprovedSeconds: c.timerApprovedSeconds ?? null,
  timerApprovedAt: c.timerApprovedAt ?? null,
  linkGenerated: !!c.accessToken,
  link: c.accessToken ? buildLink(c.accessToken) : null,
  linkGeneratedAt: c.linkGeneratedAt ?? null,
  canGenerateLink: c.questionsApproved && c.timerApproved,
  questionCount: questionCount !== undefined ? questionCount : c._count ? c._count.questions : undefined,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

// --- create assignment (the modified "add candidate" API) ------------------

async function assignCandidate(id, data, adminId) {
  const a = await findAssessment(id);
  ensureAssignable(a);

  // Prevent duplicate assignment for the same email (also enforced by a DB unique).
  const dupe = await prisma.candidate.findFirst({ where: { assessmentId: id, email: data.email } });
  if (dupe) throw conflict('A candidate with this email is already assigned to this assessment');

  // The assignment must be based on an approved blueprint.
  const questions = await prisma.assessmentQuestion.findMany({
    where: { assessmentId: id },
    include: { section: { select: { name: true } } },
    orderBy: [{ sectionId: 'asc' }, { order: 'asc' }],
  });
  if (questions.length === 0) {
    throw conflict('Generate and approve the assessment blueprint before assigning candidates');
  }
  if (questions.some((q) => !q.approved)) {
    throw conflict('Approve all blueprint questions before assigning candidates');
  }

  // Retain the current assessment version.
  const version = await prisma.assessmentVersion.findFirst({
    where: { assessmentId: id },
    orderBy: { versionNumber: 'desc' },
    select: { id: true, versionNumber: true },
  });

  // Build the candidate's question rows (outside any transaction for FRESH AI calls).
  let rows;
  let questionsApproved;
  if (data.questionSource === 'FRESH') {
    const sections = await prisma.assessmentSection.findMany({
      where: { assessmentId: id },
      orderBy: { order: 'asc' },
    });
    const skills = (await prisma.assessmentSkill.findMany({ where: { assessmentId: id } })).map((s) => s.name);

    rows = [];
    let order = 0;
    for (const section of sections) {
      const { mcqs, written } = await ai.generateSectionQuestions({
        roleTitle: a.role, jobDescription: a.jobDescription, level: a.level, skills, section,
      });
      for (const q of mcqs) {
        rows.push({ sectionName: section.name, type: 'MCQ', prompt: q.prompt, options: q.options, correctOption: q.correctOption, approved: false, order: order++ });
      }
      for (const q of written) {
        rows.push({ sectionName: section.name, type: 'WRITTEN', prompt: q.prompt, modelAnswer: q.modelAnswer ?? null, approved: false, order: order++ });
      }
    }
    questionsApproved = false; // fresh set needs HR review
  } else {
    // SHARED: snapshot the approved blueprint questions.
    rows = questions.map((q, i) => ({
      sectionName: q.section ? q.section.name : 'Section',
      type: q.type,
      prompt: q.prompt,
      options: q.options ?? undefined,
      correctOption: q.correctOption ?? null,
      modelAnswer: q.modelAnswer ?? null,
      evaluationRubric: q.evaluationRubric ?? null,
      marks: q.marks ?? null,
      difficulty: q.difficulty ?? null,
      estimatedTimeSeconds: q.estimatedTimeSeconds ?? null,
      approved: true,
      order: i,
      sourceQuestionId: q.id,
    }));
    questionsApproved = true; // already approved set
  }

  const created = await prisma.$transaction(async (tx) => {
    const candidate = await tx.candidate.create({
      data: {
        assessmentId: id,
        name: data.name,
        email: data.email,
        phone: data.phone ?? null,
        status: data.status || 'INVITED',
        questionSource: data.questionSource,
        assessmentVersionId: version ? version.id : null,
        assessmentVersionNumber: version ? version.versionNumber : null,
        questionsApproved,
        questionsApprovedAt: questionsApproved ? new Date() : null,
        questionsApprovedById: questionsApproved ? adminId : null,
      },
    });
    if (rows.length) {
      await tx.candidateQuestion.createMany({
        data: rows.map((r) => ({ ...r, candidateId: candidate.id })),
      });
    }
    return candidate;
  });

  return getCandidate(id, created.id);
}

// --- read ------------------------------------------------------------------

/// Global candidate list across all assessments (the whole candidates table),
/// with search (name/email), status/source/assessment filters, sorting + paging.
async function listAllCandidates(filters = {}) {
  const { search, status, source, assessmentId, page, pageSize, sortBy, sortOrder } = filters;

  const where = {};
  if (status) where.status = status;
  if (source) where.questionSource = source;
  if (assessmentId) where.assessmentId = assessmentId;
  if (search) where.OR = [{ name: { contains: search } }, { email: { contains: search } }];

  const [rows, total] = await prisma.$transaction([
    prisma.candidate.findMany({
      where,
      include: {
        _count: { select: { questions: true } },
        assessment: { select: { id: true, name: true, role: true, status: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.candidate.count({ where }),
  ]);

  return {
    items: rows.map((c) => ({ ...serialize(c), assessment: c.assessment })),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}


async function listCandidates(id, filters = {}) {
  await findAssessment(id);
  const where = { assessmentId: id };
  if (filters.status) where.status = filters.status;
  if (filters.source) where.questionSource = filters.source;

  const rows = await prisma.candidate.findMany({
    where,
    include: { _count: { select: { questions: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((c) => serialize(c));
}

async function getCandidate(id, candidateId) {
  await findAssessment(id);
  const c = await prisma.candidate.findFirst({
    where: { id: candidateId, assessmentId: id },
    include: { _count: { select: { questions: true } } },
  });
  if (!c) throw notFound('Candidate not found for this assessment');

  const out = serialize(c);
  if (c.accessToken) {
    out.accessToken = c.accessToken;
    out.link = buildLink(c.accessToken);
  }
  return out;
}

async function listCandidateQuestions(id, candidateId) {
  await findAssessment(id);
  await findCandidate(id, candidateId);
  return prisma.candidateQuestion.findMany({ where: { candidateId }, orderBy: { order: 'asc' } });
}

// --- fresh-question review -------------------------------------------------

async function updateCandidateQuestion(id, candidateId, cqId, data, adminId) {
  const a = await findAssessment(id);
  ensureAssignable(a);
  await findCandidate(id, candidateId);
  const cq = await prisma.candidateQuestion.findFirst({ where: { id: cqId, candidateId } });
  if (!cq) throw notFound('Question not found for this candidate');

  if (cq.type === 'MCQ') {
    const options = data.options !== undefined ? data.options : cq.options;
    const correct = data.correctOption !== undefined ? data.correctOption : cq.correctOption;
    if (Array.isArray(options) && correct != null && correct > options.length - 1) {
      throw badRequest('correctOption is out of range for the options');
    }
  } else if (data.options !== undefined || data.correctOption !== undefined) {
    throw badRequest('options / correctOption apply only to MCQ questions');
  }

  // Editing a candidate question resets both that question and the set approval.
  const [updated] = await prisma.$transaction([
    prisma.candidateQuestion.update({ where: { id: cq.id }, data: { ...data, approved: false } }),
    prisma.candidate.update({
      where: { id: candidateId },
      data: { questionsApproved: false, questionsApprovedAt: null, questionsApprovedById: null },
    }),
  ]);
  return updated;
}

async function regenerateCandidateQuestions(id, candidateId, adminId) {
  const a = await findAssessment(id);
  ensureAssignable(a);
  const candidate = await findCandidate(id, candidateId);
  if (candidate.questionSource !== 'FRESH') {
    throw conflict('Only fresh candidate question sets can be regenerated');
  }

  const sections = await prisma.assessmentSection.findMany({ where: { assessmentId: id }, orderBy: { order: 'asc' } });
  const skills = (await prisma.assessmentSkill.findMany({ where: { assessmentId: id } })).map((s) => s.name);

  const rows = [];
  let order = 0;
  for (const section of sections) {
    const { mcqs, written } = await ai.generateSectionQuestions({
      roleTitle: a.role, jobDescription: a.jobDescription, level: a.level, skills, section,
    });
    for (const q of mcqs) rows.push({ candidateId, sectionName: section.name, type: 'MCQ', prompt: q.prompt, options: q.options, correctOption: q.correctOption, approved: false, order: order++ });
    for (const q of written) rows.push({ candidateId, sectionName: section.name, type: 'WRITTEN', prompt: q.prompt, modelAnswer: q.modelAnswer ?? null, approved: false, order: order++ });
  }

  await prisma.$transaction(async (tx) => {
    await tx.candidateQuestion.deleteMany({ where: { candidateId } });
    if (rows.length) await tx.candidateQuestion.createMany({ data: rows });
    await tx.candidate.update({
      where: { id: candidateId },
      data: { questionsApproved: false, questionsApprovedAt: null, questionsApprovedById: null },
    });
  });

  return prisma.candidateQuestion.findMany({ where: { candidateId }, orderBy: { order: 'asc' } });
}

async function approveCandidateQuestions(id, candidateId, adminId) {
  const a = await findAssessment(id);
  ensureAssignable(a);
  await findCandidate(id, candidateId);
  const count = await prisma.candidateQuestion.count({ where: { candidateId } });
  if (count === 0) throw conflict('This candidate has no questions to approve');

  await prisma.$transaction([
    prisma.candidateQuestion.updateMany({ where: { candidateId }, data: { approved: true } }),
    prisma.candidate.update({
      where: { id: candidateId },
      data: { questionsApproved: true, questionsApprovedAt: new Date(), questionsApprovedById: adminId },
    }),
  ]);
  return getCandidate(id, candidateId);
}

// --- timer approval (independent, with note) -------------------------------

async function setTimerApproval(id, candidateId, approved, note, durationSeconds, adminId) {
  const a = await findAssessment(id);
  ensureAssignable(a);
  await findCandidate(id, candidateId);

  await prisma.candidate.update({
    where: { id: candidateId },
    data: {
      timerApproved: approved,
      timerApprovalNote: approved ? note : note ?? null,
      timerApprovedSeconds: approved ? durationSeconds : null,
      timerApprovedAt: approved ? new Date() : null,
      timerApprovedById: approved ? adminId : null,
    },
  });
  return getCandidate(id, candidateId);
}

// --- link generation -------------------------------------------------------

async function generateLink(id, candidateId, adminId) {
  const a = await findAssessment(id);
  ensureAssignable(a);
  const candidate = await findCandidate(id, candidateId);

  if (!candidate.questionsApproved) {
    throw conflict('Candidate questions must be approved before generating the link');
  }
  if (!candidate.timerApproved) {
    throw conflict('Timer approval (with note) is required before generating the link');
  }

  const [readingTask, speakingTask] = await prisma.$transaction([
    prisma.assessmentReadingTask.findUnique({ where: { assessmentId: id } }),
    prisma.assessmentSpeakingTask.findUnique({ where: { assessmentId: id } }),
  ]);
  if (readingTask && (!readingTask.approved || !readingTask.passage)) {
    throw conflict('Approve and complete the reading task before generating the candidate link');
  }
  if (speakingTask && (!speakingTask.approved || !speakingTask.topic)) {
    throw conflict('Approve and complete the speaking task before generating the candidate link');
  }

  const token = crypto.randomBytes(24).toString('hex');
  const updated = await prisma.candidate.update({
    where: { id: candidateId },
    data: {
      accessToken: token,
      linkGeneratedAt: new Date(),
      readingTaskSnapshot: readingTask
        ? { passage: readingTask.passage, maxMarks: readingTask.maxMarks, windowSeconds: readingTask.readingWindowSeconds }
        : Prisma.JsonNull,
      speakingTaskSnapshot: speakingTask
        ? { topic: speakingTask.topic, maxMarks: speakingTask.maxMarks, windowSeconds: speakingTask.speakingWindowSeconds }
        : Prisma.JsonNull,
    },
  });


  const link = buildLink(token);
  const link_for_email= "https://assess-candidate.netlify.app"+link

  // Email the candidate their link. The link is already saved at this point, so
  // a mail problem must not fail the request — it is reported in the response
  // and HR can still share the link manually.
  let email;
  try {
    email = await sendCandidateAssessmentLink({
      to: candidate.email,
      candidateName: candidate.name,
      assessment: a,
      link: link_for_email,
      durationSeconds:
        candidate.timerApprovedSeconds ?? (a.durationMinutes ? a.durationMinutes * 60 : null),
    });
  } catch (error) {
    console.error('[candidate link email error]', error.name);
    email = { status: 'FAILED', message: 'The email could not be sent. Share the link manually.' };
  }

  return {
    candidateId: updated.id,
    accessToken: token,
    link,
    linkGeneratedAt: updated.linkGeneratedAt,
    emailSent: email.status === 'SENT',
    emailStatus: email.status,
    emailMessage: email.message,
  };
}

// --- delete assigned candidate ---------------------------------------------

/// Permanently delete a candidate assignment (irreversible). The database
/// cascades to the candidate's questions, attempt, answers, progress, incidents,
/// recordings and contact verification, then the candidate's recording files on
/// disk are removed. A candidate who has started an attempt holds real results,
/// so deleting them needs an explicit `force` confirmation.
async function removeCandidate(id, candidateId, adminId, force = false) {
  const a = await findAssessment(id);
  if (a.status === 'ARCHIVED') throw conflict('Restore this assessment before removing candidates');

  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, assessmentId: id },
    include: { attempt: { select: { state: true } } },
  });
  if (!candidate) throw notFound('Candidate not found for this assessment');

  const hasAttempt = !!candidate.attempt;
  if (hasAttempt && !force) {
    throw conflict(
      'This candidate has started the assessment. Deleting them permanently erases their answers, ' +
        'recordings and evaluation. Repeat the request with ?force=true to confirm.',
      { requiresForce: true, attemptState: candidate.attempt.state }
    );
  }

  // Database first, so a failure here loses nothing. deleteMany (not delete) so a
  // concurrent double-delete is a clean 404 rather than an unhandled P2025.
  const { count } = await prisma.candidate.deleteMany({ where: { id: candidateId, assessmentId: id } });
  if (!count) throw notFound('Candidate not found for this assessment');

  // Minimal audit trail (ids only, no personal data).
  console.info('[candidate deleted]', {
    assessmentId: id, candidateId, adminId, hadAttempt: hasAttempt, forced: hasAttempt && !!force,
  });

  // Recording files live under <media dir>/<candidateId>/... Best effort: the
  // rows are already gone, so a failure is reported rather than rolled back.
  let mediaCleanupFailed = false;
  const baseDirectory = path.resolve(env.candidateMediaDirectory);
  const candidateDirectory = path.resolve(baseDirectory, String(candidateId));
  if (candidateDirectory.startsWith(`${baseDirectory}${path.sep}`)) {
    try {
      await fs.rm(candidateDirectory, { recursive: true, force: true });
    } catch (error) {
      mediaCleanupFailed = true;
      console.error('[candidate media cleanup failed]', { candidateId, code: error.code || 'UNKNOWN' });
    }
  }

  return { candidateId, deleted: true, mediaCleanupFailed };
}

module.exports = {
  assignCandidate,
  listAllCandidates,
  listCandidates,
  getCandidate,
  listCandidateQuestions,
  updateCandidateQuestion,
  regenerateCandidateQuestions,
  approveCandidateQuestions,
  setTimerApproval,
  generateLink,
  removeCandidate,
};
