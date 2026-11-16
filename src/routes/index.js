const express = require('express');
const authRoutes = require('./auth.routes');
const assessmentRoutes = require('./assessment.routes');
const candidatesRoutes = require('./candidates.routes');
const candidatePortalRoutes = require('./candidate-portal.routes');

const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

router.use('/auth', authRoutes);
// Candidate invitation endpoints use the high-entropy invitation token and
// browser binding; they intentionally do not require HR-admin authentication.
router.use('/candidate', candidatePortalRoutes);
router.use('/assessments', assessmentRoutes);
router.use('/candidates', candidatesRoutes);

module.exports = router;
