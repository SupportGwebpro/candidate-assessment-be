require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const env = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  // Number of trusted proxy hops in front of the app (nginx = 1). Lets Express
  // derive the real client IP from X-Forwarded-For so the rate limiter keys by
  // client, not by the proxy. 0 disables proxy trust (direct exposure).
  trustProxy: process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : 1,

  databaseUrl: required('DATABASE_URL'),

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),

  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL || 'admin@gmail.com',
    password: process.env.SEED_ADMIN_PASSWORD || 'admin@321',
    name: process.env.SEED_ADMIN_NAME || 'HR Admin',
  },

  // DeepSeek (OpenAI-compatible). deepseek-chat was deprecated 2026-07-24;
  // deepseek-v4-flash is its non-thinking successor.
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    timeoutMs: parseInt(process.env.DEEPSEEK_TIMEOUT_MS || '60000', 10),
    // When true (or when no API key is set), AI endpoints return deterministic
    // sample data instead of calling DeepSeek — handy for local/dev testing.
    mock: process.env.AI_MOCK === 'true',
  },

  upload: {
    maxBytes: parseInt(process.env.UPLOAD_MAX_BYTES || '10485760', 10), // 10 MB
  },

  // Base URL used to build the candidate assessment link from the access token.
  candidateLinkBaseUrl: process.env.CANDIDATE_LINK_BASE_URL || '',
};

module.exports = env;
