const service = require('../services/candidate-evaluation.service');
const { asyncHandler } = require('../utils/http');

const getEvaluation = asyncHandler(async (req, res) => {
  const result = await service.getEvaluation(req.params.id, req.params.candidateId);
  res.json({ data: result });
});

const saveEvaluation = asyncHandler(async (req, res) => {
  const result = await service.saveEvaluation(
    req.params.id,
    req.params.candidateId,
    req.body,
    req.admin.id
  );
  res.json({ data: result });
});

module.exports = {
  getEvaluation,
  saveEvaluation,
};
