import { Request, Response, NextFunction } from 'express';
import { redis, redisKeys } from '../config/redis';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';

const TTL_SECONDS = 60 * 5;

export async function idempotencyMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const key = req.header('Idempotency-Key') ?? req.header('idempotency-key');

  if (!key) {
    return next(ApiError.badRequest('Idempotency-Key header is required', 'IDEMPOTENCY_KEY_MISSING'));
  }
  if (key.length < 8 || key.length > 128) {
    return next(ApiError.badRequest('Idempotency-Key must be 8–128 characters', 'IDEMPOTENCY_KEY_INVALID'));
  }
  if (!/^[A-Za-z0-9_-]+$/.test(key)) {
    return next(ApiError.badRequest('Idempotency-Key contains invalid characters', 'IDEMPOTENCY_KEY_INVALID'));
  }

  // ═══ FAIL-CLOSED on Redis error ═══
  // If we cannot safely claim the key, we MUST reject the request.
  // Proceeding could double-charge the user.
  let claimed: string | null;
  try {
    claimed = await redis.set(
      redisKeys.idempotency(key),
      '1',
      'EX',
      TTL_SECONDS,
      'NX'
    );
  } catch (err) {
    logger.error(
      { err, idempotencyKey: key },
      '[idempotency] Redis unavailable — failing closed'
    );
    return next(
      ApiError.internal(
        'Cannot process request right now. Please retry.',
        'IDEMPOTENCY_UNAVAILABLE'
      )
    );
  }

  if (claimed !== 'OK') {
    return next(
      ApiError.conflict(
        'Duplicate request detected (idempotency key already used)',
        'DUPLICATE_REQUEST'
      )
    );
  }

  next();
}