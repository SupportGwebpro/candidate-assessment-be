const service = require('../services/blueprint.service');
const { asyncHandler } = require('../utils/http');

// questions
const addQuestion = asyncHandler(async (req, res) => {
  const q = await service.addQuestion(Number(req.params.id), Number(req.params.sectionId), req.body, req.admin.id);
  res.status(201).json({ data: q });
});
const updateQuestion = asyncHandler(async (req, res) => {
  const q = await service.updateQuestion(Number(req.params.id), Number(req.params.questionId), req.body, req.admin.id);
  res.json({ data: q });
});
const deleteQuestion = asyncHandler(async (req, res) => {
  const result = await service.deleteQuestion(Number(req.params.id), Number(req.params.questionId));
  res.json({ data: result });
});
const regenerateQuestion = asyncHandler(async (req, res) => {
  const q = await service.regenerateQuestion(Number(req.params.id), Number(req.params.questionId));
  res.json({ data: q });
});
const setQuestionApproval = asyncHandler(async (req, res) => {
  const q = await service.setQuestionApproval(Number(req.params.id), Number(req.params.questionId), req.body.approved, req.admin.id);
  res.json({ data: q });
});

// sections
const addSection = asyncHandler(async (req, res) => {
  const s = await service.addSection(Number(req.params.id), req.body, req.admin.id);
  res.status(201).json({ data: s });
});
const updateSection = asyncHandler(async (req, res) => {
  const s = await service.updateSection(Number(req.params.id), Number(req.params.sectionId), req.body, req.admin.id);
  res.json({ data: s });
});
const deleteSection = asyncHandler(async (req, res) => {
  const result = await service.deleteSection(Number(req.params.id), Number(req.params.sectionId));
  res.json({ data: result });
});
const regenerateSection = asyncHandler(async (req, res) => {
  const s = await service.regenerateSection(Number(req.params.id), Number(req.params.sectionId));
  res.json({ data: s });
});

// timer
const setTimer = asyncHandler(async (req, res) => {
  const result = await service.setTimer(Number(req.params.id), req.body.durationMinutes, req.admin.id);
  res.json({ data: result });
});
const setTimerApproval = asyncHandler(async (req, res) => {
  const result = await service.setTimerApproval(Number(req.params.id), req.body.approved, req.admin.id);
  res.json({ data: result });
});

// competencies & KRAs
const listCompetencies = asyncHandler(async (req, res) => {
  res.json({ data: await service.listCompetencies(Number(req.params.id)) });
});
const saveCompetencies = asyncHandler(async (req, res) => {
  res.json({ data: await service.saveCompetencies(Number(req.params.id), req.body.competencies) });
});
const listKeyResultAreas = asyncHandler(async (req, res) => {
  res.json({ data: await service.listKeyResultAreas(Number(req.params.id)) });
});
const saveKeyResultAreas = asyncHandler(async (req, res) => {
  res.json({ data: await service.saveKeyResultAreas(Number(req.params.id), req.body.keyResultAreas) });
});

// approvals summary
const getApprovals = asyncHandler(async (req, res) => {
  res.json({ data: await service.getApprovals(Number(req.params.id)) });
});

module.exports = {
  addQuestion,
  updateQuestion,
  deleteQuestion,
  regenerateQuestion,
  setQuestionApproval,
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
  getApprovals,
};
