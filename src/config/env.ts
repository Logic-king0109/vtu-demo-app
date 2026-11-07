import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// ─── Helpers ────────────────────────────────────────────
const boolString = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const intString = z
  .string()
  .regex(/^\d+$/, 'Must be an integer string')
  .transform((v) => parseInt(v, 10));

// ─── Schema ─────────────────────────────────────────────
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: intString.default('5000'),
  APP_NAME: z.string().default('VTU Platform'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 chars'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Cookies
  COOKIE_DOMAIN: z.string().min(1),
  COOKIE_SECURE: boolString,

  // CORS
  CORS_ORIGINS: z
    .string()
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .refine((arr) => arr.length > 0, 'At least one CORS origin required'),

  // Virtual Account Provider
  VA_PROVIDER_NAME: z.string().min(1),
  VA_BASE_URL: z.string().url(),
  VA_API_KEY: z.string().min(1),
  VA_SECRET_KEY: z.string().min(1),
  VA_CONTRACT_CODE: z.string().min(1),
  VA_WEBHOOK_SECRET: z.string().min(16),
  VA_WEBHOOK_PATH: z.string().startsWith('/'),
  VA_WEBHOOK_IP_ALLOWLIST: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])),

  // Provider A
  PROVIDER_A_NAME: z.string().min(1),
  PROVIDER_A_BASE_URL: z.string().url(),
  PROVIDER_A_API_KEY: z.string().min(1),
  PROVIDER_A_API_SECRET: z.string().min(1),
  PROVIDER_A_ENABLED: boolString,
  PROVIDER_A_TIMEOUT_MS: intString.default('30000'),

  // Provider B
  PROVIDER_B_NAME: z.string().min(1),
  PROVIDER_B_BASE_URL: z.string().url(),
  PROVIDER_B_API_KEY: z.string().min(1),
  PROVIDER_B_API_SECRET: z.string().min(1),
  PROVIDER_B_ENABLED: boolString,
  PROVIDER_B_TIMEOUT_MS: intString.default('30000'),

  // Provider C
  PROVIDER_C_NAME: z.string().min(1),
  PROVIDER_C_BASE_URL: z.string().url(),
  PROVIDER_C_API_KEY: z.string().min(1),
  PROVIDER_C_API_SECRET: z.string().min(1),
  PROVIDER_C_ENABLED: boolString,
  PROVIDER_C_TIMEOUT_MS: intString.default('30000'),

  // Email
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().email(),
  RESEND_FROM_NAME: z.string().min(1),

  // Security
  PIN_MAX_ATTEMPTS: intString.default('5'),
  PIN_LOCK_MINUTES: intString.default('15'),
  OTP_TTL_MINUTES: intString.default('10'),
  OTP_MAX_ATTEMPTS: intString.default('3'),

  // Rate limits
  RATE_LIMIT_AUTH_POINTS: intString.default('10'),
  RATE_LIMIT_AUTH_WINDOW_SEC: intString.default('60'),
  RATE_LIMIT_PURCHASE_POINTS: intString.default('20'),
  RATE_LIMIT_PURCHASE_WINDOW_SEC: intString.default('60'),
  RATE_LIMIT_WEBHOOK_POINTS: intString.default('100'),
  RATE_LIMIT_WEBHOOK_WINDOW_SEC: intString.default('60'),
});

// ─── Parse & export ─────────────────────────────────────
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  isDev: parsed.data.NODE_ENV === 'development',
} as const;

export type Env = typeof env;