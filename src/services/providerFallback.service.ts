import { ProviderAdapter, PurchaseResult } from './providers/provider.interface';
import { providerA } from './providers/providerA.adapter';
import { providerB } from './providers/providerB.adapter';
import { providerC } from './providers/providerC.adapter';
import { logger } from '../utils/logger';

/**
 * Ordered chain A → B → C. Disabled providers are skipped.
 * Provider identity lives only in .env, never here.
 */
function getChain(): ProviderAdapter[] {
  return [providerA, providerB, providerC].filter((p) => p.enabled);
}

export type FallbackOutcome = {
  success: boolean;
  providerUsed?: 'A' | 'B' | 'C';
  result?: PurchaseResult;
  attempts: Array<{ provider: 'A' | 'B' | 'C'; success: boolean; message?: string }>;
};

async function runWithFallback<T extends { success: boolean; message?: string }>(
  opName: string,
  op: (adapter: ProviderAdapter) => Promise<T>
): Promise<{ success: boolean; providerUsed?: 'A' | 'B' | 'C'; result?: T; attempts: FallbackOutcome['attempts'] }> {
  const chain = getChain();
  const attempts: FallbackOutcome['attempts'] = [];

  if (chain.length === 0) {
    logger.error({ opName }, '[fallback] no enabled providers');
    return { success: false, attempts };
  }

  for (const adapter of chain) {
    try {
      // ⚠️ CRITICAL: we pass the adapter itself into `op`.
      // The adapter reads planCodes[adapter.key] internally.
      // We never pre-pick a code here — that was the previous bug.
      const res = await op(adapter);
      attempts.push({ provider: adapter.key, success: res.success, message: res.message });

      if (res.success) {
        logger.info({ opName, provider: adapter.key }, '[fallback] success');
        return { success: true, providerUsed: adapter.key, result: res, attempts };
      }

      logger.warn(
        { opName, provider: adapter.key, message: res.message },
        '[fallback] provider returned failure'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      attempts.push({ provider: adapter.key, success: false, message: msg });
      logger.warn({ opName, provider: adapter.key, err: msg }, '[fallback] provider threw');
    }
  }

  logger.error({ opName, attempts }, '[fallback] all providers failed');
  return { success: false, attempts };
}

export async function purchaseDataWithFallback(
  input: Parameters<ProviderAdapter['buyData']>[0]
): Promise<FallbackOutcome> {
  return runWithFallback('buyData', (a) => a.buyData(input)) as Promise<FallbackOutcome>;
}

export async function purchaseAirtimeWithFallback(
  input: Parameters<ProviderAdapter['buyAirtime']>[0]
): Promise<FallbackOutcome> {
  return runWithFallback('buyAirtime', (a) => a.buyAirtime(input)) as Promise<FallbackOutcome>;
}

export async function purchaseCableWithFallback(
  input: Parameters<ProviderAdapter['buyCable']>[0]
): Promise<FallbackOutcome> {
  return runWithFallback('buyCable', (a) => a.buyCable(input)) as Promise<FallbackOutcome>;
}

export async function verifyCableCustomerWithFallback(
  input: Parameters<ProviderAdapter['verifyCableCustomer']>[0]
): Promise<{ success: boolean; providerUsed?: 'A' | 'B' | 'C'; data?: { customerName: string; customerNumber: string } }> {
  const chain = getChain();
  for (const adapter of chain) {
    try {
      const data = await adapter.verifyCableCustomer(input);
      return { success: true, providerUsed: adapter.key, data };
    } catch {
      // try next
    }
  }
  return { success: false };
}