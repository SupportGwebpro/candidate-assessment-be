const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/auth.controller');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { loginSchema, createAdminSchema } = require('../validators/auth.validator');

const router = express.Router();

// Throttle credential-guessing on login.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many login attempts, try again later', code: 'RATE_LIMITED' } },
});

router.post('/login', loginLimiter, validate(loginSchema), controller.login);

// Account provisioning — authenticated admins only (no public sign-up).
router.post('/admins', requireAuth, validate(createAdminSchema), controller.createAdmin);

router.get('/me', requireAuth, controller.me);

module.exports = router;
