import { randomBytes } from 'crypto';

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function datePart(d: Date = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function randomPart(bytes = 4): string {
  // Hex, uppercase, `bytes` bytes → 2*bytes chars
  return randomBytes(bytes).toString('hex').toUpperCase();
}

/**
 * Human-readable transaction reference:
 *   VTU-20250101-A1B2C3D4
 */
export function generateReference(prefix = 'VTU'): string {
  return `${prefix}-${datePart()}-${randomPart(4)}`;
}

/**
 * Idempotency key used by purchase endpoints.
 * Deterministic per request from client-supplied key OR generated here.
 */
export function generateIdempotencyKey(): string {
  return `${Date.now()}-${randomPart(8)}`;
}