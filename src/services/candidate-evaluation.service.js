const prisma = require('../lib/prisma');
const { notFound, conflict, badRequest } = require('../utils/http');

const attemptInclude = {
  answers: true,
  recordings: true,
  incidents: { orderBy: { occurredAt: 'asc' } },
};

async function findEvaluationCandidate(db, assessmentId, candidateId) {
  const candidate = await db.candidate.findFirst({
    where: { id: candidateId, assessmentId },
    include: {
      assessment: { select: { id: true, name: true, role: true } },
      questions: { orderBy: { order: 'asc' } },
      attempt: { include: attemptInclude },
    },
  });
  if (!candidate) throw notFound('Candidate not found for this assessment.');
  if (!candidate.attempt) throw conflict('This candidate has no assessment attempt to evaluate.');
  return candidate;
}

function assertSubmitted(candidate) {
  if (candidate.attempt.state === 'CANCELLED') {
    throw conflict('A cancelled assessment attempt cannot be evaluated.');
  }
  if (candidate.attempt.state !== 'SUBMITTED') {
    throw conflict('The assessment must be submitted before it can be evaluated.');
  }
}

function snapshotFor(candidate, kind) {
  const value = kind === 'reading' ? candidate.readingTaskSnapshot : candidate.speakingTaskSnapshot;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function serializeEvaluation(candidate) {
  const attempt = candidate.attempt;
  const answers = new Map(attempt.answers.map((answer) => [answer.candidateQuestionId, answer.answer]));
  const recordings = new Map(attempt.recordings.map((recording) => [recording.kind.toLowerCase(), recording]));
  const tasks = ['reading', 'speaking'].flatMap((kind) => {
    const snapshot = snapshotFor(candidate, kind);
    if (!snapshot) return [];
    const recording = recordings.get(kind);
    const status = kind === 'reading' ? attempt.readingStatus : attempt.speakingStatus;
    return [{
      kind,
      prompt: kind === 'reading' ? snapshot.passage ?? null : snapshot.topic ?? null,
      maxMarks: snapshot.maxMarks ?? null,
      status: status.toLowerCase(),
      recording: recording ? {
        contentType: recording.contentType,
        byteSize: recording.byteSize,
        durationSeconds: recording.durationSeconds,
        playbackUrl: `/candidates/${candidate.id}/attempt/recordings/${kind}`,
        awardedMarks: recording.awardedMarks,
        feedback: recording.evaluationFeedback,
      } : null,
    }];
  });

  const questions = candidate.questions.map((question) => {
    const answer = answers.get(question.id) ?? null;
    const options = Array.isArray(question.options) ? question.options : [];
    const correctAnswer = question.correctOption == null ? null : options[question.correctOption];
    const isCorrect = question.type === 'MCQ' && correctAnswer != null
      ? answer === String(correctAnswer)
      : null;
    return {
      questionId: question.id,
      sectionName: question.sectionName,
      type: question.type,
      prompt: question.prompt,
      options: question.options,
      correctOption: question.correctOption,
      modelAnswer: question.modelAnswer,
      rubric: question.evaluationRubric,
      maxMarks: question.marks ?? 1,
      answer,
      isCorrect,
      awardedMarks: question.type === 'MCQ'
        ? (isCorrect ? (question.marks ?? 1) : 0)
        : question.awardedMarks,
      feedback: question.evaluationFeedback,
    };
  });

  const complete = attempt.evaluationStatus === 'evaluated';
  return {
    candidate: {
      id: candidate.id,
      name: candidate.name,
      email: candidate.email,
      assessment: candidate.assessment,
    },
    attempt: {
      id: attempt.id,
      state: attempt.state.toLowerCase(),
      submittedAt: attempt.submittedAt,
      submissionReason: attempt.submissionReason,
      score: attempt.score,
      evaluationStatus: attempt.evaluationStatus,
      evaluationFeedback: attempt.evaluationFeedback,
      evaluatedAt: attempt.evaluatedAt,
      evaluatedById: attempt.evaluatedById,
      evaluationComplete: complete,
    },
    questions,
    tasks,
    incidents: attempt.incidents.map((incident) => ({
      type: incident.type,
      detail: incident.detail,
      occurredAt: incident.occurredAt,
    })),
    canEvaluate: attempt.state === 'SUBMITTED',
  };
}

function getTaskMaxMarks(candidate, kind) {
  const snapshot = snapshotFor(candidate, kind);
  const maxMarks = Number(snapshot?.maxMarks);
  return Number.isFinite(maxMarks) && maxMarks > 0 ? maxMarks : null;
}

function validateSubmittedMarks(candidate, input) {
  assertSubmitted(candidate);
  const questionById = new Map(candidate.questions.map((question) => [question.id, question]));
  for (const item of input.questionEvaluations || []) {
    const question = questionById.get(item.questionId);
    if (!question) throw badRequest(`Question ${item.questionId} does not belong to this candidate.`);
    if (question.type !== 'WRITTEN') throw badRequest('Only written questions can be manually evaluated.');
    if (item.awardedMarks !== null && item.awardedMarks > (question.marks ?? 1)) {
      throw badRequest(`Awarded marks cannot exceed the maximum for question ${question.id}.`);
    }
  }
  for (const item of input.taskEvaluations || []) {
    const recording = candidate.attempt.recordings.find((row) => row.kind === item.kind.toUpperCase());
    if (!snapshotFor(candidate, item.kind) || !recording) {
      throw badRequest(`There is no submitted ${item.kind} recording to evaluate.`);
    }
    const maxMarks = getTaskMaxMarks(candidate, item.kind);
    if (maxMarks === null) {
      throw conflict(`The ${item.kind} task has no valid maximum mark configured.`);
    }
    if (item.awardedMarks !== null && item.awardedMarks > maxMarks) {
      throw badRequest(`Awarded marks cannot exceed the maximum for the ${item.kind} task.`);
    }
  }
}

function calculateEvaluation(candidate) {
  const attempt = candidate.attempt;
  const answers = new Map(attempt.answers.map((answer) => [answer.candidateQuestionId, answer.answer]));
  const recordings = new Map(attempt.recordings.map((recording) => [recording.kind, recording]));
  const writtenQuestions = candidate.questions.filter((question) => question.type === 'WRITTEN');
  const requiredTasks = ['reading', 'speaking'].filter((kind) =>
    snapshotFor(candidate, kind) && recordings.has(kind.toUpperCase())
  );
  const complete = writtenQuestions.every((question) => question.awardedMarks !== null) &&
    requiredTasks.every((kind) => recordings.get(kind.toUpperCase()).awardedMarks !== null);
  if (!complete) return { score: null, evaluationStatus: 'manual_review' };

  let max = 0;
  let earned = 0;
  for (const question of candidate.questions) {
    const questionMax = question.marks ?? 1;
    max += questionMax;
    if (question.type === 'MCQ') {
      const options = Array.isArray(question.options) ? question.options : [];
      const correctAnswer = question.correctOption == null ? null : options[question.correctOption];
      if (correctAnswer != null && answers.get(question.id) === String(correctAnswer)) earned += questionMax;
    } else {
      earned += question.awardedMarks ?? 0;
    }
  }
  for (const kind of ['reading', 'speaking']) {
    const taskMax = getTaskMaxMarks(candidate, kind);
    if (taskMax === null) continue;
    max += taskMax;
    const recording = recordings.get(kind.toUpperCase());
    if (recording) earned += recording.awardedMarks ?? 0;
  }
  if (!max) return { score: null, evaluationStatus: 'manual_review' };
  return {
    score: Math.round((earned / max) * 1000) / 10,
    evaluationStatus: 'evaluated',
  };
}

async function getEvaluation(assessmentId, candidateId) {
  const candidate = await findEvaluationCandidate(prisma, assessmentId, candidateId);
  return serializeEvaluation(candidate);
}

async function saveEvaluation(assessmentId, candidateId, input, adminId) {
  const initial = await findEvaluationCandidate(prisma, assessmentId, candidateId);
  assertSubmitted(initial);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM candidate_attempts WHERE id = ${initial.attempt.id} FOR UPDATE`;
    const candidate = await findEvaluationCandidate(tx, assessmentId, candidateId);
    validateSubmittedMarks(candidate, input);

    for (const item of input.questionEvaluations || []) {
      const question = candidate.questions.find((row) => row.id === item.questionId);
      await tx.candidateQuestion.update({
        where: { id: question.id },
        data: {
          awardedMarks: item.awardedMarks,
          ...(item.feedback !== undefined ? { evaluationFeedback: item.feedback } : {}),
        },
      });
    }
    for (const item of input.taskEvaluations || []) {
      const recording = candidate.attempt.recordings.find((row) => row.kind === item.kind.toUpperCase());
      await tx.candidateRecording.update({
        where: { id: recording.id },
        data: {
          awardedMarks: item.awardedMarks,
          ...(item.feedback !== undefined ? { evaluationFeedback: item.feedback } : {}),
        },
      });
    }

    const updated = await findEvaluationCandidate(tx, assessmentId, candidateId);
    const evaluation = calculateEvaluation(updated);
    await tx.candidateAttempt.update({
      where: { id: updated.attempt.id },
      data: {
        ...evaluation,
        ...(input.overallFeedback !== undefined ? { evaluationFeedback: input.overallFeedback } : {}),
        evaluatedAt: evaluation.evaluationStatus === 'evaluated' ? new Date() : null,
        evaluatedById: evaluation.evaluationStatus === 'evaluated' ? adminId : null,
      },
    });
  });

  return getEvaluation(assessmentId, candidateId);
}

module.exports = {
  getEvaluation,
  saveEvaluation,
};
