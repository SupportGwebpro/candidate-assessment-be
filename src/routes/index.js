const express = require('express');
const authRoutes = require('./auth.routes');
const assessmentRoutes = require('./assessment.routes');
const candidatesRoutes = require('./candidates.routes');

const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

router.use('/auth', authRoutes);
router.use('/assessments', assessmentRoutes);
router.use('/candidates', candidatesRoutes);

module.exports = router;
