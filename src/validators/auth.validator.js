const { z } = require('zod');

const loginSchema = {
  body: z.object({
    email: z.string().trim().toLowerCase().email('A valid email is required'),
    password: z.string().min(1, 'Password is required'),
  }),
};

const createAdminSchema = {
  body: z.object({
    email: z.string().trim().toLowerCase().email('A valid email is required'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password is too long'),
    name: z.string().trim().min(1, 'Name is required').max(120),
  }),
};

module.exports = { loginSchema, createAdminSchema };
