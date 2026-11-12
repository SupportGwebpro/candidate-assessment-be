const { z } = require('zod');

const LEVELS = ['JUNIOR', 'MID', 'SENIOR'];
const STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
const SECTION_TYPES = ['MCQ_ONLY', 'WRITTEN_ONLY', 'BOTH'];

const idParam = {
  params: z.object({
    id: z.coerce.number().int().positive('Invalid id'),
  }),
};

// Reject strings that aren't valid IANA time zones (e.g. "Asia/Kolkata").
const isValidTimezone = (tz) => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// Accepts true/false, 1/0, or "1"/"0"/"true"/"false" and yields a boolean.
const boolish = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  return v;
}, z.boolean());

const DEVICE_TYPES = ['DESKTOP', 'TABLET', 'MOBILE'];

const csvList = (maxLen = 120, maxItems = 200) =>
  z
    .preprocess(
      (v) => (typeof v === 'string' ? v.split(',') : v),
      z.array(z.string().trim().max(maxLen)).max(maxItems)
    )
    .transform((a) => [...new Set(a.map((s) => s.trim()).filter(Boolean))]);

const deviceTypesField = z
  .preprocess((v) => {
    const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : v;
    return Array.isArray(arr) ? arr.map((x) => (typeof x === 'string' ? x.trim().toUpperCase() : x)) : arr;
  }, z.array(z.enum(DEVICE_TYPES)).nonempty('At least one device type is required'))
  .transform((a) => [...new Set(a)]);

// Step 1 — create the draft. Only the role title is required; everything else is
// filled in across later wizard steps. (name defaults to the role in the service.)
const createAssessmentSchema = {
  body: z.object({
    role: z.string().trim().min(1, 'Role title is required').max(200),
    name: z.string().trim().min(1).max(200).optional(),
    level: z.enum(LEVELS).optional(),
    durationMinutes: z.coerce.number().int().positive().optional(),
    jobDescription: z.string().trim().max(50000).optional(),
    changeNote: z.string().trim().max(500).optional(),
  }),
};

// Steps 1-3 edits. All optional; at least one real field required.
const UPDATABLE = [
  'name', 'role', 'level', 'durationMinutes', 'jobDescription',
  'candidateInstructions', 'opensAt', 'closesAt', 'timezone',
  'eligibilityThreshold', 'saveAndResume',
];
const updateAssessmentSchema = {
  ...idParam,
  body: z
    .object({
      name: z.string().trim().min(1).max(200).optional(),
      role: z.string().trim().min(1).max(200).optional(),
      level: z.enum(LEVELS).nullable().optional(),
      durationMinutes: z.coerce.number().int().positive().nullable().optional(),
      jobDescription: z.string().trim().max(50000).nullable().optional(),
      candidateInstructions: z.string().trim().max(10000).nullable().optional(),
      opensAt: z.coerce.date().nullable().optional(),
      closesAt: z.coerce.date().nullable().optional(),
      timezone: z
        .string()
        .trim()
        .refine(isValidTimezone, 'Invalid IANA time zone')
        .nullable()
        .optional(),
      eligibilityThreshold: z.coerce.number().int().min(0).max(100).nullable().optional(),
      saveAndResume: z.boolean().optional(),
      changeNote: z.string().trim().max(500).optional(),
    })
    .refine((data) => UPDATABLE.some((k) => data[k] !== undefined), {
      message: 'Provide at least one field to update',
    })
    .refine(
      (data) =>
        !(data.opensAt && data.closesAt) || data.closesAt > data.opensAt,
      { message: 'closesAt must be after opensAt', path: ['closesAt'] }
    ),
};

const actionSchema = {
  ...idParam,
  body: z.object({
    changeNote: z.string().trim().max(500).optional(),
  }),
};

const listQuerySchema = {
  query: z.object({
    search: z.string().trim().max(200).optional(),
    level: z.enum(LEVELS).optional(),
    status: z.enum(STATUSES).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
    sortBy: z
      .enum(['createdAt', 'updatedAt', 'name', 'role', 'level', 'status', 'durationMinutes'])
      .default('updatedAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }),
};

const addCandidateSchema = {
  ...idParam,
  body: z.object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    email: z.string().trim().toLowerCase().email('A valid email is required'),
    status: z.enum(['INVITED', 'IN_PROGRESS', 'COMPLETED']).optional(),
  }),
};

// --- Wizard step 2: AI generation + saving selections ----------------------

const aiSkillsSchema = {
  ...idParam,
  body: z.object({
    count: z.coerce.number().int().min(3).max(30).optional(),
  }),
};

const aiSectionsSchema = { ...idParam };

const saveSkillsSchema = {
  ...idParam,
  body: z.object({
    skills: z.array(z.string().trim().min(1).max(100)).max(50),
  }),
};

const sectionInput = z
  .object({
    name: z.string().trim().min(1, 'Section name is required').max(120),
    questionType: z.enum(SECTION_TYPES),
    mcqCount: z.coerce.number().int().min(0).max(100).default(0),
    writtenCount: z.coerce.number().int().min(0).max(100).default(0),
    aiGuidance: z.string().trim().max(2000).nullable().optional(),
    order: z.coerce.number().int().min(0).optional(),
  })
  .refine((s) => (s.questionType === 'WRITTEN_ONLY' ? true : s.mcqCount >= 1), {
    message: 'mcqCount must be at least 1 for MCQ_ONLY / BOTH sections',
    path: ['mcqCount'],
  })
  .refine((s) => (s.questionType === 'MCQ_ONLY' ? true : s.writtenCount >= 1), {
    message: 'writtenCount must be at least 1 for WRITTEN_ONLY / BOTH sections',
    path: ['writtenCount'],
  });

const saveSectionsSchema = {
  ...idParam,
  body: z.object({
    sections: z.array(sectionInput).min(1, 'At least one section is required').max(20),
  }),
};

// --- Wizard step 3: Assessment Access -------------------------------------
const ACCESS_FIELDS = ['opensAt', 'closesAt', 'timezone', 'eligibilityThreshold', 'saveAndResume','allowedDeviceTypes', 'cities', 'regions', 'allowSectionSwitching'];

const accessSchema = {
  ...idParam,
  body: z
    .object({
      opensAt: z.coerce.date().optional(),
      closesAt: z.coerce.date().optional(),
      timezone: z.string().trim().refine(isValidTimezone, 'Invalid IANA time zone').optional(),
      eligibilityThreshold: z.coerce
        .number()
        .int('Threshold must be a whole percentage')
        .min(0, 'Threshold must be between 0 and 100')
        .max(100, 'Threshold must be between 0 and 100')
        .optional(),
      saveAndResume: boolish.optional(),
      allowedDeviceTypes: deviceTypesField.optional(),
      cities: csvList().optional(),
      regions: csvList().optional(),
      allowSectionSwitching: boolish.optional(),
      changeNote: z.string().trim().max(500).optional(),
    })
    .refine((d) => ACCESS_FIELDS.some((k) => d[k] !== undefined), {
      message: 'Provide at least one access field',
    })
    .refine((d) => !(d.opensAt && d.closesAt) || d.closesAt > d.opensAt, {
      message: 'closesAt must be after opensAt',
      path: ['closesAt'],
    }),
};

// --- Wizard step 4: generate blueprint -------------------------------------

const generateBlueprintSchema = {
  ...idParam,
  body: z.object({
    changeNote: z.string().trim().max(500).optional(),
  }),
};

module.exports = {
  idParam,
  createAssessmentSchema,
  updateAssessmentSchema,
  actionSchema,
  listQuerySchema,
  addCandidateSchema,
  aiSkillsSchema,
  aiSectionsSchema,
  saveSkillsSchema,
  saveSectionsSchema,
  accessSchema,
  generateBlueprintSchema,
};
