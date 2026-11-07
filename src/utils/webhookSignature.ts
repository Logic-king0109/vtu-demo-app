import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env';

/**
 * Verify an HMAC-SHA512 (configurable) signature for incoming webhooks.
 *
 * IMPORTANT:
 *   - Uses timingSafeEqual to prevent timing attacks.
 *   - Rejects if header missing or malformed.
 *   - Some providers send "sha256=..." prefix — we strip it.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  algorithm: 'sha256' | 'sha512' = 'sha512'
): boolean {
  if (!signatureHeader) return false;

  // Strip any "sha256=" / "sha512=" prefix
  const providedSig = signatureHeader.includes('=')
    ? signatureHeader.split('=')[1]
    : signatureHeader;

  if (!providedSig || !/^[a-f0-9]+$/i.test(providedSig)) return false;

  const computed = createHmac(algorithm, env.VA_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // Buffers must be equal length for timingSafeEqual, else it throws
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(providedSig, 'hex');

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Optional IP allowlist check. Returns true when:
 *   - Allowlist is empty (disabled), OR
 *   - IP matches an allowed entry.
 */
export function isWebhookIpAllowed(ip: string | undefined): boolean {
  if (env.VA_WEBHOOK_IP_ALLOWLIST.length === 0) return true;
  if (!ip) return false;
  // Normalize IPv6-mapped IPv4 (::ffff:1.2.3.4 → 1.2.3.4)
  const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return env.VA_WEBHOOK_IP_ALLOWLIST.includes(normalized);
}