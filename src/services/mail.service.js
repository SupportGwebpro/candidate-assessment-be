const nodemailer = require('nodemailer');
const env = require('../config/env');

/// Outcome of a send attempt. Sending never throws for expected conditions
/// (missing SMTP config, provider rejection) so callers can report the status
/// without failing the request that triggered the email.
const MAIL_STATUS = { SENT: 'SENT', NOT_CONFIGURED: 'NOT_CONFIGURED', FAILED: 'FAILED' };

function smtpConfigurationComplete() {
  const { host, port, user, password, from } = env.smtp;
  return !!host && Number.isInteger(port) && port > 0 && port <= 65535 &&
    !!user && !!password && !!from;
}

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

// Collapse whitespace/newlines so user-supplied text can't break a header line.
const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/// Format a date in the assessment's own IANA time zone (falls back to UTC).
function formatWhen(date, timezone) {
  if (!date) return null;
  const options = {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  };
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: timezone || 'UTC' }).format(new Date(date));
  } catch (_) {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(date));
  }
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function buildMessage({ candidateName, assessment, link, durationSeconds }) {
  const name = oneLine(candidateName) || 'Candidate';
  const title = oneLine(assessment.name) || oneLine(assessment.role) || 'Assessment';
  const role = oneLine(assessment.role);
  const opens = formatWhen(assessment.opensAt, assessment.timezone);
  const closes = formatWhen(assessment.closesAt, assessment.timezone);
  const duration = formatDuration(durationSeconds);

  const details = [];
  if (role) details.push(['Role', role]);
  if (duration) details.push(['Duration', duration]);
  if (opens) details.push(['Opens', opens]);
  if (closes) details.push(['Closes', closes]);

  const subject = `Your assessment invitation: ${title}`.slice(0, 150);

  const text = [
    `Hello ${name},`,
    '',
    `You have been invited to take the assessment "${title}".`,
    '',
    ...details.map(([label, value]) => `${label}: ${value}`),
    ...(details.length ? [''] : []),
    'Start your assessment using the link below:',
    link,
    '',
    'This link is personal to you. Please do not share it with anyone else.',
    'If you were not expecting this invitation, you can ignore this email.',
  ].join('\n');

  const detailRows = details
    .map(([label, value]) =>
      `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`)
    .join('');

  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5">',
    `<p>Hello ${escapeHtml(name)},</p>`,
    `<p>You have been invited to take the assessment <strong>${escapeHtml(title)}</strong>.</p>`,
    detailRows ? `<ul>${detailRows}</ul>` : '',
    `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">Start assessment</a></p>`,
    `<p>If the button does not work, copy this link into your browser:<br>${escapeHtml(link)}</p>`,
    '<p style="color:#666">This link is personal to you. Please do not share it with anyone else. If you were not expecting this invitation, you can ignore this email.</p>',
    '</div>',
  ].join('');

  return { subject, text, html };
}

/// Email the candidate their personal assessment link.
/// Resolves to { status, message } — never rejects for expected failures.
async function sendCandidateAssessmentLink({ to, candidateName, assessment, link, durationSeconds }) {
  if (!smtpConfigurationComplete()) {
    return {
      status: MAIL_STATUS.NOT_CONFIGURED,
      message: 'Email is not configured (SMTP settings missing or incomplete). Share the link manually.'+link,
    };
  }
  if (!/^https?:\/\//i.test(link)) {
    return {
      status: MAIL_STATUS.NOT_CONFIGURED,
      message: 'CANDIDATE_LINK_BASE_URL is not set to a full URL, so the email was not sent. Share the link manually.',
    };
  }

  const { subject, text, html } = buildMessage({ candidateName, assessment, link, durationSeconds });

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
    await transporter.sendMail({ from: env.smtp.from, to, subject, text, html });
    return { status: MAIL_STATUS.SENT, message: null };
  } catch (error) {
    // Log only non-sensitive diagnostics (never the link/token or credentials).
    console.error('[candidate link email failed]', {
      code: error.code || 'UNKNOWN',
      responseCode: Number.isInteger(error.responseCode) ? error.responseCode : undefined,
    });
    return {
      status: MAIL_STATUS.FAILED,
      message: 'The email could not be sent. Check the SMTP settings or share the link manually.',
    };
  } finally {
    transporter.close();
  }
}

module.exports = { sendCandidateAssessmentLink, MAIL_STATUS };
