const authService = require('../services/auth.service');
const { asyncHandler } = require('../utils/http');

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password);
  res.json({ data: result });
});

const createAdmin = asyncHandler(async (req, res) => {
  const admin = await authService.createAdmin(req.body);
  res.status(201).json({ data: admin });
});

const me = asyncHandler(async (req, res) => {
  res.json({ data: req.admin });
});

module.exports = { login, createAdmin, me };
