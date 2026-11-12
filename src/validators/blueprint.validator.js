const { z } = require('zod');

const SECTION_TYPES = ['MCQ_ONLY', 'WRITTEN_ONLY', 'BOTH'];
const QUESTION_TYPES = ['MCQ', 'WRITTEN'];
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];

// true/false, 1/0, "1"/"0"/"true"/"false" -> boolean
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
const sectionParam = {
  params: z.object({
    id: z.coerce.number().int().positive('Invalid id'),
    sectionId: z.coerce.number().int().positive('Invalid sectionId'),
  }),
};
const questionParam = {
  params: z.object({
    id: z.coerce.number().int().positive('Invalid id'),
    questionId: z.coerce.number().int().positive('Invalid questionId'),
  }),
};

// --- shared field fragments ---
const optionsField = z.array(z.string().trim().min(1).max(1000)).min(2, 'At least 2 options').max(8);
const marksField = posInt(10000);
const estTimeField = posInt(86400); // seconds
const rubricField = z.string().trim().max(5000);

// --- questions ---
const addQuestionSchema = {
  ...sectionParam,
  body: z
    .object({
      type: z.enum(QUESTION_TYPES),
      prompt: z.string().trim().min(1, 'Prompt is required').max(5000),
      options: optionsField.optional(),
      correctOption: z.coerce.number().int().min(0).optional(),
      modelAnswer: z.string().trim().max(10000).optional(),
      evaluationRubric: rubricField.optional(),
      marks: marksField.optional(),
      difficulty: z.enum(DIFFICULTIES).optional(),
      estimatedTimeSeconds: estTimeField.optional(),
    })
    .superRefine((d, ctx) => {
      if (d.type === 'MCQ') {
        if (!d.options) ctx.addIssue({ code: 'custom', path: ['options'], message: 'MCQ requires options' });
        if (d.correctOption === undefined)
          ctx.addIssue({ code: 'custom', path: ['correctOption'], message: 'MCQ requires correctOption' });
        if (d.options && d.correctOption !== undefined && d.correctOption > d.options.length - 1)
          ctx.addIssue({ code: 'custom', path: ['correctOption'], message: 'correctOption out of range' });
      }
    }),
};

const updateQuestionSchema = {
  ...questionParam,
  body: z
    .object({
      prompt: z.string().trim().min(1).max(5000).optional(),
      options: optionsField.optional(),
      correctOption: z.coerce.number().int().min(0).optional(),
      modelAnswer: z.string().trim().max(10000).nullable().optional(),
      evaluationRubric: rubricField.nullable().optional(),
      marks: marksField.nullable().optional(),
      difficulty: z.enum(DIFFICULTIES).nullable().optional(),
      estimatedTimeSeconds: estTimeField.nullable().optional(),
    })
    .refine(
      (d) =>
        ['prompt', 'options', 'correctOption', 'modelAnswer', 'evaluationRubric', 'marks', 'difficulty', 'estimatedTimeSeconds'].some(
          (k) => d[k] !== undefined
        ),
      { message: 'Provide at least one field to update' }
    ),
};

const questionApprovalSchema = {
  ...questionParam,
  body: z.object({ approved: boolish }),
};

// Bulk approve/unapprove every question in the assessment.
const questionsApprovalSchema = {
  ...assessmentParam,
  body: z.object({ approved: boolish }),
};

// --- sections ---
const sectionBody = z.object({
  name: z.string().trim().min(1, 'Section name is required').max(120),
  questionType: z.enum(SECTION_TYPES),
  mcqCount: posInt(100).default(0),
  writtenCount: posInt(100).default(0),
  aiGuidance: z.string().trim().max(2000).nullable().optional(),
  instructions: z.string().trim().max(5000).nullable().optional(),
  cutoff: posInt().nullable().optional(),
  order: posInt().optional(),
});

const addSectionSchema = {
  ...assessmentParam,
  body: sectionBody
    .refine((s) => (s.questionType === 'WRITTEN_ONLY' ? true : s.mcqCount >= 1), {
      message: 'mcqCount must be at least 1 for MCQ_ONLY / BOTH',
      path: ['mcqCount'],
    })
    .refine((s) => (s.questionType === 'MCQ_ONLY' ? true : s.writtenCount >= 1), {
      message: 'writtenCount must be at least 1 for WRITTEN_ONLY / BOTH',
      path: ['writtenCount'],
    }),
};

const updateSectionSchema = {
  ...sectionParam,
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      questionType: z.enum(SECTION_TYPES).optional(),
      mcqCount: posInt(100).optional(),
      writtenCount: posInt(100).optional(),
      aiGuidance: z.string().trim().max(2000).nullable().optional(),
      instructions: z.string().trim().max(5000).nullable().optional(),
      cutoff: posInt().nullable().optional(),
      order: posInt().optional(),
    })
    .refine(
      (d) =>
        ['name', 'questionType', 'mcqCount', 'writtenCount', 'aiGuidance', 'instructions', 'cutoff', 'order'].some(
          (k) => d[k] !== undefined
        ),
      { message: 'Provide at least one field to update' }
    ),
};

// --- timer ---
const timerSchema = {
  ...assessmentParam,
  body: z.object({ durationMinutes: z.coerce.number().int().positive('durationMinutes must be positive') }),
};
const timerApprovalSchema = {
  ...assessmentParam,
  body: z.object({ approved: boolish }),
};

// --- competencies & KRAs ---
const saveCompetenciesSchema = {
  ...assessmentParam,
  body: z.object({ competencies: z.array(z.string().trim().min(1).max(100)).max(100) }),
};
const saveKeyResultAreasSchema = {
  ...assessmentParam,
  body: z.object({
    keyResultAreas: z
      .array(
        z.object({
          title: z.string().trim().min(1, 'KRA title is required').max(200),
          description: z.string().trim().max(2000).nullable().optional(),
        })
      )
      .max(50),
  }),
};

// --- read-aloud task -------------------------------------------------------
const updateReadingTaskSchema = {
  ...assessmentParam,
  body: z
    .object({
      passage: z.string().trim().max(10000).optional(),
      maxMarks: z.coerce.number().int().min(1, 'maxMarks must be 1-100').max(100, 'maxMarks must be 1-100').optional(),
      readingWindowSeconds: z.coerce.number().int().min(30, 'window must be 30-600s').max(600, 'window must be 30-600s').optional(),
      aiSuggestedWindowSeconds: z.coerce.number().int().min(30).max(600).nullable().optional(),
    })
    .refine(
      (d) => ['passage', 'maxMarks', 'readingWindowSeconds', 'aiSuggestedWindowSeconds'].some((k) => d[k] !== undefined),
      { message: 'Provide at least one field to update' }
    ),
};
const generatePassageSchema = {
  ...assessmentParam,
  body: z.object({ mode: z.enum(['generate', 'reframe']).default('generate') }),
};
const readingApprovalSchema = {
  ...assessmentParam,
  body: z.object({ approved: boolish }),
};

// --- speaking task ---
const updateSpeakingTaskSchema = {
  ...assessmentParam,
  body: z
    .object({
      topic: z.string().trim().max(10000).optional(),
      maxMarks: z.coerce.number().int().min(1, 'maxMarks must be 1-100').max(100, 'maxMarks must be 1-100').optional(),
      speakingWindowSeconds: z.coerce.number().int().min(90, 'window must be 90-600s').max(600, 'window must be 90-600s').optional(),
      aiSuggestedWindowSeconds: z.coerce.number().int().min(90).max(600).nullable().optional(),
    })
    .refine(
      (d) => ['topic', 'maxMarks', 'speakingWindowSeconds', 'aiSuggestedWindowSeconds'].some((k) => d[k] !== undefined),
      { message: 'Provide at least one field to update' }
    ),
};
const generateTopicSchema = {
  ...assessmentParam,
  body: z.object({ mode: z.enum(['generate', 'reframe']).default('generate') }),
};
const speakingApprovalSchema = {
  ...assessmentParam,
  body: z.object({ approved: boolish }),
};


module.exports = {
  assessmentParam,
  sectionParam,
  questionParam,
  addQuestionSchema,
  updateQuestionSchema,
  questionApprovalSchema,
  questionsApprovalSchema,
  addSectionSchema,
  updateSectionSchema,
  timerSchema,
  timerApprovalSchema,
  saveCompetenciesSchema,
  saveKeyResultAreasSchema,
  updateReadingTaskSchema,
  generatePassageSchema,
  readingApprovalSchema,
  updateSpeakingTaskSchema,
  generateTopicSchema,
  speakingApprovalSchema,
};
