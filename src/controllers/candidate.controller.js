const service = require('../services/candidate.service');
const { asyncHandler } = require('../utils/http');

const create = asyncHandler(async (req, res) => {
  const candidate = await service.assignCandidate(Number(req.params.id), req.body, req.admin.id);
  res.status(201).json({ data: candidate });
});

const list = asyncHandler(async (req, res) => {
  const candidates = await service.listCandidates(Number(req.params.id), req.validatedQuery || {});
  res.json({ data: candidates });
});

// Global list across all assessments.
const listAll = asyncHandler(async (req, res) => {
  const result = await service.listAllCandidates(req.validatedQuery || {});
  res.json({ data: result.items, meta: result.meta });
});

const getOne = asyncHandler(async (req, res) => {
  const candidate = await service.getCandidate(Number(req.params.id), Number(req.params.candidateId));
  res.json({ data: candidate });
});

const listQuestions = asyncHandler(async (req, res) => {
  const questions = await service.listCandidateQuestions(Number(req.params.id), Number(req.params.candidateId));
  res.json({ data: questions });
});

const updateQuestion = asyncHandler(async (req, res) => {
  const q = await service.updateCandidateQuestion(
    Number(req.params.id), Number(req.params.candidateId), Number(req.params.cqId), req.body, req.admin.id
  );
  res.json({ data: q });
});

const regenerateQuestions = asyncHandler(async (req, res) => {
  const questions = await service.regenerateCandidateQuestions(Number(req.params.id), Number(req.params.candidateId), req.admin.id);
  res.json({ data: questions });
});

const approveQuestions = asyncHandler(async (req, res) => {
  const candidate = await service.approveCandidateQuestions(Number(req.params.id), Number(req.params.candidateId), req.admin.id);
  res.json({ data: candidate });
});

const setTimerApproval = asyncHandler(async (req, res) => {
  const candidate = await service.setTimerApproval(
    Number(req.params.id), Number(req.params.candidateId),
    req.body.approved, req.body.note, req.body.durationSeconds, req.admin.id
  );
  res.json({ data: candidate });
});

const generateLink = asyncHandler(async (req, res) => {
  const result = await service.generateLink(Number(req.params.id), Number(req.params.candidateId), req.admin.id);
  res.json({ data: result });
});

module.exports = {
  create,
  list,
  listAll,
  getOne,
  listQuestions,
  updateQuestion,
  regenerateQuestions,
  approveQuestions,
  setTimerApproval,
  generateLink,
};
