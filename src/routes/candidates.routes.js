const express = require('express');
const controller = require('../controllers/candidate.controller');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const candv = require('../validators/candidate.validator');

const router = express.Router();

// Global candidate list across all assessments. Auth required.
router.use(requireAuth);
router.get('/', validate(candv.listAllCandidatesSchema), controller.listAll);

module.exports = router;
