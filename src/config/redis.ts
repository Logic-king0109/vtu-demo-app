import Redis from 'ioredis';
import { env } from './env';

// Main client — used for idempotency keys, OTP store, PIN lockout,
// rate limits, and plan/pricing cache.
const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createClient(): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy(times) {
      // Exponential backoff up to 2s, keep trying — Redis is critical infra
      return Math.min(times * 200, 2000);
    },
  });

  client.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[redis] error:', err.message);
  });

  client.on('connect', () => {
    if (env.isDev) {
      // eslint-disable-next-line no-console
      console.log('[redis] connected');
    }
  });

  return client;
}

export const redis = globalForRedis.redis ?? createClient();

if (env.isDev) {
  globalForRedis.redis = redis;
}

// ─── Namespaced key builders (avoid collisions) ─────────
export const redisKeys = {
  // Idempotency fast-lane (DB is source of truth)
  idempotency: (key: string) => `idem:${key}`,
  // OTP password reset
  passwordResetOtp: (userId: string) => `pwreset:otp:${userId}`,
  passwordResetAttempts: (userId: string) => `pwreset:attempts:${userId}`,
  // PIN lockout
  pinLock: (userId: string) => `pin:lock:${userId}`,
  pinAttempts: (userId: string) => `pin:attempts:${userId}`,
  // Cached read paths
  dataPlans: (network: string) => `cache:plans:${network}`,
  cableBouquets: (provider: string) => `cache:cable:${provider}`,
  serviceConfig: (key: string) => `cache:svc:${key}`,
} as const;

// ─── Health check ───────────────────────────────────────
export async function checkRedisConnection(): Promise<void> {
  const pong = await redis.ping();
  if (pong !== 'PONG') throw new Error('Redis ping failed');
}

// ─── Graceful shutdown ──────────────────────────────────
export async function disconnectRedis(): Promise<void> {
  await redis.quit();
}