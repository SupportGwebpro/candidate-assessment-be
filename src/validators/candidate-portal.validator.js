const { z } = require('zod');

const tokenParam = {
  params: z.object({ token: z.string().min(24).max(256) }),
};

const contactCodeSchema = {
  ...tokenParam,
  body: z.object({
    method: z.enum(['email', 'phone']),
    contact: z.string().trim().min(3).max(254),
  }),
};

const verifyContactCodeSchema = {
  ...tokenParam,
  body: z.object({
    method: z.enum(['email', 'phone']),
    contact: z.string().trim().min(3).max(254),
    code: z.string().regex(/^\d{6}$/, 'Enter the six-digit verification code'),
  }),
};

const candidateSecuritySchema = {
  ...tokenParam,
  body: z.object({ consent: z.literal(true) }),
};

const startCandidateAttemptSchema = {
  ...tokenParam,
  body: z.object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(254),
    privacyConsent: z.literal(true),
    recordingConsent: z.literal(true),
    cameraReady: z.literal(true),
    microphoneReady: z.literal(true),
  }),
};

const saveCandidateAnswerSchema = {
  params: z.object({
    token: z.string().min(24).max(256),
    questionId: z.coerce.number().int().positive(),
  }),
  body: z.object({ answer: z.string().max(10000) }),
};

const candidateSessionSchema = {
  ...tokenParam,
  body: z.object({ questionId: z.coerce.number().int().positive() }),
};

const submitCandidateAttemptSchema = {
  ...tokenParam,
  body: z.object({}).strict().optional().default({}),
};

const candidateDraftSchema = {
  ...tokenParam,
  body: z.object({}).strict().optional().default({}),
};

const candidateIncidentSchema = {
  ...tokenParam,
  body: z.object({
    eventId: z.string().min(20).max(128),
    type: z.enum(['camera_lost', 'microphone_lost', 'network_interruption', 'fullscreen_exit']),
    detail: z.string().trim().max(500).optional(),
  }),
};

const candidateFacePresenceSchema = {
  ...tokenParam,
  body: z.object({
    eventId: z.string().min(20).max(128),
    state: z.enum(['present', 'absent', 'unavailable']),
  }),
};

const candidateViolationSchema = {
  ...tokenParam,
  body: z.object({ eventId: z.string().min(20).max(128) }),
};

const finalTaskParam = {
  params: z.object({
    token: z.string().min(24).max(256),
    kind: z.enum(['reading', 'speaking']),
  }),
};

const finalTaskStartSchema = {
  ...finalTaskParam,
  body: z.object({}).strict().optional().default({}),
};

const finalTaskRecordingSchema = {
  ...finalTaskParam,
  body: z.object({
    durationSeconds: z.coerce.number().positive().max(1800),
  }),
};

module.exports = {
  tokenParam,
  contactCodeSchema,
  verifyContactCodeSchema,
  candidateSecuritySchema,
  startCandidateAttemptSchema,
  saveCandidateAnswerSchema,
  candidateSessionSchema,
  submitCandidateAttemptSchema,
  candidateDraftSchema,
  candidateIncidentSchema,
  candidateFacePresenceSchema,
  candidateViolationSchema,
  finalTaskParam,
  finalTaskStartSchema,
  finalTaskRecordingSchema,
};
