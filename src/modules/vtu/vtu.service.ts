import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { redis, redisKeys } from '../../config/redis';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { generateReference } from '../../utils/generateReference';
import { calculateProfit } from '../../utils/calculateProfit';
import {
  purchaseDataWithFallback,
  purchaseAirtimeWithFallback,
  purchaseCableWithFallback,
  verifyCableCustomerWithFallback,
} from '../../services/providerFallback.service';
import type {
  BuyDataInput, BuyAirtimeInput, BuyCableInput,
  VerifyCableInput, TransactionsQuery,
} from './vtu.validation';

// ═════════════════════════════════════════════════════════════
// PIN verification + lockout
// ═════════════════════════════════════════════════════════════

async function verifyPinOrThrow(userId: string, pin: string): Promise<void> {
  const locked = await redis.get(redisKeys.pinLock(userId));
  if (locked) {
    throw ApiError.tooMany(
      `Too many wrong PIN attempts. Try again in ${env.PIN_LOCK_MINUTES} minutes.`,
      'PIN_LOCKED'
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pinHash: true, pinFailedAttempts: true },
  });
  if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');

  const ok = await bcrypt.compare(pin, user.pinHash);

  if (!ok) {
    const attempts = await redis.incr(redisKeys.pinAttempts(userId));
    if (attempts === 1) {
      await redis.expire(redisKeys.pinAttempts(userId), env.PIN_LOCK_MINUTES * 60);
    }

    await prisma.user.update({
      where: { id: userId },
      data: { pinFailedAttempts: { increment: 1 } },
    });

    if (attempts >= env.PIN_MAX_ATTEMPTS) {
      await redis.set(
        redisKeys.pinLock(userId),
        '1',
        'EX',
        env.PIN_LOCK_MINUTES * 60
      );
      await prisma.user.update({
        where: { id: userId },
        data: { pinLockedUntil: new Date(Date.now() + env.PIN_LOCK_MINUTES * 60_000) },
      });
      logger.warn({ userId, attempts }, '[vtu] PIN locked after max attempts');
      throw ApiError.tooMany(
        `Too many wrong PIN attempts. Locked for ${env.PIN_LOCK_MINUTES} minutes.`,
        'PIN_LOCKED'
      );
    }

    throw ApiError.badRequest('Incorrect transaction PIN', 'INVALID_PIN');
  }

  await redis.del(redisKeys.pinAttempts(userId), redisKeys.pinLock(userId));
  if (user.pinFailedAttempts > 0) {
    await prisma.user.update({
      where: { id: userId },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });
  }
}

// ═════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════

async function ensureUserActive(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, wallet: { select: { id: true } } },
  });
  if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
  if (user.status === 'BLOCKED') throw ApiError.forbidden('Account blocked', 'ACCOUNT_BLOCKED');
  if (!user.wallet) throw ApiError.internal('Wallet missing', 'WALLET_MISSING');
  return user;
}

/**
 * Debit wallet atomically inside a $transaction and create PENDING txn.
 *
 * BUG FIX #2 — race condition:
 *   We use `updateMany` with a `balance: { gte: amount }` guard so the
 *   check AND decrement happen in a single SQL statement. Postgres locks
 *   the row for the duration. Two concurrent requests will serialize:
 *     - Request A: updateMany succeeds (count=1)
 *     - Request B: updateMany fails   (count=0) → INSUFFICIENT_BALANCE
 *   No read-then-write window. No overdraft possible.
 */
async function debitAndCreatePending(
  userId: string,
  args: {
    type: 'DATA' | 'AIRTIME' | 'CABLE';
    amount: Prisma.Decimal;
    sellingPrice: Prisma.Decimal;
    providerCost: Prisma.Decimal;
    profit: Prisma.Decimal;
    idempotencyKey: string;
    meta: Prisma.InputJsonValue;
  }
): Promise<{ transactionId: string; reference: string }> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.wallet.updateMany({
      where: {
        userId,
        balance: { gte: args.amount },
      },
      data: {
        balance: { decrement: args.amount },
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      throw ApiError.badRequest('Insufficient wallet balance', 'INSUFFICIENT_BALANCE');
    }

    const reference = generateReference('VTU');

    const created = await tx.transaction.create({
      data: {
        userId,
        reference,
        type: args.type,
        status: 'PENDING',
        amount: args.amount,
        sellingPrice: args.sellingPrice,
        providerCost: args.providerCost,
        profit: args.profit,
        idempotencyKey: args.idempotencyKey,
        meta: args.meta,
      },
      select: { id: true, reference: true },
    });

    return { transactionId: created.id, reference: created.reference };
  });
}

async function markSuccess(
  transactionId: string,
  providerUsed: 'A' | 'B' | 'C' | undefined,
  providerRef: string | undefined,
  providerResponse: unknown
): Promise<void> {
  await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      status: 'SUCCESS',
      providerTried: providerUsed,
      providerRef: providerRef ?? null,
      providerResponse: providerResponse as Prisma.InputJsonValue,
      failureReason: null,
    },
  });
}

/**
 * Auto-refund: credit back + mark transaction FAILED.
 *
 * BUG FIX #3 — meta wipe:
 *   Previously did `meta: attempts`, destroying the original
 *   { network, phone, planName }. Now we read the current meta first,
 *   then merge { ...oldMeta, providerAttempts, refundedAt }.
 *   Receipt + admin view keep full context.
 */
async function refundAndMarkFailed(
  transactionId: string,
  userId: string,
  reason: string,
  providerAttempts: unknown,
  providerResponse: unknown
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const txn = await tx.transaction.findUnique({
      where: { id: transactionId },
      select: { amount: true, status: true, meta: true },
    });
    if (!txn || txn.status !== 'PENDING') {
      logger.warn({ transactionId }, '[vtu] refund skipped — txn not PENDING');
      return;
    }

    await tx.wallet.update({
      where: { userId },
      data: {
        balance: { increment: txn.amount },
        version: { increment: 1 },
      },
    });

    const previousMeta =
      (txn.meta as Record<string, unknown> | null) ?? {};

    const mergedMeta: Prisma.InputJsonValue = {
      ...previousMeta,
      providerAttempts: providerAttempts as Prisma.InputJsonValue,
      refundedAt: new Date().toISOString(),
    };

    await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'FAILED',
        profit: new Prisma.Decimal(0),
        failureReason: reason,
        providerResponse: providerResponse as Prisma.InputJsonValue,
        meta: mergedMeta,
      },
    });
  });

  logger.error(
    { transactionId, userId, reason },
    '[vtu] provider failure — wallet refunded'
  );
}

// ═════════════════════════════════════════════════════════════
// BUY DATA
// ═════════════════════════════════════════════════════════════

export async function buyData(
  userId: string,
  input: BuyDataInput,
  idempotencyKey: string
) {
  await verifyPinOrThrow(userId, input.pin);
  await ensureUserActive(userId);

  const plan = await prisma.dataPlan.findUnique({
    where: { id: input.planId },
    select: {
      id: true, network: true, name: true, enabled: true,
      sellingPrice: true, providerCost: true,
      providerPlanA: true, providerPlanB: true, providerPlanC: true,
    },
  });
  if (!plan) throw ApiError.notFound('Data plan not found', 'PLAN_NOT_FOUND');
  if (!plan.enabled) throw ApiError.badRequest('This plan is currently unavailable', 'PLAN_DISABLED');

  const profit = calculateProfit(plan.sellingPrice, plan.providerCost);

  // Debit-first (atomic)
  const { transactionId, reference } = await debitAndCreatePending(userId, {
    type: 'DATA',
    amount: plan.sellingPrice,
    sellingPrice: plan.sellingPrice,
    providerCost: plan.providerCost,
    profit,
    idempotencyKey,
    meta: {
      network: plan.network,
      planId: plan.id,
      planName: plan.name,
      phone: input.phone,
    },
  });

  // BUG FIX #1 — pass ALL 3 plan codes. Each adapter picks its own.
  const fallback = await purchaseDataWithFallback({
    network: plan.network,
    phone: input.phone,
    planCodes: {
      A: plan.providerPlanA,
      B: plan.providerPlanB,
      C: plan.providerPlanC,
    },
  });

  if (fallback.success && fallback.result) {
    await markSuccess(
      transactionId,
      fallback.providerUsed,
      fallback.result.providerReference,
      fallback.result.raw
    );
    return {
      transactionId,
      reference,
      status: 'SUCCESS' as const,
      message: 'Data purchase successful',
    };
  }

  await refundAndMarkFailed(
    transactionId,
    userId,
    'All providers failed to deliver data',
    fallback.attempts,
    null
  );
  return {
    transactionId,
    reference,
    status: 'FAILED' as const,
    message: 'Data purchase failed. Your wallet has been refunded.',
  };
}

// ═════════════════════════════════════════════════════════════
// BUY AIRTIME
// ═════════════════════════════════════════════════════════════

export async function buyAirtime(
  userId: string,
  input: BuyAirtimeInput,
  idempotencyKey: string
) {
  await verifyPinOrThrow(userId, input.pin);
  await ensureUserActive(userId);

  const cfg = await prisma.serviceConfig.findUnique({
    where: { key: `AIRTIME_${input.network}` },
    select: { enabled: true, marginPct: true, minAmount: true, maxAmount: true },
  });
  if (cfg && !cfg.enabled) {
    throw ApiError.badRequest('Airtime for this network is currently unavailable', 'AIRTIME_DISABLED');
  }
  if (cfg?.minAmount && new Prisma.Decimal(input.amount).lessThan(cfg.minAmount)) {
    throw ApiError.badRequest(`Minimum amount is ₦${cfg.minAmount.toFixed(2)}`, 'AMOUNT_BELOW_MIN');
  }
  if (cfg?.maxAmount && new Prisma.Decimal(input.amount).greaterThan(cfg.maxAmount)) {
    throw ApiError.badRequest(`Maximum amount is ₦${cfg.maxAmount.toFixed(2)}`, 'AMOUNT_ABOVE_MAX');
  }

  const marginPct = cfg?.marginPct ?? new Prisma.Decimal(0);
  const providerCost = new Prisma.Decimal(input.amount);
  const sellingPrice = providerCost.mul(marginPct.div(100).plus(1)).toDecimalPlaces(2);
  const profit = calculateProfit(sellingPrice, providerCost);

  const { transactionId, reference } = await debitAndCreatePending(userId, {
    type: 'AIRTIME',
    amount: sellingPrice,
    sellingPrice,
    providerCost,
    profit,
    idempotencyKey,
    meta: {
      network: input.network,
      phone: input.phone,
      amountRequested: input.amount,
      marginPct: marginPct.toFixed(2),
    },
  });

  const fallback = await purchaseAirtimeWithFallback({
    network: input.network,
    amount: input.amount,
    phone: input.phone,
  });

  if (fallback.success && fallback.result) {
    await markSuccess(
      transactionId,
      fallback.providerUsed,
      fallback.result.providerReference,
      fallback.result.raw
    );
    return {
      transactionId,
      reference,
      status: 'SUCCESS' as const,
      message: 'Airtime purchase successful',
    };
  }

  await refundAndMarkFailed(
    transactionId,
    userId,
    'All providers failed to deliver airtime',
    fallback.attempts,
    null
  );
  return {
    transactionId,
    reference,
    status: 'FAILED' as const,
    message: 'Airtime purchase failed. Your wallet has been refunded.',
  };
}

// ═════════════════════════════════════════════════════════════
// VERIFY CABLE CUSTOMER
// ═════════════════════════════════════════════════════════════

export async function verifyCableCustomer(input: VerifyCableInput) {
  const result = await verifyCableCustomerWithFallback({
    provider: input.provider,
    smartcardNumber: input.smartcardNumber,
  });
  if (!result.success || !result.data) {
    throw ApiError.badRequest(
      'Could not verify smartcard number. Please check and try again.',
      'CABLE_VERIFY_FAILED'
    );
  }
  return {
    customerName: result.data.customerName,
    customerNumber: result.data.customerNumber,
    provider: input.provider,
  };
}

// ═════════════════════════════════════════════════════════════
// BUY CABLE
// ═════════════════════════════════════════════════════════════

export async function buyCable(
  userId: string,
  input: BuyCableInput,
  idempotencyKey: string
) {
  await verifyPinOrThrow(userId, input.pin);
  await ensureUserActive(userId);

  const bouquet = await prisma.cableBouquet.findUnique({
    where: { id: input.bouquetId },
    select: {
      id: true, provider: true, name: true, enabled: true,
      sellingPrice: true, providerCost: true,
      providerPlanA: true, providerPlanB: true, providerPlanC: true,
    },
  });
  if (!bouquet) throw ApiError.notFound('Bouquet not found', 'BOUQUET_NOT_FOUND');
  if (!bouquet.enabled) throw ApiError.badRequest('This bouquet is unavailable', 'BOUQUET_DISABLED');
  if (bouquet.provider !== input.provider) {
    throw ApiError.badRequest('Bouquet does not belong to selected provider', 'BOUQUET_MISMATCH');
  }

  const profit = calculateProfit(bouquet.sellingPrice, bouquet.providerCost);

  const { transactionId, reference } = await debitAndCreatePending(userId, {
    type: 'CABLE',
    amount: bouquet.sellingPrice,
    sellingPrice: bouquet.sellingPrice,
    providerCost: bouquet.providerCost,
    profit,
    idempotencyKey,
    meta: {
      provider: bouquet.provider,
      bouquetId: bouquet.id,
      bouquetName: bouquet.name,
      smartcardNumber: input.smartcardNumber,
    },
  });

  // BUG FIX #1 — pass all 3 plan codes, adapter picks its own.
  const fallback = await purchaseCableWithFallback({
    provider: bouquet.provider,
    smartcardNumber: input.smartcardNumber,
    planCodes: {
      A: bouquet.providerPlanA,
      B: bouquet.providerPlanB,
      C: bouquet.providerPlanC,
    },
  });

  if (fallback.success && fallback.result) {
    await markSuccess(
      transactionId,
      fallback.providerUsed,
      fallback.result.providerReference,
      fallback.result.raw
    );
    return {
      transactionId,
      reference,
      status: 'SUCCESS' as const,
      message: 'Cable subscription successful',
    };
  }

  await refundAndMarkFailed(
    transactionId,
    userId,
    'All providers failed to deliver cable subscription',
    fallback.attempts,
    null
  );
  return {
    transactionId,
    reference,
    status: 'FAILED' as const,
    message: 'Cable subscription failed. Your wallet has been refunded.',
  };
}

// ═════════════════════════════════════════════════════════════
// UNIFIED TRANSACTION HISTORY
// ═════════════════════════════════════════════════════════════

export async function getUserTransactions(userId: string, query: TransactionsQuery) {
  const { page, limit, type, status, from, to } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.TransactionWhereInput = {
    userId,
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true, reference: true, type: true, status: true,
        amount: true, failureReason: true, createdAt: true, meta: true,
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    items: items.map((t) => ({
      id: t.id,
      reference: t.reference,
      type: t.type,
      status: t.status,
      amount: t.amount.toFixed(2),
      failureReason: t.failureReason,
      createdAt: t.createdAt,
      meta: t.meta,
    })),
    pagination: {
      page, limit, total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}

// ═════════════════════════════════════════════════════════════
// Receipt
// ═════════════════════════════════════════════════════════════

export async function getTransactionReceipt(userId: string, reference: string) {
  const txn = await prisma.transaction.findFirst({
    where: { reference, userId },
    select: {
      id: true, reference: true, type: true, status: true,
      amount: true, failureReason: true, createdAt: true, updatedAt: true,
      meta: true, providerRef: true,
    },
  });
  if (!txn) throw ApiError.notFound('Transaction not found', 'TXN_NOT_FOUND');

  return {
    id: txn.id,
    reference: txn.reference,
    type: txn.type,
    status: txn.status,
    amount: txn.amount.toFixed(2),
    failureReason: txn.failureReason,
    createdAt: txn.createdAt,
    updatedAt: txn.updatedAt,
    providerRef: txn.providerRef,
    meta: txn.meta,
  };
}