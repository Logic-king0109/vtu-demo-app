import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.isProd ? 'info' : 'debug',
  base: { service: 'vtu-backend' },
  redact: {
    // Never log these, even if accidentally passed
    paths: [
      'password',
      '*.password',
      'passwordHash',
      '*.passwordHash',
      'pin',
      '*.pin',
      'pinHash',
      '*.pinHash',
      'authorization',
      '*.authorization',
      'cookie',
      '*.cookie',
      'req.headers.authorization',
      'req.headers.cookie',
      'VA_SECRET_KEY',
      'VA_API_KEY',
      'VA_WEBHOOK_SECRET',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
    ],
    censor: '[REDACTED]',
  },
  ...(env.isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    },
  }),
});