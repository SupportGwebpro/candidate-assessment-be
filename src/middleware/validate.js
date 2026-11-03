const { badRequest } = require('../utils/http');

/// Validate req.body / req.query / req.params against a zod schema.
/// Parsed (and coerced) values replace the originals so handlers get clean data.
const validate = (schemas) => (req, res, next) => {
  try {
    if (schemas.body) req.body = schemas.body.parse(req.body);
    if (schemas.query) req.validatedQuery = schemas.query.parse(req.query);
    if (schemas.params) req.params = schemas.params.parse(req.params);
    next();
  } catch (err) {
    if (err.name === 'ZodError') {
      const details = err.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return next(badRequest('Validation failed', details));
    }
    next(err);
  }
};

module.exports = { validate };
