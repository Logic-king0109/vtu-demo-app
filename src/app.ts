import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './utils/logger';
import { errorMiddleware } from './middlewares/error.middleware';
import { ApiError } from './utils/ApiError';

// ─── Route modules ──────────────────────────────────────
import authRoutes from './modules/auth/auth.routes';
import walletRoutes from './modules/wallet/wallet.routes';
import vtuRoutes from './modules/vtu/vtu.routes';
import webhookRoutes from './modules/webhook/webhook.routes';
import adminRoutes from './modules/admin/admin.routes';

const app = express();

// Trust the Nginx reverse proxy — req.ip will be the real client IP,
// and X-Forwarded-For will be honored for webhook IP allowlist.
app.set('trust proxy', 1);

// Disable Express fingerprint header
app.disable('x-powered-by');

// ─── Structured request logging (redacts secrets) ───────
app.use(
  pinoHttp({
    logger,
    // Don't log health checks — they'd flood logs
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url === '/healthz',
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  })
);

// ─── Security headers ───────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: env.isProd ? undefined : false, // CSP off in dev, on in prod
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ─── CORS ───────────────────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (curl, mobile app, server-to-server)
      // and requests from allowlisted origins.
      if (!origin) return callback(null, true);
      if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);
      logger.warn({ origin }, '[cors] origin rejected');
      return callback(new ApiError(403, 'Origin not allowed', 'CORS_REJECTED'));
    },
    credentials: true, // required for HttpOnly cookie refresh token
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Client-Type',
      'X-Requested-With',
    ],
    exposedHeaders: ['Retry-After'],
    maxAge: 600, // cache preflight for 10 min
  })
);

// ═══════════════════════════════════════════════════════
// ⚠️  WEBHOOK ROUTES FIRST — MUST NOT be parsed by express.json()
//      HMAC verification needs the raw bytes.
// ═══════════════════════════════════════════════════════
app.use('/api/v1/webhooks', webhookRoutes);

// ─── Body parsers (AFTER webhook routes) ────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ─── Health check ───────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// ─── API routes ─────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/vtu', vtuRoutes);
app.use('/api/v1/admin', adminRoutes);

// ─── 404 handler ────────────────────────────────────────
app.use((req: Request, _res: Response, next: NextFunction) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
});

// ─── Global error handler (last) ────────────────────────
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  // Retry-After header for rate-limit responses
  if (err instanceof ApiError) {
    const retryAfter = (err as ApiError & { retryAfter?: number }).retryAfter;
    if (retryAfter && Number.isFinite(retryAfter)) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfter))));
    }
  }
  errorMiddleware(err, req, res, next);
});

export default app;