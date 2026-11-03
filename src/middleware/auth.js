const prisma = require('../lib/prisma');
const { verifyToken } = require('../utils/jwt');
const { unauthorized, forbidden, asyncHandler } = require('../utils/http');

/// Requires a valid Bearer token belonging to an active HR Admin.
/// Rejects unauthenticated requests (401) and deactivated accounts (403).
/// On success, attaches the admin to req.admin.
const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw unauthorized('Missing or malformed Authorization header');
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    throw unauthorized('Invalid or expired token');
  }

  const admin = await prisma.hrAdmin.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true, isActive: true },
  });

  if (!admin) throw unauthorized('Account no longer exists');
  if (!admin.isActive) throw forbidden('Account is deactivated');

  req.admin = admin;
  next();
});

module.exports = { requireAuth };
