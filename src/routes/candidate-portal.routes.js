const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const controller = require('../controllers/candidate-portal.controller');
const { validate } = require('../middleware/validate');
const v = require('../validators/candidate-portal.validator');

const router = express.Router();
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});
const contactCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many verification code requests. Wait 15 minutes before trying again.' } },
});

router.get('/invitations/:token', validate(v.tokenParam), controller.getInvitation);
router.post('/invitations/:token/contact/code', contactCodeLimiter, validate(v.contactCodeSchema), controller.sendContactCode);
router.post('/invitations/:token/contact/verify', validate(v.verifyContactCodeSchema), controller.verifyContactCode);
router.post('/invitations/:token/security', validate(v.candidateSecuritySchema), controller.checkSecurity);
router.post('/invitations/:token/start', validate(v.startCandidateAttemptSchema), controller.startAttempt);
router.put('/invitations/:token/responses/:questionId', validate(v.saveCandidateAnswerSchema), controller.saveAnswer);
router.post('/invitations/:token/session', validate(v.candidateSessionSchema), controller.updateSession);
router.post('/invitations/:token/submit', validate(v.submitCandidateAttemptSchema), controller.submitAttempt);
router.get('/invitations/:token/receipt', validate(v.tokenParam), controller.getReceipt);
router.post('/invitations/:token/draft', validate(v.candidateDraftSchema), controller.saveDraft);
router.post('/invitations/:token/incidents', validate(v.candidateIncidentSchema), controller.logIncident);
router.post('/invitations/:token/face-presence', validate(v.candidateFacePresenceSchema), controller.updateFacePresence);
router.get('/invitations/:token/final-tasks', validate(v.tokenParam), controller.getFinalTasks);
router.post('/invitations/:token/final-tasks/:kind/start', validate(v.finalTaskStartSchema), controller.startFinalTask);
router.post('/invitations/:token/final-tasks/:kind/recording', validate(v.finalTaskParam), audioUpload.single('file'), validate(v.finalTaskRecordingSchema), controller.uploadFinalTaskRecording);
router.post('/invitations/:token/violations', validate(v.candidateViolationSchema), controller.recordViolation);

module.exports = router;
