const service = require('../services/candidate-portal.service');
const { asyncHandler } = require('../utils/http');

const getInvitation = asyncHandler(async (req, res) => {
  res.json({ data: await service.getInvitation(req.params.token, req) });
});

const sendContactCode = asyncHandler(async (req, res) => {
  res.json({ data: await service.sendContactCode(req.params.token, req.body, req) });
});

const verifyContactCode = asyncHandler(async (req, res) => {
  res.json({ data: await service.verifyContactCode(req.params.token, req.body, req) });
});

const checkSecurity = asyncHandler(async (req, res) => {
  res.json({ data: await service.checkSecurity(req.params.token, req) });
});

const startAttempt = asyncHandler(async (req, res) => {
  res.json({ data: await service.startAttempt(req.params.token, req.body, req) });
});

const saveAnswer = asyncHandler(async (req, res) => {
  res.json({ data: await service.saveAnswer(req.params.token, req.params.questionId, req.body.answer, req) });
});

const updateSession = asyncHandler(async (req, res) => {
  res.json({ data: await service.updateSession(req.params.token, req.body.questionId, req) });
});

const submitAttempt = asyncHandler(async (req, res) => {
  res.json({ data: await service.submitAttempt(req.params.token, req) });
});

const getReceipt = asyncHandler(async (req, res) => {
  res.json({ data: await service.getReceipt(req.params.token, req) });
});

const saveDraft = asyncHandler(async (req, res) => {
  res.json({ data: await service.saveDraft(req.params.token, req) });
});

const logIncident = asyncHandler(async (req, res) => {
  res.json({ data: await service.logIncident(req.params.token, req.body, req) });
});

const updateFacePresence = asyncHandler(async (req, res) => {
  res.json({ data: await service.updateFacePresence(req.params.token, req.body, req) });
});

const getFinalTasks = asyncHandler(async (req, res) => {
  res.json({ data: await service.getFinalTasks(req.params.token, req) });
});

const startFinalTask = asyncHandler(async (req, res) => {
  res.json({ data: await service.startFinalTask(req.params.token, req.params.kind, req) });
});

const uploadFinalTaskRecording = asyncHandler(async (req, res) => {
  res.json({ data: await service.uploadFinalTaskRecording(
    req.params.token, req.params.kind, req.file, req.body.durationSeconds, req
  ) });
});

const recordViolation = asyncHandler(async (req, res) => {
  res.json({ data: await service.recordViolation(req.params.token, req.body.eventId, req) });
});

module.exports = {
  getInvitation,
  sendContactCode,
  verifyContactCode,
  checkSecurity,
  startAttempt,
  saveAnswer,
  updateSession,
  submitAttempt,
  getReceipt,
  saveDraft,
  logIncident,
  updateFacePresence,
  getFinalTasks,
  startFinalTask,
  uploadFinalTaskRecording,
  recordViolation,
};
