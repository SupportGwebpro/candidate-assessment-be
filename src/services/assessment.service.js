const prisma = require('../lib/prisma');
const { notFound, conflict, badRequest } = require('../utils/http');
const ai = require('./ai.service');
const { extractText } = require('../utils/extractText');

/// Append an immutable version snapshot of the assessment's current fields.
/// Runs inside the same transaction as the change that produced it.
async function snapshot(tx, assessment, action, adminId, changeNote) {
  const agg = await tx.assessmentVersion.aggregate({
    where: { assessmentId: assessment.id },
    _max: { versionNumber: true },
  });
  const versionNumber = (agg._max.versionNumber || 0) + 1;

  return tx.assessmentVersion.create({
    data: {
      assessmentId: assessment.id,
      versionNumber,
      name: assessment.name,
      role: assessment.role,
      level: assessment.level,
      status: assessment.status,
      durationMinutes: assessment.durationMinutes,
      action,
      changeNote: changeNote || null,
      createdById: adminId,
    },
  });
}

// Columns returned for list rows — deliberately excludes large text
// (jobDescription, candidateInstructions) so the list stays lean.
const listSelect = {
  id: true, name: true, role: true, level: true, status: true,
  durationMinutes: true, jobDescriptionFileName: true,
  opensAt: true, closesAt: true, timezone: true,
  eligibilityThreshold: true, saveAndResume: true, blueprintGeneratedAt: true,
  publishedAt: true, archivedAt: true, createdAt: true, updatedAt: true,
  _count: { select: { candidates: true, skills: true, sections: true, questions: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
};

const serialize = (a) => ({
  id: a.id,
  name: a.name,
  role: a.role,
  level: a.level,
  status: a.status,
  durationMinutes: a.durationMinutes,
  candidateCount: a._count ? a._count.candidates : undefined,
  skillCount: a._count ? a._count.skills : undefined,
  sectionCount: a._count ? a._count.sections : undefined,
  questionCount: a._count ? a._count.questions : undefined,
  jobDescriptionFileName: a.jobDescriptionFileName ?? null,
  opensAt: a.opensAt ?? null,
  closesAt: a.closesAt ?? null,
  timezone: a.timezone ?? null,
  eligibilityThreshold: a.eligibilityThreshold ?? null,
  saveAndResume: a.saveAndResume ?? false,
  blueprintGeneratedAt: a.blueprintGeneratedAt ?? null,
  publishedAt: a.publishedAt,
  archivedAt: a.archivedAt,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
  createdBy: a.createdBy || undefined,
  latestVersion: a.versions && a.versions.length ? a.versions[0] : undefined,
});

/// Load an assessment or throw 404.
async function findOrThrow(id) {
  const assessment = await prisma.assessment.findUnique({ where: { id } });
  if (!assessment) throw notFound('Assessment not found');
  return assessment;
}

function ensureEditable(a) {
  if (a.status === 'ARCHIVED') {
    throw conflict('Restore this assessment before editing it');
  }
}

/// List with search (name/role), level + status filters, sorting and paging.
/// Candidate counts and the latest version summary are included per row and
/// always reflect current records.
async function list(params) {
  const { search, level, status, page, pageSize, sortBy, sortOrder } = params;

  const where = {};
  if (status) where.status = status;
  if (level) where.level = level;
  if (search) {
    where.OR = [{ name: { contains: search } }, { role: { contains: search } }];
  }

  const [rows, total] = await prisma.$transaction([
    prisma.assessment.findMany({
      where,
      select: listSelect,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.assessment.count({ where }),
  ]);

  return {
    items: rows.map(serialize),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

/// Full detail for the step-4 review: config, selected skills, sections (with
/// per-section question counts) and the complete version history.
async function getById(id) {
  const a = await prisma.assessment.findUnique({
    where: { id },
    include: {
      _count: { select: { candidates: true, skills: true, sections: true, questions: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      versions: { orderBy: { versionNumber: 'desc' } },
      skills: { orderBy: { name: 'asc' } },
      sections: {
        orderBy: { order: 'asc' },
        include: { _count: { select: { questions: true } } },
      },
    },
  });
  if (!a) throw notFound('Assessment not found');

  return {
    ...serialize(a),
    jobDescription: a.jobDescription ?? null,
    candidateInstructions: a.candidateInstructions ?? null,
    skills: a.skills,
    sections: a.sections,
    versions: a.versions,
  };
}

// --- Step 1: create + job-description file ----------------------------------

async function create(data, adminId) {
  const { changeNote, ...fields } = data;
  if (!fields.name) fields.name = fields.role; // name defaults to the role title
  return prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.create({
      data: { ...fields, status: 'DRAFT', createdById: adminId },
    });
    await snapshot(tx, assessment, 'CREATE', adminId, changeNote);
    return serialize(assessment);
  });
}

/// Extract text from an uploaded PDF/DOC/DOCX and store it as the job
/// description (wizard step 1 "upload" path).
async function attachJobDescriptionFile(id, file, adminId) {
  const existing = await findOrThrow(id);
  ensureEditable(existing);

  const text = await extractText(file.buffer, file.originalname);
  if (!text) {
    throw badRequest('No readable text could be extracted from that file');
  }

  const result = await prisma.$transaction(async (tx) => {
    const a = await tx.assessment.update({
      where: { id },
      data: { jobDescription: text, jobDescriptionFileName: file.originalname },
    });
    await snapshot(tx, a, 'EDIT', adminId, `Job description from ${file.originalname}`);
    return a;
  });

  return {
    ...serialize(result),
    jobDescriptionFileName: result.jobDescriptionFileName,
    jobDescription: text,
    extractedChars: text.length,
  };
}

async function update(id, data, adminId) {
  const existing = await findOrThrow(id);
  ensureEditable(existing);

  const { changeNote, ...fields } = data;
  return prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.update({ where: { id }, data: fields });
    await snapshot(tx, assessment, 'EDIT', adminId, changeNote);
    return serialize(assessment);
  });
}

// --- Step 2: skills ---------------------------------------------------------

async function generateSkills(id, count) {
  const a = await findOrThrow(id);
  const skills = await ai.generateSkills({
    roleTitle: a.role,
    jobDescription: a.jobDescription,
    level: a.level,
    count,
  });
  return { skills, mock: ai.useMock() };
}

async function saveSkills(id, skills) {
  const existing = await findOrThrow(id);
  ensureEditable(existing);

  // Trim + de-duplicate case-insensitively, preserving first-seen casing.
  const unique = [
    ...new Map(
      skills.map((s) => s.trim()).filter(Boolean).map((s) => [s.toLowerCase(), s])
    ).values(),
  ];

  return prisma.$transaction(async (tx) => {
    await tx.assessmentSkill.deleteMany({ where: { assessmentId: id } });
    if (unique.length) {
      await tx.assessmentSkill.createMany({
        data: unique.map((name) => ({ assessmentId: id, name })),
      });
    }
    return tx.assessmentSkill.findMany({ where: { assessmentId: id }, orderBy: { name: 'asc' } });
  });
}

async function listSkills(id) {
  await findOrThrow(id);
  return prisma.assessmentSkill.findMany({ where: { assessmentId: id }, orderBy: { name: 'asc' } });
}

// --- Step 2: sections -------------------------------------------------------

async function generateSections(id) {
  const a = await findOrThrow(id);
  const skills = await prisma.assessmentSkill.findMany({ where: { assessmentId: id } });
  const sections = await ai.generateSections({
    roleTitle: a.role,
    jobDescription: a.jobDescription,
    level: a.level,
    skills: skills.map((s) => s.name),
  });
  return { sections, mock: ai.useMock() };
}

async function saveSections(id, sections) {
  const existing = await findOrThrow(id);
  ensureEditable(existing);

  return prisma.$transaction(async (tx) => {
    // Replacing sections cascades away their questions and invalidates the blueprint.
    await tx.assessmentSection.deleteMany({ where: { assessmentId: id } });
    await tx.assessmentSection.createMany({
      data: sections.map((s, i) => ({
        assessmentId: id,
        name: s.name,
        questionType: s.questionType,
        mcqCount: s.mcqCount,
        writtenCount: s.writtenCount,
        aiGuidance: s.aiGuidance ?? null,
        order: s.order ?? i,
      })),
    });
    await tx.assessment.update({ where: { id }, data: { blueprintGeneratedAt: null } });
    return tx.assessmentSection.findMany({ where: { assessmentId: id }, orderBy: { order: 'asc' } });
  });
}

async function listSections(id) {
  await findOrThrow(id);
  return prisma.assessmentSection.findMany({ where: { assessmentId: id }, orderBy: { order: 'asc' } });
}

// --- Step 3: assessment access ----------------------------------------------

/// Configure the access step: open/close window, timezone, eligibility
/// threshold (percentage) and save-and-resume. Validates the open/close window
/// against stored values too, so a partial update can't leave closesAt <= opensAt.
async function setAccess(id, data, adminId) {
  const existing = await findOrThrow(id);
  ensureEditable(existing);

  const { changeNote, ...fields } = data;
  const opensAt = fields.opensAt !== undefined ? fields.opensAt : existing.opensAt;
  const closesAt = fields.closesAt !== undefined ? fields.closesAt : existing.closesAt;
  if (opensAt && closesAt && closesAt <= opensAt) {
    throw badRequest('closesAt must be after opensAt');
  }

  return prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.update({ where: { id }, data: fields });
    await snapshot(tx, assessment, 'EDIT', adminId, changeNote || 'Updated access settings');
    return serialize(assessment);
  });
}

// --- Step 4: generate blueprint --------------------------------------------

async function generateBlueprint(id, adminId, changeNote) {
  const a = await findOrThrow(id);
  ensureEditable(a);

  const sections = await prisma.assessmentSection.findMany({
    where: { assessmentId: id },
    orderBy: { order: 'asc' },
  });
  if (!sections.length) {
    throw conflict('Add at least one section before generating the blueprint');
  }
  const skills = (await prisma.assessmentSkill.findMany({ where: { assessmentId: id } })).map(
    (s) => s.name
  );

  // AI calls happen OUTSIDE the transaction (network work), one per section.
  const generated = [];
  for (const section of sections) {
    const { mcqs, written } = await ai.generateSectionQuestions({
      roleTitle: a.role,
      jobDescription: a.jobDescription,
      level: a.level,
      skills,
      section,
    });
    generated.push({ section, mcqs, written });
  }

  // Persist atomically.
  await prisma.$transaction(
    async (tx) => {
      await tx.assessmentQuestion.deleteMany({ where: { assessmentId: id } });
      for (const { section, mcqs, written } of generated) {
        const rows = [];
        let order = 0;
        for (const q of mcqs) {
          rows.push({
            assessmentId: id, sectionId: section.id, type: 'MCQ',
            prompt: q.prompt, options: q.options, correctOption: q.correctOption, order: order++,
          });
        }
        for (const q of written) {
          rows.push({
            assessmentId: id, sectionId: section.id, type: 'WRITTEN',
            prompt: q.prompt, modelAnswer: q.modelAnswer ?? null, order: order++,
          });
        }
        if (rows.length) await tx.assessmentQuestion.createMany({ data: rows });
      }
      const updated = await tx.assessment.update({
        where: { id },
        data: { blueprintGeneratedAt: new Date() },
      });
      await snapshot(tx, updated, 'GENERATE', adminId, changeNote || 'Generated AI blueprint');
    },
    { timeout: 20000 }
  );

  return getBlueprint(id);
}

async function getBlueprint(id) {
  await findOrThrow(id);
  const [meta, sections] = await Promise.all([
    prisma.assessment.findUnique({ where: { id }, select: { blueprintGeneratedAt: true } }),
    prisma.assessmentSection.findMany({
      where: { assessmentId: id },
      orderBy: { order: 'asc' },
      include: { questions: { orderBy: { order: 'asc' } } },
    }),
  ]);
  return { blueprintGeneratedAt: meta.blueprintGeneratedAt, sections };
}

// --- Lifecycle (unchanged) --------------------------------------------------

async function publish(id, adminId, changeNote) {
  const existing = await findOrThrow(id);
  if (existing.status === 'ARCHIVED') {
    throw conflict('Restore this assessment before publishing it');
  }
  if (existing.status === 'PUBLISHED') {
    throw conflict('Assessment is already published');
  }

  return prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    await snapshot(tx, assessment, 'PUBLISH', adminId, changeNote);
    return serialize(assessment);
  });
}

async function archive(id, adminId, changeNote) {
  const existing = await findOrThrow(id);
  if (existing.status === 'ARCHIVED') {
    throw conflict('Assessment is already archived');
  }

  return prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.update({
      where: { id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await snapshot(tx, assessment, 'ARCHIVE', adminId, changeNote);
    return serialize(assessment);
  });
}

/// Restore an archived assessment to the status it held before archiving
/// (falling back to DRAFT). There is no permanent-delete counterpart — archive
/// is always reversible.
async function restore(id, adminId, changeNote) {
  const existing = await findOrThrow(id);
  if (existing.status !== 'ARCHIVED') {
    throw conflict('Only archived assessments can be restored');
  }

  const priorVersion = await prisma.assessmentVersion.findFirst({
    where: { assessmentId: id, status: { in: ['DRAFT', 'PUBLISHED'] } },
    orderBy: { versionNumber: 'desc' },
  });
  const targetStatus = priorVersion ? priorVersion.status : 'DRAFT';

  return prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.update({
      where: { id },
      data: {
        status: targetStatus,
        archivedAt: null,
        publishedAt:
          targetStatus === 'PUBLISHED' ? existing.publishedAt || new Date() : existing.publishedAt,
      },
    });
    await snapshot(tx, assessment, 'RESTORE', adminId, changeNote);
    return serialize(assessment);
  });
}

async function listVersions(id) {
  await findOrThrow(id);
  return prisma.assessmentVersion.findMany({
    where: { assessmentId: id },
    orderBy: { versionNumber: 'desc' },
    include: { createdBy: { select: { id: true, name: true, email: true } } },
  });
}

// Candidate logic moved to candidate.service.js (assignment module). The
// Candidate relation still backs the list's candidateCount via _count.

module.exports = {
  list,
  getById,
  create,
  attachJobDescriptionFile,
  update,
  generateSkills,
  saveSkills,
  listSkills,
  generateSections,
  saveSections,
  listSections,
  setAccess,
  generateBlueprint,
  getBlueprint,
  publish,
  archive,
  restore,
  listVersions,
};
