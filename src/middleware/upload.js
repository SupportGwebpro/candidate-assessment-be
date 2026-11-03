const multer = require('multer');
const env = require('../config/env');
const { badRequest } = require('../utils/http');

const ALLOWED_EXT = ['pdf', 'doc', 'docx'];
const ALLOWED_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream', // some browsers send this for .doc/.docx
];

const fileFilter = (req, file, cb) => {
  const ext = (file.originalname.split('.').pop() || '').toLowerCase();
  if (ALLOWED_EXT.includes(ext) && ALLOWED_MIME.includes(file.mimetype)) {
    return cb(null, true);
  }
  cb(badRequest('Only PDF, DOC, or DOCX files are allowed'));
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.upload.maxBytes, files: 1 },
  fileFilter,
});

/// Single-file upload under the "file" field, with multer errors normalized.
const jobDescriptionUpload = (req, res, next) =>
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? `File too large (max ${Math.round(env.upload.maxBytes / 1048576)} MB)`
          : err.message;
      return next(badRequest(msg));
    }
    next(err);
  });

module.exports = { jobDescriptionUpload };
