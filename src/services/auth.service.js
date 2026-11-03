const prisma = require('../lib/prisma');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signToken } = require('../utils/jwt');
const { unauthorized, forbidden, conflict } = require('../utils/http');

const publicAdmin = (admin) => ({
  id: admin.id,
  email: admin.email,
  name: admin.name,
  isActive: admin.isActive,
  createdAt: admin.createdAt,
  updatedAt: admin.updatedAt,
});

/// Authenticate with email + password. Uses a generic message for both
/// "no such user" and "wrong password" so the endpoint doesn't leak which
/// emails exist.
async function login(email, password) {
  const admin = await prisma.hrAdmin.findUnique({ where: { email } });
  if (!admin) throw unauthorized('Invalid email or password');
  if (!admin.isActive) throw forbidden('Account is deactivated');

  const ok = await verifyPassword(password, admin.passwordHash);
  if (!ok) throw unauthorized('Invalid email or password');

  const token = signToken({ sub: admin.id, email: admin.email });
  return { token, admin: publicAdmin(admin) };
}

/// Provision a new HR Admin (no public sign-up). Called from the seed script
/// and the protected POST /api/auth/admins endpoint.
async function createAdmin({ email, password, name }) {
  const existing = await prisma.hrAdmin.findUnique({ where: { email } });
  if (existing) throw conflict('An admin with this email already exists');

  const passwordHash = await hashPassword(password);
  const admin = await prisma.hrAdmin.create({
    data: { email, passwordHash, name },
  });
  return publicAdmin(admin);
}

async function getById(id) {
  const admin = await prisma.hrAdmin.findUnique({ where: { id } });
  return admin ? publicAdmin(admin) : null;
}

module.exports = { login, createAdmin, getById, publicAdmin };
