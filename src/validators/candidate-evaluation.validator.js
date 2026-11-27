const { z } = require('zod');

const evaluationParam = {
  params: z.object({
    id: z.coerce.number().int().positive('Invalid assessment id'),
    candidateId: z.coerce.number().int().positive('Invalid candidate id'),
  }),
};

const evaluationBody = {
  body: z
    .object({
      questionEvaluations: z.array(z.object({
        questionId: z.coerce.number().int().positive(),
        awardedMarks: z.number().finite().min(0).max(10000).nullable(),
        feedback: z.string().trim().max(5000).nullable().optional(),
      })).max(500).optional(),
      taskEvaluations: z.array(z.object({
        kind: z.enum(['reading', 'speaking']),
        awardedMarks: z.number().finite().min(0).max(10000).nullable(),
        feedback: z.string().trim().max(5000).nullable().optional(),
      })).max(2).optional(),
      overallFeedback: z.string().trim().max(10000).nullable().optional(),
    })
    .refine((data) =>
      data.questionEvaluations !== undefined ||
      data.taskEvaluations !== undefined ||
      data.overallFeedback !== undefined,
    { message: 'Provide at least one evaluation field' })
    .refine((data) =>
      !data.questionEvaluations ||
      new Set(data.questionEvaluations.map((item) => item.questionId)).size === data.questionEvaluations.length,
    { message: 'Question evaluations must not contain duplicate question ids', path: ['questionEvaluations'] })
    .refine((data) =>
      !data.taskEvaluations ||
      new Set(data.taskEvaluations.map((item) => item.kind)).size === data.taskEvaluations.length,
    { message: 'Task evaluations must not contain duplicate task kinds', path: ['taskEvaluations'] }),
};

// Optional body: limit AI evaluation to specific written questions (all by default).
const aiEvaluationBody = {
  body: z
    .object({
      questionIds: z.array(z.coerce.number().int().positive()).min(1).max(100).optional(),
    })
    .refine((data) =>
      !data.questionIds || new Set(data.questionIds).size === data.questionIds.length,
    { message: 'Question ids must not contain duplicates', path: ['questionIds'] })
    .default({}),
};

// Single-question AI evaluation: the question is addressed in the path.
const aiQuestionParam = {
  params: evaluationParam.params.extend({
    questionId: z.coerce.number().int().positive('Invalid question id'),
  }),
};
module.exports = {
  evaluationParam,
  evaluationBody,
  aiEvaluationBody,
  aiQuestionParam,
};
