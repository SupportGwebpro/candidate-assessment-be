/// Typed HTTP error. Thrown anywhere in services/controllers and translated
/// into a consistent JSON body by the error middleware.
class HttpError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code || 'ERROR';
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, 'BAD_REQUEST', details);
const unauthorized = (msg = 'Authentication required') =>
  new HttpError(401, msg, 'UNAUTHORIZED');
const forbidden = (msg = 'You do not have access to this resource') =>
  new HttpError(403, msg, 'FORBIDDEN');
const notFound = (msg = 'Resource not found') => new HttpError(404, msg, 'NOT_FOUND');
const conflict = (msg, details) => new HttpError(409, msg, 'CONFLICT', details);

/// Wrap an async route handler so rejected promises reach the error middleware.
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  asyncHandler,
};
