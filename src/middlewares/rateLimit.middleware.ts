import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

// ─── Shared key builders ────────────────────────────────
function ipKey(req: Request): string {
  // req.ip is populated when `trust proxy` is set in app.ts
  return `ip:${req.ip ?? 'unknown'}`;
}

function userKey(req: Request): string {
  return `user:${req.user?.id ?? req.ip ?? 'unknown'}`;
}

// ─── Limiter factory ────────────────────────────────────
function makeLimiter(points: number, windowSec: number, keyPrefix: string) {
  return new RateLimiterRedis({
    storeClient: redis,
    keyPrefix,
    points,
    duration: windowSec,
    blockDuration: 0, // no auto-block; window resets naturally
  });
}

// ─── Limiters (constructed once at module load) ─────────
const authLimiter = makeLimiter(
  env.RATE_LIMIT_AUTH_POINTS,
  env.RATE_LIMIT_AUTH_WINDOW_SEC,
  'rl:auth'
);

const purchaseLimiter = makeLimiter(
  env.RATE_LIMIT_PURCHASE_POINTS,
  env.RATE_LIMIT_PURCHASE_WINDOW_SEC,
  'rl:purchase'
);

const webhookLimiter = makeLimiter(
  env.RATE_LIMIT_WEBHOOK_POINTS,
  env.RATE_LIMIT_WEBHOOK_WINDOW_SEC,
  'rl:webhook'
);

// ─── Generic runner ─────────────────────────────────────
async function run(
  limiter: RateLimiterRedis,
  key: string,
  next: NextFunction
): Promise<void> {
  try {
    await limiter.consume(key);
    next();
  } catch (err) {
    if (err instanceof RateLimiterRes || (err as RateLimiterRes)?.msBeforeNext) {
      const res = err as RateLimiterRes;
      const retryAfterSec = Math.ceil(res.msBeforeNext / 1000);
      const e = ApiError.tooMany('Too many requests, slow down', 'RATE_LIMITED');
      (e as ApiError & { retryAfter?: number }).retryAfter = retryAfterSec;
      return next(e);
    }
    // Unexpected limiter failure — fail open, log it
    // (Rate limiter down shouldn't block all traffic.)
    // eslint-disable-next-line no-console
    console.error('[rateLimit] limiter error:', err);
    next();
  }
}

// ─── Public middlewares ─────────────────────────────────

/** Auth routes: limit by IP (no user yet). */
export function rateLimitAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  return run(authLimiter, ipKey(req), next);
}

/** Purchases: limit by user (post-auth). */
export function rateLimitPurchase(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  return run(purchaseLimiter, userKey(req), next);
}

/** Webhooks: limit by IP (sender is the VA provider). */
export function rateLimitWebhook(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  return run(webhookLimiter, ipKey(req), next);
}