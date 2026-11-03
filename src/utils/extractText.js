// Require the inner lib path so pdf-parse's index debug code never runs.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const mammoth = require('mammoth');
const WordExtractor = require('word-extractor');
const { badRequest } = require('./http');

const wordExtractor = new WordExtractor();

const extOf = (filename) => (filename.split('.').pop() || '').toLowerCase();

/// Extract plain text from an uploaded job-description file buffer.
/// Supports PDF, DOCX and legacy DOC. Returns trimmed text.
async function extractText(buffer, filename) {
  const ext = extOf(filename);

  if (ext === 'pdf') {
    const data = await pdfParse(buffer);
    return (data.text || '').trim();
  }

  if (ext === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer });
    return (value || '').trim();
  }

  if (ext === 'doc') {
    const doc = await wordExtractor.extract(buffer);
    return (doc.getBody() || '').trim();
  }

  throw badRequest('Unsupported file type. Upload a PDF, DOC, or DOCX file.');
}

module.exports = { extractText };
