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

/// Suggest a read-aloud window from passage length (~84 wpm read-aloud pace),
/// clamped to 30–600s. Deterministic, so the UI's "matches AI suggests" is stable.
function computeReadingWindow(passage) {
  const words = String(passage || '').trim().split(/\s+/).filter(Boolean).length;
  const seconds = Math.round(words / 1.4);
  return Math.min(600, Math.max(30, seconds || 30));
}

/// Generate (or reframe) a short passage for the read-aloud task, plus a
/// suggested reading window. Returns { passage, suggestedWindowSeconds }.
async function generateReadingPassage({ roleTitle, jobDescription, level, skills = [], mode = 'generate', currentPassage }) {
  if (useMock()) {
    const roleLabel = [level ? level.toLowerCase() : '', roleTitle].filter(Boolean).join(' ').trim() || 'professional';
    const passage =
      mode === 'reframe' && currentPassage
        ? `In this role, you turn complex information into clear recommendations. ${String(currentPassage).replace(/\s+/g, ' ').trim().slice(0, 500)}`
        : `As a ${roleLabel}, you help teams make informed decisions by turning complex information into clear recommendations. In this role, you work with stakeholders to understand their needs, analyse data carefully, and communicate your findings in plain language so that everyone can act with confidence.`;
    return { passage, suggestedWindowSeconds: computeReadingWindow(passage) };
  }

  const system =
    'You write a short passage for a candidate to read aloud in an assessment. ' +
    'Respond ONLY with JSON {"passage": string}. 60-120 words, clear and professional, ' +
    'relevant to the role. No prose, no markdown.';
  const user =
    `Role: ${roleTitle}\nLevel: ${level || 'unspecified'}\n` +
    `Skills: ${skills.length ? skills.join(', ') : '(unspecified)'}\n` +
    `Job description:\n${jdSnippet(jobDescription)}\n\n` +
    (mode === 'reframe' && currentPassage
      ? `Reframe this passage, keeping the topic but improving clarity and flow:\n${currentPassage}\n\n`
      : '') +
    'Return {"passage": "..."}.';

  const data = await chatJSON({ system, user, temperature: mode === 'reframe' ? 0.5 : 0.7 });
  const passage = typeof data.passage === 'string' ? data.passage.trim() : '';
  return { passage, suggestedWindowSeconds: computeReadingWindow(passage) };
}

const DEFAULT_SPEAKING_WINDOW = 300;
const clampSpeakingWindow = (s) => Math.min(600, Math.max(90, Math.round(s) || DEFAULT_SPEAKING_WINDOW));

async function generateSpeakingTopic({ roleTitle, jobDescription, level, skills = [], mode = 'generate', currentTopic }) {
  if (useMock()) {
    const roleLabel = [level ? level.toLowerCase() : '', roleTitle].filter(Boolean).join(' ').trim() || 'professional';
    const topic =
      mode === 'reframe' && currentTopic
        ? `Speak to this prompt in your own words: ${String(currentTopic).replace(/\s+/g, ' ').trim().slice(0, 500)}`
        : `You are a ${roleLabel} supporting a company that has seen a sudden increase in customer complaints. Explain how you would investigate the root causes, what information you would gather, and how you would present your recommendations to stakeholders.`;
    return { topic, suggestedWindowSeconds: DEFAULT_SPEAKING_WINDOW };
  }
  const system =
    'You write a short speaking-task prompt for a candidate to speak about in an assessment. ' +
    'Respond ONLY with JSON {"topic": string}. 1-3 sentences, a realistic scenario relevant to ' +
    'the role that invites 1-5 minutes of spoken response. No prose, no markdown.';
  const user =
    `Role: ${roleTitle}\nLevel: ${level || 'unspecified'}\n` +
    `Skills: ${skills.length ? skills.join(', ') : '(unspecified)'}\n` +
    `Job description:\n${jdSnippet(jobDescription)}\n\n` +
    (mode === 'reframe' && currentTopic
      ? `Reframe this topic, keeping the intent but improving clarity:\n${currentTopic}\n\n`
      : '') +
    'Return {"topic": "..."}.';
  const data = await chatJSON({ system, user, temperature: mode === 'reframe' ? 0.5 : 0.7 });
  const topic = typeof data.topic === 'string' ? data.topic.trim() : '';
  return { topic, suggestedWindowSeconds: clampSpeakingWindow(DEFAULT_SPEAKING_WINDOW) };
}


module.exports = {
  useMock,
  generateSkills,
  generateSections,
  generateSectionQuestions,
  generateQuestion,
  generateReadingPassage,
  computeReadingWindow,
  generateSpeakingTopic,
};
