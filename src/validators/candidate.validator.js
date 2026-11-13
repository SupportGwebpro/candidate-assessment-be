const { z } = require('zod');

const SOURCES = ['SHARED', 'FRESH'];
const STATUSES = ['INVITED', 'IN_PROGRESS', 'COMPLETED'];
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];

const boolish = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  return v;
}, z.boolean());

const posInt = (max = 1000000) => z.coerce.number().int().min(0).max(max);

// --- param shapes ---
const assessmentParam = {
  params: z.object({ id: z.coerce.number().int().positive('Invalid id') }),
};
const candidateParam = {
  params: z.object({
    id: z.coerce.number().int().positive('Invalid id'),
    candidateId: z.coerce.number().int().positive('Invalid candidateId'),
  }),
};
const candidateQuestionParam = {
  params: z.object({
    id: z.coerce.number().int().positive('Invalid id'),
    candidateId: z.coerce.number().int().positive('Invalid candidateId'),
    cqId: z.coerce.number().int().positive('Invalid question id'),
  }),
};

// --- create assignment (the modified "add candidate" API) ---
const createAssignmentSchema = {
  ...assessmentParam,
  body: z.object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    email: z.string().trim().toLowerCase().email('A valid email is required'),
    phone: z.string().trim().min(3).max(32).optional(),
    questionSource: z.enum(SOURCES).default('SHARED'),
    status: z.enum(STATUSES).optional(),
  }),
};

const listCandidatesSchema = {
  ...assessmentParam,
  query: z.object({
    status: z.enum(STATUSES).optional(),
    source: z.enum(SOURCES).optional(),
  }),
};

// Global candidate list (across all assessments): search + filters + paging.
const listAllCandidatesSchema = {
  query: z.object({
    search: z.string().trim().max(200).optional(),
    status: z.enum(STATUSES).optional(),
    source: z.enum(SOURCES).optional(),
    assessmentId: z.coerce.number().int().positive().optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
    sortBy: z.enum(['createdAt', 'updatedAt', 'name', 'email', 'status']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }),
};

// --- candidate question review (fresh sets) ---
const updateCandidateQuestionSchema = {
  ...candidateQuestionParam,
  body: z
    .object({
      prompt: z.string().trim().min(1).max(5000).optional(),
      options: z.array(z.string().trim().min(1).max(1000)).min(2).max(8).optional(),
      correctOption: z.coerce.number().int().min(0).optional(),
      modelAnswer: z.string().trim().max(10000).nullable().optional(),
      evaluationRubric: z.string().trim().max(5000).nullable().optional(),
      marks: posInt(10000).nullable().optional(),
      difficulty: z.enum(DIFFICULTIES).nullable().optional(),
      estimatedTimeSeconds: posInt(86400).nullable().optional(),
    })
    .refine(
      (d) =>
        ['prompt', 'options', 'correctOption', 'modelAnswer', 'evaluationRubric', 'marks', 'difficulty', 'estimatedTimeSeconds'].some(
          (k) => d[k] !== undefined
        ),
      { message: 'Provide at least one field to update' }
    ),
};

// --- timer approval (independent, requires a note when approving) ---
const timerApprovalSchema = {
  ...candidateParam,
  body: z
    .object({
      approved: boolish,
      note: z.string().trim().max(2000).optional(),
      durationSeconds: z.coerce.number().int().positive('durationSeconds must be a positive number of seconds').optional(),
    })
    .refine((d) => d.approved !== true || (d.note && d.note.length > 0), {
      message: 'An approval note is required when approving the timer',
      path: ['note'],
    })
    .refine((d) => d.approved !== true || d.durationSeconds !== undefined, {
      message: 'durationSeconds is required when approving the timer',
      path: ['durationSeconds'],
    }),
};

module.exports = {
  assessmentParam,
  candidateParam,
  candidateQuestionParam,
  createAssignmentSchema,
  listCandidatesSchema,
  updateCandidateQuestionSchema,
  timerApprovalSchema,
  listAllCandidatesSchema,
};
