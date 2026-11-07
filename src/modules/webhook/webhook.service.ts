import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { ApiError } from '../../utils/ApiError';
import {
  verifyAndParseWebhook,
  processFundingEvent,
} from '../../services/virtualAccount.service';

export type WebhookResult = {
  httpStatus: number;
  body: { success: boolean; message: string; code?: string };
};

/**
 * Central entry point for incoming VA provider webhooks.
 *
 * Order of operations (matches spec Part 2):
 *   1. Verify HMAC signature + IP allowlist (reject 401 on failure)
 *   2. Parse payload (reject 400 on malformed JSON)
 *   3. Insert WebhookLog  (BEFORE any money logic — audit trail)
 *   4. Dispatch:
 *        - Funding event  → credit wallet + create FUNDING txn
 *        - Other event    → mark processed as IGNORED
 *   5. Mark WebhookLog processed (or error)
 *
 * Idempotency:
 *   - Duplicate reference → processFundingEvent returns DUPLICATE → 200 OK
 *   - Pre-check on Transaction.reference + unique constraint both protect us
 *
 * Always returns HTTP 200 for handled idempotent duplicates (providers
 * retry on non-2xx, so we must not signal error for a completed txn).
 */
export async function handleVaWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  ip: string | undefined
): Promise<WebhookResult> {
  // ─── 1. Verify signature + IP ────────────────────────
  const { signatureOk, ipOk, raw, parsed } = verifyAndParseWebhook(
    rawBody,
    signatureHeader,
    ip
  );

  // ─── 2. Malformed JSON ───────────────────────────────
  if (raw === null) {
    // Log rejected attempt (no signature check on unparseable body)
    await logWebhook({
      signatureOk: false,
      ipAddress: ip,
      rawPayload: { _error: 'malformed_json', _rawPreview: rawBody.toString('utf8').slice(0, 500) },
      processed: false,
      error: 'MALFORMED_JSON',
    });
    return {
      httpStatus: 400,
      body: { success: false, message: 'Malformed JSON', code: 'MALFORMED_JSON' },
    };
  }

  // ─── 3. Reject bad signature or bad IP ───────────────
  if (!signatureOk || !ipOk) {
    await logWebhook({
      signatureOk,
      ipAddress: ip,
      rawPayload: raw as Prisma.InputJsonValue,
      processed: false,
      error: !signatureOk ? 'BAD_SIGNATURE' : 'IP_NOT_ALLOWED',
    });
    logger.warn(
      { ip, signatureOk, ipOk },
      '[webhook] rejected — signature or IP check failed'
    );
    return {
      httpStatus: 401,
      body: { success: false, message: 'Invalid signature', code: 'INVALID_SIGNATURE' },
    };
  }

  // ─── 4. Log webhook BEFORE processing ────────────────
  const logId = await logWebhook({
    signatureOk: true,
    ipAddress: ip,
    rawPayload: raw as Prisma.InputJsonValue,
    processed: false,
    error: null,
  });

  // ─── 5. Dispatch ─────────────────────────────────────
  try {
    if (!parsed) {
      await markWebhookProcessed(logId, null);
      return {
        httpStatus: 200,
        body: { success: true, message: 'Received (no parser output)' },
      };
    }

    if (parsed.kind === 'IGNORED') {
      await markWebhookProcessed(logId, null);
      return {
        httpStatus: 200,
        body: { success: true, message: `Ignored: ${parsed.reason}` },
      };
    }

    // parsed.kind === 'FUNDING'
    const result = await processFundingEvent(parsed.event);
    await markWebhookProcessed(logId, null);

    if (!result.credited) {
      // Idempotent duplicate → 200 (provider will stop retrying)
      // Unknown account → also 200 (not provider's fault, don't loop)
      return {
        httpStatus: 200,
        body: { success: true, message: `No credit applied: ${result.reason}` },
      };
    }

    return {
      httpStatus: 200,
      body: { success: true, message: 'Wallet credited' },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';

    // Unique constraint violation = concurrent duplicate webhook.
    // Idempotent → return 200.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      await markWebhookProcessed(logId, 'DUPLICATE_P2002');
      logger.info({ logId }, '[webhook] duplicate (P2002) — treated as idempotent');
      return {
        httpStatus: 200,
        body: { success: true, message: 'Duplicate — already processed' },
      };
    }

    await markWebhookProcessed(logId, message.slice(0, 500));
    logger.error({ err, logId }, '[webhook] processing error');

    // Return 500 → provider will retry. Our WebhookLog has the raw body
    // so an admin can manually replay later.
    throw ApiError.internal('Webhook processing error', 'WEBHOOK_PROCESSING_ERROR');
  }
}

// ═════════════════════════════════════════════════════════════
// Logging helpers
// ═════════════════════════════════════════════════════════════

async function logWebhook(args: {
  signatureOk: boolean;
  ipAddress: string | undefined;
  rawPayload: Prisma.InputJsonValue;
  processed: boolean;
  error: string | null;
}): Promise<string> {
  const log = await prisma.webhookLog.create({
    data: {
      source: 'VA',
      eventType:
        typeof args.rawPayload === 'object' &&
        args.rawPayload !== null &&
        'eventType' in args.rawPayload &&
        typeof (args.rawPayload as Record<string, unknown>).eventType === 'string'
          ? ((args.rawPayload as Record<string, unknown>).eventType as string)
          : null,
      reference:
        typeof args.rawPayload === 'object' &&
        args.rawPayload !== null &&
        'eventData' in args.rawPayload &&
        typeof (args.rawPayload as Record<string, unknown>).eventData === 'object' &&
        (args.rawPayload as Record<string, unknown>).eventData !== null &&
        'transactionReference' in
          ((args.rawPayload as Record<string, unknown>).eventData as Record<string, unknown>)
          ? (((args.rawPayload as Record<string, unknown>).eventData as Record<string, unknown>)
              .transactionReference as string) ?? null
          : null,
      signatureOk: args.signatureOk,
      ipAddress: args.ipAddress?.slice(0, 60) ?? null,
      rawPayload: args.rawPayload,
      processed: args.processed,
      error: args.error,
    },
    select: { id: true },
  });
  return log.id;
}

async function markWebhookProcessed(
  id: string,
  error: string | null
): Promise<void> {
  await prisma.webhookLog.update({
    where: { id },
    data: { processed: true, error },
  });
}