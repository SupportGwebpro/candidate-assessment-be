const { HttpError } = require('../utils/http');

/// 404 for unmatched routes.
const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: { message: `Route not found: ${req.method} ${req.originalUrl}`, code: 'NOT_FOUND' },
  });
};

/// Converts thrown errors into a consistent JSON envelope.
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  // Known, intentional errors.
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: { message: err.message, code: err.code, details: err.details },
    });
  }

  // Prisma unique-constraint violation.
  if (err.code === 'P2002') {
    const target = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : 'field';
    return res.status(409).json({
      error: { message: `A record with this ${target} already exists`, code: 'CONFLICT' },
    });
  }

  // Prisma record-not-found (e.g. update/delete on a missing row).
  if (err.code === 'P2025') {
    return res.status(404).json({
      error: { message: 'Resource not found', code: 'NOT_FOUND' },
    });
  }

  console.error('[unhandled error]', err);
  res.status(500).json({
    error: { message: 'Internal server error', code: 'INTERNAL_ERROR' },
  });
};

module.exports = { notFoundHandler, errorHandler };
