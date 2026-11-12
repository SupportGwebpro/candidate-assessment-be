const prisma = require('../lib/prisma');
const { notFound, conflict, badRequest, HttpError } = require('../utils/http');
const ai = require('./ai.service');

// --- lookups ---------------------------------------------------------------

async function findAssessment(id) {
  const a = await prisma.assessment.findUnique({ where: { id } });
  if (!a) throw notFound('Assessment not found');
  return a;
}
function ensureEditable(a) {
  if (a.status === 'ARCHIVED') throw conflict('Restore this assessment before editing it');
}
async function findSection(id, sectionId) {
  const s = await prisma.assessmentSection.findFirst({ where: { id: sectionId, assessmentId: id } });
  if (!s) throw notFound('Section not found for this assessment');
  return s;
}
async function findQuestion(id, questionId) {
  const q = await prisma.assessmentQuestion.findFirst({ where: { id: questionId, assessmentId: id } });
  if (!q) throw notFound('Question not found for this assessment');
  return q;
}
async function nextOrder(where) {
  const agg = await prisma.assessmentQuestion.aggregate({ where, _max: { order: true } });
  return (agg._max.order || 0) + 1;
}

// --- questions -------------------------------------------------------------

async function addQuestion(id, sectionId, data, adminId) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const section = await findSection(id, sectionId);

  const base = {
    assessmentId: id,
    sectionId: section.id,
    type: data.type,
    prompt: data.prompt,
    evaluationRubric: data.evaluationRubric ?? null,
    marks: data.marks ?? null,
    difficulty: data.difficulty ?? null,
    estimatedTimeSeconds: data.estimatedTimeSeconds ?? null,
    order: await nextOrder({ sectionId: section.id }),
    approved: false,
  };
  if (data.type === 'MCQ') {
    base.options = data.options;
    base.correctOption = data.correctOption;
  } else {
    base.modelAnswer = data.modelAnswer ?? null;
  }
  return prisma.assessmentQuestion.create({ data: base });
}

async function updateQuestion(id, questionId, data, adminId) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const q = await findQuestion(id, questionId);

  if (q.type === 'MCQ') {
    const options = data.options !== undefined ? data.options : q.options;
    const correct = data.correctOption !== undefined ? data.correctOption : q.correctOption;
    if (Array.isArray(options) && correct != null && correct > options.length - 1) {
      throw badRequest('correctOption is out of range for the options');
    }
  } else if (data.options !== undefined || data.correctOption !== undefined) {
    throw badRequest('options / correctOption apply only to MCQ questions');
  }

  const { ...fields } = data;
  // Any content edit resets this question's approval (independent of timer).
  return prisma.assessmentQuestion.update({
    where: { id: q.id },
    data: { ...fields, approved: false, approvedAt: null, approvedById: null },
  });
}

async function deleteQuestion(id, questionId) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const q = await findQuestion(id, questionId);
  await prisma.assessmentQuestion.delete({ where: { id: q.id } });
  return { deleted: true, id: q.id };
}

async function regenerateQuestion(id, questionId) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const q = await findQuestion(id, questionId);
  const section = await findSection(id, q.sectionId);
  const skills = (await prisma.assessmentSkill.findMany({ where: { assessmentId: id } })).map((s) => s.name);

  const generated = await ai.generateQuestion({
    roleTitle: a.role, jobDescription: a.jobDescription, level: a.level, skills, section, type: q.type,
  });
  if (!generated) throw new HttpError(502, 'AI did not return a question', 'AI_BAD_RESPONSE');

  const data = { approved: false, approvedAt: null, approvedById: null, prompt: generated.prompt };
  if (q.type === 'MCQ') {
    data.options = generated.options;
    data.correctOption = generated.correctOption;
  } else {
    data.modelAnswer = generated.modelAnswer ?? null;
  }
  return prisma.assessmentQuestion.update({ where: { id: q.id }, data });
}

/// Approve / unapprove a single question (independent control).
async function setQuestionApproval(id, questionId, approved, adminId) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const q = await findQuestion(id, questionId);
  return prisma.assessmentQuestion.update({
    where: { id: q.id },
    data: {
      approved,
      approvedAt: approved ? new Date() : null,
      approvedById: approved ? adminId : null,
    },
  });
}

/// Approve / unapprove EVERY question in the assessment at once. Returns the
/// approvals summary so the caller sees the resulting counts and readiness.
async function setAllQuestionsApproval(id, approved, adminId) {
  const a = await findAssessment(id);
  ensureEditable(a);

  const total = await prisma.assessmentQuestion.count({ where: { assessmentId: id } });
  if (total === 0) throw conflict('This assessment has no blueprint questions to approve');

  await prisma.assessmentQuestion.updateMany({
    where: { assessmentId: id },
    data: {
      approved,
      approvedAt: approved ? new Date() : null,
      approvedById: approved ? adminId : null,
    },
  });
  return getApprovals(id);
}

// --- sections --------------------------------------------------------------

async function addSection(id, data, adminId) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const agg = await prisma.assessmentSection.aggregate({
    where: { assessmentId: id }, _max: { order: true },
  });
  const order = data.order ?? (agg._max.order || 0) + 1;
  return prisma.assessmentSection.create({
    data: {
      assessmentId: id,
      name: data.name,
      questionType: data.questionType,
      mcqCount: data.mcqCount,
      writtenCount: data.writtenCount,
      aiGuidance: data.aiGuidance ?? null,
      instructions: data.instructions ?? null,
      cutoff: data.cutoff ?? null,
      order,
    },
  });
}

async function updateSection(id, sectionId, data, adminId) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const section = await findSection(id, sectionId);
  return prisma.assessmentSection.update({ where: { id: section.id }, data });
}

async function deleteSection(id, sectionId) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const section = await findSection(id, sectionId);
  await prisma.assessmentSection.delete({ where: { id: section.id } }); // questions cascade
  return { deleted: true, id: section.id };
}

async function regenerateSection(id, sectionId) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const section = await findSection(id, sectionId);
  const skills = (await prisma.assessmentSkill.findMany({ where: { assessmentId: id } })).map((s) => s.name);

  const { mcqs, written } = await ai.generateSectionQuestions({
    roleTitle: a.role, jobDescription: a.jobDescription, level: a.level, skills, section,
  });

  await prisma.$transaction(async (tx) => {
    await tx.assessmentQuestion.deleteMany({ where: { sectionId: section.id } });
    const rows = [];
    let order = 0;
    for (const q of mcqs) {
      rows.push({ assessmentId: id, sectionId: section.id, type: 'MCQ', prompt: q.prompt, options: q.options, correctOption: q.correctOption, order: order++, approved: false });
    }
    for (const q of written) {
      rows.push({ assessmentId: id, sectionId: section.id, type: 'WRITTEN', prompt: q.prompt, modelAnswer: q.modelAnswer ?? null, order: order++, approved: false });
    }
    if (rows.length) await tx.assessmentQuestion.createMany({ data: rows });
    await tx.assessment.update({ where: { id }, data: { blueprintGeneratedAt: new Date() } });
  });

  return prisma.assessmentSection.findUnique({
    where: { id: section.id },
    include: { questions: { orderBy: { order: 'asc' } } },
  });
}

// --- overall timer ---------------------------------------------------------

/// Change the overall timer (durationMinutes); this resets timer approval,
/// leaving all question approvals intact.
async function setTimer(id, durationMinutes, adminId) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const updated = await prisma.assessment.update({
    where: { id },
    data: { durationMinutes, timerApproved: false, timerApprovedAt: null, timerApprovedById: null },
  });
  return {
    id: updated.id,
    durationMinutes: updated.durationMinutes,
    timerApproved: updated.timerApproved,
    timerApprovedAt: updated.timerApprovedAt,
  };
}

/// Approve / unapprove the overall timer (independent control).
async function setTimerApproval(id, approved, adminId) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const updated = await prisma.assessment.update({
    where: { id },
    data: {
      timerApproved: approved,
      timerApprovedAt: approved ? new Date() : null,
      timerApprovedById: approved ? adminId : null,
    },
  });
  return {
    id: updated.id,
    durationMinutes: updated.durationMinutes,
    timerApproved: updated.timerApproved,
    timerApprovedAt: updated.timerApprovedAt,
  };
}

// --- competencies & KRAs (replace-set) -------------------------------------

async function listCompetencies(id) {
  await findAssessment(id);
  return prisma.assessmentCompetency.findMany({ where: { assessmentId: id }, orderBy: { name: 'asc' } });
}
async function saveCompetencies(id, names) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const unique = [...new Map(names.map((s) => s.trim()).filter(Boolean).map((s) => [s.toLowerCase(), s])).values()];
  return prisma.$transaction(async (tx) => {
    await tx.assessmentCompetency.deleteMany({ where: { assessmentId: id } });
    if (unique.length) await tx.assessmentCompetency.createMany({ data: unique.map((name) => ({ assessmentId: id, name })) });
    return tx.assessmentCompetency.findMany({ where: { assessmentId: id }, orderBy: { name: 'asc' } });
  });
}

async function listKeyResultAreas(id) {
  await findAssessment(id);
  return prisma.assessmentKeyResultArea.findMany({ where: { assessmentId: id }, orderBy: { title: 'asc' } });
}
async function saveKeyResultAreas(id, items) {
  const a = await findAssessment(id);
  ensureEditable(a);
  // de-duplicate by title (case-insensitive), keeping the last description given
  const map = new Map();
  for (const it of items) {
    const title = it.title.trim();
    if (title) map.set(title.toLowerCase(), { title, description: it.description ?? null });
  }
  const unique = [...map.values()];
  return prisma.$transaction(async (tx) => {
    await tx.assessmentKeyResultArea.deleteMany({ where: { assessmentId: id } });
    if (unique.length)
      await tx.assessmentKeyResultArea.createMany({
        data: unique.map((k) => ({ assessmentId: id, title: k.title, description: k.description })),
      });
    return tx.assessmentKeyResultArea.findMany({ where: { assessmentId: id }, orderBy: { title: 'asc' } });
  });
}

// --- read-aloud task -------------------------------------------------------
const EDITABLE_READING_FIELDS = ['passage', 'maxMarks', 'readingWindowSeconds', 'aiSuggestedWindowSeconds'];

async function getReadingTask(id) {
  await findAssessment(id);
  const t = await prisma.assessmentReadingTask.findUnique({ where: { assessmentId: id } });
  if (t) return { ...t, configured: true };
  return {
    assessmentId: id, passage: null, maxMarks: null, readingWindowSeconds: null,
    aiSuggestedWindowSeconds: null, approved: false, configured: false,
  };
}

async function updateReadingTask(id, data, adminId) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const fields = {};
  for (const k of EDITABLE_READING_FIELDS) if (data[k] !== undefined) fields[k] = data[k];
  const existing = await prisma.assessmentReadingTask.findUnique({ where: { assessmentId: id } });
  if (existing) {
    return prisma.assessmentReadingTask.update({
      where: { assessmentId: id },
      data: { ...fields, approved: false, approvedAt: null, approvedById: null },
    });
  }
  return prisma.assessmentReadingTask.create({
    data: {
      assessmentId: id,
      passage: fields.passage ?? null,
      maxMarks: fields.maxMarks ?? 10,
      readingWindowSeconds: fields.readingWindowSeconds ?? 60,
      aiSuggestedWindowSeconds: fields.aiSuggestedWindowSeconds ?? null,
    },
  });
}

async function generateReadingPassage(id, mode = 'generate') {
  const a = await findAssessment(id);
  let currentPassage = null;
  if (mode === 'reframe') {
    const t = await prisma.assessmentReadingTask.findUnique({ where: { assessmentId: id } });
    if (!t || !t.passage) throw conflict('There is no existing passage to reframe');
    currentPassage = t.passage;
  }
  const skills = (await prisma.assessmentSkill.findMany({ where: { assessmentId: id } })).map((s) => s.name);
  const result = await ai.generateReadingPassage({
    roleTitle: a.role, jobDescription: a.jobDescription, level: a.level, skills, mode, currentPassage,
  });
  return { ...result, mode, mock: ai.useMock() };
}

async function setReadingTaskApproval(id, approved, adminId) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const t = await prisma.assessmentReadingTask.findUnique({ where: { assessmentId: id } });
  if (!t) throw conflict('Configure the reading task before approving it');
  return prisma.assessmentReadingTask.update({
    where: { assessmentId: id },
    data: { approved, approvedAt: approved ? new Date() : null, approvedById: approved ? adminId : null },
  });
}

// --- speaking task ---
const EDITABLE_SPEAKING_FIELDS = ['topic', 'maxMarks', 'speakingWindowSeconds', 'aiSuggestedWindowSeconds'];

async function getSpeakingTask(id) {
  await findAssessment(id);
  const t = await prisma.assessmentSpeakingTask.findUnique({ where: { assessmentId: id } });
  if (t) return { ...t, configured: true };
  return {
    assessmentId: id, topic: null, maxMarks: null, speakingWindowSeconds: null,
    aiSuggestedWindowSeconds: null, approved: false, configured: false,
  };
}

async function updateSpeakingTask(id, data, adminId) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const fields = {};
  for (const k of EDITABLE_SPEAKING_FIELDS) if (data[k] !== undefined) fields[k] = data[k];
  const existing = await prisma.assessmentSpeakingTask.findUnique({ where: { assessmentId: id } });
  if (existing) {
    return prisma.assessmentSpeakingTask.update({
      where: { assessmentId: id },
      data: { ...fields, approved: false, approvedAt: null, approvedById: null },
    });
  }
  return prisma.assessmentSpeakingTask.create({
    data: {
      assessmentId: id,
      topic: fields.topic ?? null,
      maxMarks: fields.maxMarks ?? 10,
      speakingWindowSeconds: fields.speakingWindowSeconds ?? 300,
      aiSuggestedWindowSeconds: fields.aiSuggestedWindowSeconds ?? null,
    },
  });
}

async function generateSpeakingTopic(id, mode = 'generate') {
  const a = await findAssessment(id);
  let currentTopic = null;
  if (mode === 'reframe') {
    const t = await prisma.assessmentSpeakingTask.findUnique({ where: { assessmentId: id } });
    if (!t || !t.topic) throw conflict('There is no existing topic to reframe');
    currentTopic = t.topic;
  }
  const skills = (await prisma.assessmentSkill.findMany({ where: { assessmentId: id } })).map((s) => s.name);
  const result = await ai.generateSpeakingTopic({
    roleTitle: a.role, jobDescription: a.jobDescription, level: a.level, skills, mode, currentTopic,
  });
  return { ...result, mode, mock: ai.useMock() };
}

async function setSpeakingTaskApproval(id, approved, adminId) {
  const a = await findAssessment(id);
  ensureEditable(a);
  const t = await prisma.assessmentSpeakingTask.findUnique({ where: { assessmentId: id } });
  if (!t) throw conflict('Configure the speaking task before approving it');
  return prisma.assessmentSpeakingTask.update({
    where: { assessmentId: id },
    data: { approved, approvedAt: approved ? new Date() : null, approvedById: approved ? adminId : null },
  });
}

// --- approvals summary -----------------------------------------------------

async function getApprovals(id) {
  const a = await findAssessment(id);
  const sections = await prisma.assessmentSection.findMany({
    where: { assessmentId: id },
    orderBy: { order: 'asc' },
    include: { questions: { select: { id: true, approved: true } } },
  });

  let total = 0;
  let approved = 0;
  const sectionSummaries = sections.map((s) => {
    const t = s.questions.length;
    const ap = s.questions.filter((q) => q.approved).length;
    total += t;
    approved += ap;
    return { id: s.id, name: s.name, total: t, approved: ap, pending: t - ap };
  });

  return {
    assessmentId: id,
    timer: {
      durationMinutes: a.durationMinutes,
      approved: a.timerApproved,
      approvedAt: a.timerApprovedAt,
    },
    questions: { total, approved, pending: total - approved },
    sections: sectionSummaries,
    // Convenience flag for an optional publish gate (not enforced here).
    readyToPublish: a.timerApproved && total > 0 && total - approved === 0,
  };
}

module.exports = {
  addQuestion,
  updateQuestion,
  deleteQuestion,
  regenerateQuestion,
  setQuestionApproval,
  setAllQuestionsApproval,
  addSection,
  updateSection,
  deleteSection,
  regenerateSection,
  setTimer,
  setTimerApproval,
  listCompetencies,
  saveCompetencies,
  listKeyResultAreas,
  saveKeyResultAreas,
  getReadingTask,
  updateReadingTask,
  generateReadingPassage,
  setReadingTaskApproval,
  getApprovals,
  getSpeakingTask,
  updateSpeakingTask,
  generateSpeakingTopic,
  setSpeakingTaskApproval,
};
