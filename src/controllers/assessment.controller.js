const service = require('../services/assessment.service');
const { asyncHandler, badRequest } = require('../utils/http');

const list = asyncHandler(async (req, res) => {
  const result = await service.list(req.validatedQuery);
  res.json({ data: result.items, meta: result.meta });
});

const getOne = asyncHandler(async (req, res) => {
  const assessment = await service.getById(req.params.id);
  res.json({ data: assessment });
});

const create = asyncHandler(async (req, res) => {
  const assessment = await service.create(req.body, req.admin.id);
  res.status(201).json({ data: assessment });
});

const update = asyncHandler(async (req, res) => {
  const assessment = await service.update(req.params.id, req.body, req.admin.id);
  res.json({ data: assessment });
});

const publish = asyncHandler(async (req, res) => {
  const assessment = await service.publish(req.params.id, req.admin.id, req.body.changeNote);
  res.json({ data: assessment });
});

const archive = asyncHandler(async (req, res) => {
  const assessment = await service.archive(req.params.id, req.admin.id, req.body.changeNote);
  res.json({ data: assessment });
});

const restore = asyncHandler(async (req, res) => {
  const assessment = await service.restore(req.params.id, req.admin.id, req.body.changeNote);
  res.json({ data: assessment });
});

const listVersions = asyncHandler(async (req, res) => {
  const versions = await service.listVersions(req.params.id);
  res.json({ data: versions });
});

const addCandidate = asyncHandler(async (req, res) => {
  const result = await service.addCandidate(req.params.id, req.body);
  res.status(201).json({ data: result });
});

const listCandidates = asyncHandler(async (req, res) => {
  const candidates = await service.listCandidates(req.params.id);
  res.json({ data: candidates });
});

// --- Wizard step 1: job-description upload ---
const uploadJobDescription = asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded (use form field "file")');
  const result = await service.attachJobDescriptionFile(req.params.id, req.file, req.admin.id);
  res.json({ data: result });
});

// --- Wizard step 2: skills ---
const generateSkills = asyncHandler(async (req, res) => {
  const result = await service.generateSkills(req.params.id, req.body.count);
  res.json({ data: result });
});

const saveSkills = asyncHandler(async (req, res) => {
  const skills = await service.saveSkills(req.params.id, req.body.skills);
  res.json({ data: skills });
});

const listSkills = asyncHandler(async (req, res) => {
  const skills = await service.listSkills(req.params.id);
  res.json({ data: skills });
});

// --- Wizard step 2: sections ---
const generateSections = asyncHandler(async (req, res) => {
  const result = await service.generateSections(req.params.id);
  res.json({ data: result });
});

const saveSections = asyncHandler(async (req, res) => {
  const sections = await service.saveSections(req.params.id, req.body.sections);
  res.json({ data: sections });
});

const listSections = asyncHandler(async (req, res) => {
  const sections = await service.listSections(req.params.id);
  res.json({ data: sections });
});

// --- Wizard step 3: Assessment Access ---
const setAccess = asyncHandler(async (req, res) => {
  const assessment = await service.setAccess(req.params.id, req.body, req.admin.id);
  res.json({ data: assessment });
});

// --- Wizard step 4: blueprint ---
const generateBlueprint = asyncHandler(async (req, res) => {
  const blueprint = await service.generateBlueprint(req.params.id, req.admin.id, req.body.changeNote);
  res.json({ data: blueprint });
});

const getBlueprint = asyncHandler(async (req, res) => {
  const blueprint = await service.getBlueprint(req.params.id);
  res.json({ data: blueprint });
});

module.exports = {
  list,
  getOne,
  create,
  uploadJobDescription,
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
  addCandidate,
  listCandidates,
};
