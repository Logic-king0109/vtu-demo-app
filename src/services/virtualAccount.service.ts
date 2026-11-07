import { prisma } from '../config/db';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { ApiError } from '../utils/ApiError';
import { verifyWebhookSignature, isWebhookIpAllowed } from '../utils/webhookSignature';
import { generateReference } from '../utils/generateReference';

// ─── Provider payload shapes (kept generic — no company names) ───

type CreateVAParams = {
  userId: string;
  name: string;
  email: string;
  phone: string;
  bvn?: string; // optional; some VA providers require it
};

type CreateVAResult = {
  accountNumber: string;
  bankName: string;
  accountName: string;
  reference: string;
};

type ProviderFundingEvent = {
  reference: string;
  amount: number;         // Naira
  accountNumber: string;
  paidAt: Date;
  raw: unknown;
};

// ═════════════════════════════════════════════════════════════
// Authentication with VA provider (token-based, cached)
// ═════════════════════════════════════════════════════════════

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getVaAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const basicAuth = Buffer.from(
    `${env.VA_API_KEY}:${env.VA_SECRET_KEY}`
  ).toString('base64');

  const res = await fetch(`${env.VA_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    logger.error({ status: res.status }, '[VA] auth failed');
    throw ApiError.internal('Virtual account provider auth failed', 'VA_AUTH_FAILED');
  }

  const json = (await res.json()) as {
    requestSuccessful: boolean;
    responseBody?: { accessToken: string; expiresIn: number };
  };

  if (!json.requestSuccessful || !json.responseBody) {
    throw ApiError.internal('VA auth returned invalid response', 'VA_AUTH_INVALID');
  }

  cachedToken = {
    value: json.responseBody.accessToken,
    expiresAt: Date.now() + json.responseBody.expiresIn * 1000,
  };
  return cachedToken.value;
}

// ═════════════════════════════════════════════════════════════
// Create virtual account
// ═════════════════════════════════════════════════════════════

export async function createVirtualAccount(
  params: CreateVAParams
): Promise<CreateVAResult> {
  const token = await getVaAccessToken();
  const accountReference = generateReference('VA');

  const res = await fetch(`${env.VA_BASE_URL}/api/v2/bank-transfer/reserved-accounts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountReference,
      accountName: params.name,
      currencyCode: 'NGN',
      contractCode: env.VA_CONTRACT_CODE,
      customerEmail: params.email,
      customerName: params.name,
      customerBvn: params.bvn ?? '',
      getAllAvailableBanks: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, text }, '[VA] createVirtualAccount failed');
    throw ApiError.internal('Could not create virtual account', 'VA_CREATE_FAILED');
  }

  const json = (await res.json()) as {
    requestSuccessful: boolean;
    responseBody?: {
      accountNumber: string;
      bankName: string;
      accountName: string;
      accountReference: string;
    };
    responseMessage?: string;
  };

  if (!json.requestSuccessful || !json.responseBody) {
    logger.error({ json }, '[VA] createVirtualAccount invalid response');
    throw ApiError.internal('Invalid response from virtual account provider', 'VA_CREATE_INVALID');
  }

  return {
    accountNumber: json.responseBody.accountNumber,
    bankName: json.responseBody.bankName,
    accountName: json.responseBody.accountName,
    reference: json.responseBody.accountReference,
  };
}

/**
 * Called from webhook controller AFTER signature verification + WebhookLog insert.
 * Parses provider-agnostic funding event, finds user by vaNumber, credits wallet.
 *
 * Idempotency: Transaction.reference is unique — second webhook with same
 * reference silently returns "already processed".
 */
export async function processFundingEvent(
  event: ProviderFundingEvent
): Promise<{ credited: boolean; reason?: string }> {
  return prisma.$transaction(async (tx) => {
    // 1) Locate user by virtual account number
    const user = await tx.user.findUnique({
      where: { vaNumber: event.accountNumber },
      select: { id: true, wallet: { select: { id: true } } },
    });

    if (!user || !user.wallet) {
      logger.warn({ accountNumber: event.accountNumber }, '[VA] funding for unknown account');
      return { credited: false, reason: 'UNKNOWN_ACCOUNT' };
    }

    // 2) Idempotency via unique reference (throw P2002 on duplicate → caught by service caller)
    const existing = await tx.transaction.findUnique({
      where: { reference: event.reference },
      select: { id: true },
    });
    if (existing) {
      return { credited: false, reason: 'DUPLICATE' };
    }

    // 3) Credit wallet
    await tx.wallet.update({
      where: { userId: user.id },
      data: { balance: { increment: event.amount }, version: { increment: 1 } },
    });

    // 4) Record transaction
    await tx.transaction.create({
      data: {
        userId: user.id,
        reference: event.reference,
        type: 'FUNDING',
        status: 'SUCCESS',
        amount: event.amount,
        providerCost: 0,
        sellingPrice: 0,
        profit: 0,
        providerTried: 'VA',
        providerRef: event.reference,
        meta: { accountNumber: event.accountNumber, paidAt: event.paidAt.toISOString() },
        providerResponse: event.raw as object,
      },
    });

    return { credited: true };
  });
}

// ═════════════════════════════════════════════════════════════
// Webhook verification + parsing
// ═════════════════════════════════════════════════════════════

export type WebhookParseResult =
  | { kind: 'IGNORED'; reason: string }
  | { kind: 'FUNDING'; event: ProviderFundingEvent };

export function verifyAndParseWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  ip: string | undefined
): { signatureOk: boolean; ipOk: boolean; parsed?: WebhookParseResult; raw: unknown } {
  const ipOk = isWebhookIpAllowed(ip);
  const signatureOk = verifyWebhookSignature(rawBody, signatureHeader, 'sha512');

  let raw: unknown = null;
  try {
    raw = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { signatureOk, ipOk, raw: null };
  }

  if (!signatureOk || !ipOk) {
    return { signatureOk, ipOk, raw };
  }

  // ── Parse provider-agnostic funding event ──
  // Adjust this mapper if the VA provider's payload shape changes.
  const body = raw as {
    eventType?: string;
    eventData?: {
      transactionReference?: string;
      amountPaid?: number | string;
      destinationAccountNumber?: string;
      paidOn?: string;
    };
  };

  if (body.eventType !== 'SUCCESSFUL_TRANSACTION' || !body.eventData) {
    return {
      signatureOk,
      ipOk,
      raw,
      parsed: { kind: 'IGNORED', reason: body.eventType ?? 'NO_EVENT_TYPE' },
    };
  }

  const d = body.eventData;
  if (!d.transactionReference || !d.destinationAccountNumber || d.amountPaid == null) {
    return {
      signatureOk,
      ipOk,
      raw,
      parsed: { kind: 'IGNORED', reason: 'MISSING_FIELDS' },
    };
  }

  const amount =
    typeof d.amountPaid === 'string' ? parseFloat(d.amountPaid) : d.amountPaid;

  return {
    signatureOk,
    ipOk,
    raw,
    parsed: {
      kind: 'FUNDING',
      event: {
        reference: d.transactionReference,
        amount,
        accountNumber: d.destinationAccountNumber,
        paidAt: d.paidOn ? new Date(d.paidOn) : new Date(),
        raw,
      },
    },
  };
}