import { env } from '../config/env';
import { logger } from '../utils/logger';
import { ApiError } from '../utils/ApiError';

type ProviderKey = 'A' | 'B' | 'C';

type ProviderCredentials = {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  timeoutMs: number;
};

export function getProviderCredentials(key: ProviderKey): ProviderCredentials {
  switch (key) {
    case 'A':
      return {
        baseUrl: env.PROVIDER_A_BASE_URL,
        apiKey: env.PROVIDER_A_API_KEY,
        apiSecret: env.PROVIDER_A_API_SECRET,
        timeoutMs: env.PROVIDER_A_TIMEOUT_MS,
      };
    case 'B':
      return {
        baseUrl: env.PROVIDER_B_BASE_URL,
        apiKey: env.PROVIDER_B_API_KEY,
        apiSecret: env.PROVIDER_B_API_SECRET,
        timeoutMs: env.PROVIDER_B_TIMEOUT_MS,
      };
    case 'C':
      return {
        baseUrl: env.PROVIDER_C_BASE_URL,
        apiKey: env.PROVIDER_C_API_KEY,
        apiSecret: env.PROVIDER_C_API_SECRET,
        timeoutMs: env.PROVIDER_C_TIMEOUT_MS,
      };
  }
}

/**
 * Fetch with per-provider timeout. Throws ApiError on timeout so the
 * fallback orchestrator can catch and try the next provider.
 */
export async function providerFetch(
  key: ProviderKey,
  path: string,
  init: RequestInit
): Promise<Response> {
  const creds = getProviderCredentials(key);
  const url = `${creds.baseUrl.replace(/\/$/, '')}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), creds.timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      logger.warn({ provider: key, path, timeout: creds.timeoutMs }, '[provider] timeout');
      throw new ApiError(504, `Provider ${key} timed out`, 'PROVIDER_TIMEOUT');
    }
    logger.error({ err, provider: key, path }, '[provider] fetch error');
    throw new ApiError(502, `Provider ${key} unreachable`, 'PROVIDER_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }
}