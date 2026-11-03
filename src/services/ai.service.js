const env = require('../config/env');
const { chatJSON } = require('../lib/deepseek');

const SECTION_TYPES = ['MCQ_ONLY', 'WRITTEN_ONLY', 'BOTH'];

/// Use deterministic sample data when explicitly mocked, or when no API key is
/// set outside production (so the wizard is testable locally without DeepSeek).
const useMock = () =>
  env.deepseek.mock || (!env.deepseek.apiKey && env.nodeEnv !== 'production');

const clampInt = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const jdSnippet = (jd) => (jd ? String(jd).slice(0, 6000) : '(none provided)');

// ---------------------------------------------------------------------------
// Skills (step 2)
// ---------------------------------------------------------------------------
async function generateSkills({ roleTitle, jobDescription, level, count = 12 }) {
  const want = clampInt(count, 3, 30, 12);

  if (useMock()) {
    const base = [
      'Problem Solving', 'Communication', 'Data Structures', 'Algorithms',
      'System Design', 'Debugging', 'Testing', 'Collaboration',
      'Time Management', 'Code Review', 'API Design', 'Databases',
    ];
    return base.slice(0, want).map((name) => ({ name, source: 'mock' }));
  }

  const system =
    'You are an expert technical recruiter. Propose relevant assessment skills for a role. ' +
    'Respond ONLY with a JSON object of the form {"skills": string[]}. No prose.';
  const user =
    `Role title: ${roleTitle}\n` +
    `Experience level: ${level || 'unspecified'}\n` +
    `Job description:\n${jdSnippet(jobDescription)}\n\n` +
    `Return about ${want} concise, distinct skills as a JSON object {"skills": [...]}.`;

  const data = await chatJSON({ system, user, temperature: 0.3 });
  const skills = Array.isArray(data.skills) ? data.skills : [];
  return skills
    .map((s) => (typeof s === 'string' ? s : s && s.name))
    .filter((s) => typeof s === 'string' && s.trim())
    .slice(0, want)
    .map((name) => ({ name: name.trim(), source: 'deepseek' }));
}

// ---------------------------------------------------------------------------
// Sections (step 2)
// ---------------------------------------------------------------------------
function normalizeSection(s) {
  const type = SECTION_TYPES.includes(s.questionType) ? s.questionType : 'BOTH';
  return {
    name: String(s.name || 'Section').trim().slice(0, 120),
    questionType: type,
    mcqCount: type === 'WRITTEN_ONLY' ? 0 : clampInt(s.mcqCount, 0, 100, 5),
    writtenCount: type === 'MCQ_ONLY' ? 0 : clampInt(s.writtenCount, 0, 100, 2),
    aiGuidance: s.aiGuidance ? String(s.aiGuidance).slice(0, 2000) : null,
  };
}

async function generateSections({ roleTitle, jobDescription, skills = [], level }) {
  if (useMock()) {
    return [
      { name: 'Quantitative', questionType: 'MCQ_ONLY', mcqCount: 8, writtenCount: 0, aiGuidance: 'Numerical reasoning and data interpretation.' },
      { name: 'Communication', questionType: 'WRITTEN_ONLY', mcqCount: 0, writtenCount: 2, aiGuidance: 'Written clarity and stakeholder communication.' },
      { name: 'Logical', questionType: 'BOTH', mcqCount: 6, writtenCount: 1, aiGuidance: 'Pattern recognition and structured reasoning.' },
    ].map(normalizeSection);
  }

  const system =
    'You are an assessment designer. Propose assessment sections for a role, such as ' +
    'Quantitative, Communication, Logical, plus role-specific ones. ' +
    'Respond ONLY with JSON: {"sections":[{"name":string,"questionType":"MCQ_ONLY"|"WRITTEN_ONLY"|"BOTH",' +
    '"mcqCount":number,"writtenCount":number,"aiGuidance":string}]}. No prose.';
  const user =
    `Role title: ${roleTitle}\n` +
    `Experience level: ${level || 'unspecified'}\n` +
    `Selected skills: ${skills.length ? skills.join(', ') : '(none yet)'}\n` +
    `Job description:\n${jdSnippet(jobDescription)}\n\n` +
    'Return 3-6 sections as the JSON object described. Counts should suit the level.';

  const data = await chatJSON({ system, user, temperature: 0.4 });
  const sections = Array.isArray(data.sections) ? data.sections : [];
  return sections.map(normalizeSection);
}

// ---------------------------------------------------------------------------
// Blueprint questions for one section (step 4)
// ---------------------------------------------------------------------------
function mockMcqs(section, n) {
  return Array.from({ length: n }, (_, i) => ({
    prompt: `[${section.name}] Sample MCQ #${i + 1}`,
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correctOption: i % 4,
  }));
}
function mockWritten(section, n) {
  return Array.from({ length: n }, (_, i) => ({
    prompt: `[${section.name}] Sample written question #${i + 1}`,
    modelAnswer: 'A strong answer addresses the key points clearly and concisely.',
  }));
}

function normalizeMcq(q) {
  const options = Array.isArray(q.options)
    ? q.options.map((o) => String(o)).slice(0, 8)
    : [];
  let correct = clampInt(q.correctOption, 0, Math.max(0, options.length - 1), 0);
  if (options.length < 2) return null;
  return { prompt: String(q.prompt || '').trim(), options, correctOption: correct };
}
function normalizeWritten(q) {
  const prompt = String(q.prompt || '').trim();
  if (!prompt) return null;
  return { prompt, modelAnswer: q.modelAnswer ? String(q.modelAnswer) : null };
}

async function generateSectionQuestions({ roleTitle, jobDescription, level, skills = [], section }) {
  const mcqN = section.questionType === 'WRITTEN_ONLY' ? 0 : section.mcqCount;
  const writtenN = section.questionType === 'MCQ_ONLY' ? 0 : section.writtenCount;

  if (useMock()) {
    return { mcqs: mockMcqs(section, mcqN), written: mockWritten(section, writtenN) };
  }

  const system =
    'You are an assessment author. Write high-quality questions for one section. ' +
    'Respond ONLY with JSON: {"mcqs":[{"prompt":string,"options":string[],"correctOption":number}],' +
    '"written":[{"prompt":string,"modelAnswer":string}]}. ' +
    'MCQ options must be plausible; correctOption is the 0-based index. No prose.';
  const user =
    `Role title: ${roleTitle}\n` +
    `Experience level: ${level || 'unspecified'}\n` +
    `Skills: ${skills.length ? skills.join(', ') : '(unspecified)'}\n` +
    `Section: ${section.name}\n` +
    `AI guidance: ${section.aiGuidance || '(none)'}\n` +
    `Job description:\n${jdSnippet(jobDescription)}\n\n` +
    `Produce exactly ${mcqN} MCQ question(s) and ${writtenN} written question(s) ` +
    'as the JSON object described.';

  const data = await chatJSON({ system, user, temperature: 0.6, maxTokens: 6000 });
  const mcqs = (Array.isArray(data.mcqs) ? data.mcqs : [])
    .map(normalizeMcq).filter(Boolean).slice(0, mcqN);
  const written = (Array.isArray(data.written) ? data.written : [])
    .map(normalizeWritten).filter(Boolean).slice(0, writtenN);
  return { mcqs, written };
}

/// Generate a single question of a given type, reusing the section context.
async function generateQuestion({ roleTitle, jobDescription, level, skills = [], section, type }) {
  const oneConfig = {
    name: section.name,
    aiGuidance: section.aiGuidance,
    questionType: type === 'MCQ' ? 'MCQ_ONLY' : 'WRITTEN_ONLY',
    mcqCount: type === 'MCQ' ? 1 : 0,
    writtenCount: type === 'WRITTEN' ? 1 : 0,
  };
  const { mcqs, written } = await generateSectionQuestions({
    roleTitle, jobDescription, level, skills, section: oneConfig,
  });
  return type === 'MCQ' ? mcqs[0] || null : written[0] || null;
}

module.exports = {
  useMock,
  generateSkills,
  generateSections,
  generateSectionQuestions,
  generateQuestion,
};
