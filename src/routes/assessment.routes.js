const express = require('express');
const controller = require('../controllers/assessment.controller');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { jobDescriptionUpload } = require('../middleware/upload');
const {
  idParam,
  createAssessmentSchema,
  updateAssessmentSchema,
  actionSchema,
  listQuerySchema,
  aiSkillsSchema,
  aiSectionsSchema,
  saveSkillsSchema,
  saveSectionsSchema,
  accessSchema,
  generateBlueprintSchema,
} = require('../validators/assessment.validator');

// Blueprint editing & approvals module (additive — does not alter the routes above).
const bp = require('../controllers/blueprint.controller');
const bpv = require('../validators/blueprint.validator');

// Candidate assignment module.
const cand = require('../controllers/candidate.controller');
const candv = require('../validators/candidate.validator');

const router = express.Router();

// Every assessment route requires an authenticated, active HR Admin.
router.use(requireAuth);

// List + core record
router.get('/', validate(listQuerySchema), controller.list);
router.post('/', validate(createAssessmentSchema), controller.create);
router.get('/:id', validate(idParam), controller.getOne); // step 4 review payload
router.patch('/:id', validate(updateAssessmentSchema), controller.update);

// Step 1 — Role Details: upload a PDF/DOC/DOCX job description (text extracted)
router.post('/:id/job-description/upload', validate(idParam), jobDescriptionUpload, controller.uploadJobDescription);

// Step 2 — Skills (AI suggest + save selection)
router.post('/:id/ai/skills', validate(aiSkillsSchema), controller.generateSkills);
router.get('/:id/skills', validate(idParam), controller.listSkills);
router.put('/:id/skills', validate(saveSkillsSchema), controller.saveSkills);

// Step 2 — Sections (AI suggest + save editable config)
router.post('/:id/ai/sections', validate(aiSectionsSchema), controller.generateSections);
router.get('/:id/sections', validate(idParam), controller.listSections);
router.put('/:id/sections', validate(saveSectionsSchema), controller.saveSections);

// Step 3 — Assessment Access (opensAt, closesAt, timezone, eligibilityThreshold, saveAndResume)
router.put('/:id/access', validate(accessSchema), controller.setAccess);

// Step 4 — Generate / fetch the AI blueprint (section-wise questions)
router.post('/:id/ai/blueprint', validate(generateBlueprintSchema), controller.generateBlueprint);
router.get('/:id/blueprint', validate(idParam), controller.getBlueprint);

// Lifecycle
router.post('/:id/publish', validate(actionSchema), controller.publish);
router.post('/:id/archive', validate(actionSchema), controller.archive);
router.post('/:id/restore', validate(actionSchema), controller.restore);

// Version history
router.get('/:id/versions', validate(idParam), controller.listVersions);

// === Candidate assignment =================================================
// Create assignment (modified "add candidate": name/email/phone + question source,
// approved-set snapshot or fresh AI set, retained version) and list/detail.
router.get('/:id/candidates', validate(candv.listCandidatesSchema), cand.list);
router.post('/:id/candidates', validate(candv.createAssignmentSchema), cand.create);
router.get('/:id/candidates/:candidateId', validate(candv.candidateParam), cand.getOne);

// Candidate question review (fresh sets need approval before link generation)
router.get('/:id/candidates/:candidateId/questions', validate(candv.candidateParam), cand.listQuestions);
router.patch('/:id/candidates/:candidateId/questions/:cqId', validate(candv.updateCandidateQuestionSchema), cand.updateQuestion);
router.post('/:id/candidates/:candidateId/questions/regenerate', validate(candv.candidateParam), cand.regenerateQuestions);
router.post('/:id/candidates/:candidateId/questions/approve', validate(candv.candidateParam), cand.approveQuestions);

// Independent timer approval (with note) for the assignment
router.patch('/:id/candidates/:candidateId/timer-approval', validate(candv.timerApprovalSchema), cand.setTimerApproval);

// Generate the access link (requires questions + timer approvals)
router.post('/:id/candidates/:candidateId/link', validate(candv.candidateParam), cand.generateLink);

// NOTE: there is intentionally no DELETE route. Removal is done via archive,
// which is reversible via restore — no permanent deletion is exposed.

// === Blueprint editing & independent approvals ============================

// Questions
router.post('/:id/sections/:sectionId/questions', validate(bpv.addQuestionSchema), bp.addQuestion);
router.patch('/:id/questions/:questionId', validate(bpv.updateQuestionSchema), bp.updateQuestion);
router.delete('/:id/questions/:questionId', validate(bpv.questionParam), bp.deleteQuestion);
router.post('/:id/questions/:questionId/regenerate', validate(bpv.questionParam), bp.regenerateQuestion);
router.patch('/:id/allquestions/approval', validate(bpv.questionsApprovalSchema), bp.setAllQuestionsApproval);
router.patch('/:id/questions/:questionId/approval', validate(bpv.questionApprovalSchema), bp.setQuestionApproval);

// Sections (granular add/edit/delete/regenerate — complements PUT /:id/sections)
router.post('/:id/sections', validate(bpv.addSectionSchema), bp.addSection);
router.patch('/:id/sections/:sectionId', validate(bpv.updateSectionSchema), bp.updateSection);
router.delete('/:id/sections/:sectionId', validate(bpv.sectionParam), bp.deleteSection);
router.post('/:id/sections/:sectionId/regenerate', validate(bpv.sectionParam), bp.regenerateSection);

// Overall timer + its independent approval
router.put('/:id/timer', validate(bpv.timerSchema), bp.setTimer);
router.patch('/:id/timer/approval', validate(bpv.timerApprovalSchema), bp.setTimerApproval);

// Role taxonomy: competencies & key result areas
router.get('/:id/competencies', validate(bpv.assessmentParam), bp.listCompetencies);
router.put('/:id/competencies', validate(bpv.saveCompetenciesSchema), bp.saveCompetencies);
router.get('/:id/key-result-areas', validate(bpv.assessmentParam), bp.listKeyResultAreas);
router.put('/:id/key-result-areas', validate(bpv.saveKeyResultAreasSchema), bp.saveKeyResultAreas);

// Approval summary (timer + per-question / per-section counts)
router.get('/:id/approvals', validate(bpv.assessmentParam), bp.getApprovals);

module.exports = router;
