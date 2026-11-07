import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { prisma } from '../../config/db';
import { ApiError } from '../../utils/ApiError';
import { generateReference } from '../../utils/generateReference';
import { calculateProfit } from '../../utils/calculateProfit';
import type {
  UsersListQuery, UserIdParams, BlockUserBody,
  ResetUserPasswordBody, AdjustWalletBody, TransactionsListQuery,
  TxnIdParams, MarkTxnBody, RefundTxnBody,
  UpdateDataPlanBody, CreateDataPlanBody, DataPlanIdParams,
  UpdateBouquetBody, BouquetIdParams,
  UpdateServiceConfigBody, ServiceConfigKeyParams,
  AnnouncementBody, AuditListQuery,
} from './admin.validation';

const BCRYPT_ROUNDS = 12;

type DashboardRangeValue = 'today' | '7d' | '30d' | 'all';

// ═════════════════════════════════════════════════════════════
// Shared guards
// ═════════════════════════════════════════════════════════════

async function assertAdminCanTargetUser(
  tx: Prisma.TransactionClient | typeof prisma,
  actorId: string,
  targetUserId: string
): Promise<{ id: string; role: 'USER' | 'ADMIN'; status: 'ACTIVE' | 'BLOCKED' }> {
  if (actorId === targetUserId) {
    throw ApiError.forbidden(
      'Admin cannot perform this action on their own account',
      'ADMIN_CANNOT_ADJUST_SELF'
    );
  }
  const target = await tx.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, status: true },
  });
  if (!target) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
  if (target.role === 'ADMIN') {
    throw ApiError.forbidden(
      'Cannot perform this action on another admin',
      'CANNOT_TARGET_ADMIN'
    );
  }
  return target;
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  args: {
    actorId: string;
    action: string;
    targetType?: string;
    targetId?: string;
    meta?: Prisma.InputJsonValue;
    ipAddress?: string | null;
  }
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: args.actorId,
      action: args.action,
      targetType: args.targetType ?? null,
      targetId: args.targetId ?? null,
      meta: args.meta ?? Prisma.JsonNull,
      ipAddress: args.ipAddress?.slice(0, 60) ?? null,
    },
  });
}

// ═════════════════════════════════════════════════════════════
// 1. DASHBOARD
// ═════════════════════════════════════════════════════════════

function rangeToStartDate(range: DashboardRangeValue): Date | null {
  const now = new Date();
  switch (range) {
    case 'today': {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'all':
      return null;
    default:
      return null;
  }
}

export async function getDashboard(range: DashboardRangeValue) {
  const startDate = rangeToStartDate(range);
  const dateFilter = startDate ? { gte: startDate } : undefined;

  const [
    totalUsers, activeUsers, blockedUsers, pendingCount,
    totals, mostSoldRows, recentTransactions,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.user.count({ where: { status: 'BLOCKED' } }),
    prisma.transaction.count({ where: { status: 'PENDING' } }),

    prisma.transaction.aggregate({
      where: {
        status: 'SUCCESS',
        ...(dateFilter ? { createdAt: dateFilter } : {}),
        type: { in: ['DATA', 'AIRTIME', 'CABLE'] },
      },
      _sum: { amount: true, profit: true },
      _count: true,
    }),

    prisma.transaction.groupBy({
      by: ['type'],
      where: {
        status: 'SUCCESS',
        ...(dateFilter ? { createdAt: dateFilter } : {}),
        type: { in: ['DATA', 'AIRTIME', 'CABLE'] },
      },
      _count: { type: true },
      orderBy: { _count: { type: 'desc' } },
      take: 1,
    }),

    prisma.transaction.findMany({
      where: dateFilter ? { createdAt: dateFilter } : {},
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, reference: true, type: true, status: true,
        amount: true, profit: true, createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return {
    range,
    users: { total: totalUsers, active: activeUsers, blocked: blockedUsers },
    sales: {
      totalSales: (totals._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      totalProfit: (totals._sum.profit ?? new Prisma.Decimal(0)).toFixed(2),
      transactionCount: totals._count,
    },
    pendingTransactions: pendingCount,
    mostSoldType: mostSoldRows[0]?.type ?? null,
    recentTransactions: recentTransactions.map((t) => ({
      id: t.id, reference: t.reference, type: t.type, status: t.status,
      amount: t.amount.toFixed(2), profit: t.profit.toFixed(2),
      createdAt: t.createdAt, user: t.user,
    })),
  };
}

// ═════════════════════════════════════════════════════════════
// 2. USERS
// ═════════════════════════════════════════════════════════════

export async function listUsers(query: UsersListQuery) {
  const { q, status, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.UserWhereInput = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
          ],
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true, name: true, email: true, phone: true,
        role: true, status: true, createdAt: true,
        wallet: { select: { balance: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items: items.map((u) => ({
      id: u.id, name: u.name, email: u.email, phone: u.phone,
      role: u.role, status: u.status,
      balance: (u.wallet?.balance ?? new Prisma.Decimal(0)).toFixed(2),
      createdAt: u.createdAt,
    })),
    pagination: {
      page, limit, total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}

export async function getUserDetail(params: UserIdParams) {
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, email: true, phone: true,
      role: true, status: true, pinFailedAttempts: true, pinLockedUntil: true,
      vaNumber: true, vaBankName: true, vaAccountName: true,
      createdAt: true, updatedAt: true,
      wallet: { select: { balance: true, updatedAt: true } },
    },
  });
  if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');

  const [recentTxns, totalSpent, totalFunded] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, reference: true, type: true, status: true,
        amount: true, profit: true, createdAt: true,
      },
    }),
    prisma.transaction.aggregate({
      where: { userId: user.id, status: 'SUCCESS', type: { in: ['DATA', 'AIRTIME', 'CABLE'] } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId: user.id, status: 'SUCCESS', type: 'FUNDING' },
      _sum: { amount: true },
    }),
  ]);

  return {
    id: user.id, name: user.name, email: user.email, phone: user.phone,
    role: user.role, status: user.status,
    pinFailedAttempts: user.pinFailedAttempts, pinLockedUntil: user.pinLockedUntil,
    balance: (user.wallet?.balance ?? new Prisma.Decimal(0)).toFixed(2),
    totalSpent: (totalSpent._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
    totalFunded: (totalFunded._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
    virtualAccount: user.vaNumber
      ? { accountNumber: user.vaNumber, bankName: user.vaBankName, accountName: user.vaAccountName }
      : null,
    createdAt: user.createdAt, updatedAt: user.updatedAt,
    recentTransactions: recentTxns.map((t) => ({
      id: t.id, reference: t.reference, type: t.type, status: t.status,
      amount: t.amount.toFixed(2), profit: t.profit.toFixed(2), createdAt: t.createdAt,
    })),
  };
}

export async function blockUser(
  actorId: string,
  params: UserIdParams,
  body: BlockUserBody,
  ip: string | null
) {
  await assertAdminCanTargetUser(prisma, actorId, params.id);

  return prisma.$transaction(async (tx) => {
    const target = await assertAdminCanTargetUser(tx, actorId, params.id);
    if (target.status === 'BLOCKED') {
      return { message: 'User already blocked', status: 'BLOCKED' as const };
    }

    await tx.user.update({
      where: { id: target.id },
      data: { status: 'BLOCKED' },
    });
    await tx.refreshToken.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAudit(tx, {
      actorId, action: 'BLOCK_USER', targetType: 'User', targetId: target.id,
      meta: { reason: body.reason ?? null }, ipAddress: ip,
    });

    return { message: 'User blocked', status: 'BLOCKED' as const };
  });
}

export async function unblockUser(
  actorId: string,
  params: UserIdParams,
  ip: string | null
) {
  await assertAdminCanTargetUser(prisma, actorId, params.id);

  return prisma.$transaction(async (tx) => {
    const target = await assertAdminCanTargetUser(tx, actorId, params.id);
    if (target.status === 'ACTIVE') {
      return { message: 'User already active', status: 'ACTIVE' as const };
    }

    await tx.user.update({
      where: { id: target.id },
      data: { status: 'ACTIVE' },
    });
    await writeAudit(tx, {
      actorId, action: 'UNBLOCK_USER', targetType: 'User', targetId: target.id,
      ipAddress: ip,
    });

    return { message: 'User unblocked', status: 'ACTIVE' as const };
  });
}

export async function resetUserPassword(
  actorId: string,
  params: UserIdParams,
  body: ResetUserPasswordBody,
  ip: string | null
) {
  await assertAdminCanTargetUser(prisma, actorId, params.id);

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, email: true, role: true, status: true },
  });
  if (!target) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');

  const tempPassword = randomBytes(6).toString('base64url').slice(0, 10);
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    await assertAdminCanTargetUser(tx, actorId, params.id);
    await tx.user.update({ where: { id: target.id }, data: { passwordHash } });
    await tx.refreshToken.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAudit(tx, {
      actorId, action: 'RESET_USER_PASSWORD', targetType: 'User', targetId: target.id,
      meta: { reason: body.reason, email: target.email }, ipAddress: ip,
    });
  });

  return {
    message: 'Password reset. Share temporary password securely.',
    temporaryPassword: tempPassword,
  };
}

export async function adjustWallet(
  actorId: string,
  params: UserIdParams,
  body: AdjustWalletBody,
  ip: string | null
) {
  await assertAdminCanTargetUser(prisma, actorId, params.id);

  const amount = new Prisma.Decimal(body.amount);
  const isCredit = body.direction === 'CREDIT';

  return prisma.$transaction(async (tx) => {
    const target = await assertAdminCanTargetUser(tx, actorId, params.id);

    const wallet = await tx.wallet.findUnique({
      where: { userId: target.id },
      select: { balance: true },
    });
    if (!wallet) throw ApiError.internal('Wallet missing', 'WALLET_MISSING');

    if (!isCredit && wallet.balance.lessThan(amount)) {
      throw ApiError.badRequest(
        `Cannot debit ₦${amount.toFixed(2)} — wallet has ₦${wallet.balance.toFixed(2)}`,
        'INSUFFICIENT_BALANCE'
      );
    }

    const updated = await tx.wallet.updateMany({
      where: {
        userId: target.id,
        ...(!isCredit ? { balance: { gte: amount } } : {}),
      },
      data: {
        balance: isCredit ? { increment: amount } : { decrement: amount },
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw ApiError.badRequest(
        'Insufficient balance (concurrent modification)',
        'INSUFFICIENT_BALANCE'
      );
    }

    const reference = generateReference(isCredit ? 'ADMCR' : 'ADMDB');

    const txn = await tx.transaction.create({
      data: {
        userId: target.id,
        reference,
        type: isCredit ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
        status: 'SUCCESS',
        amount,
        providerCost: new Prisma.Decimal(0),
        sellingPrice: new Prisma.Decimal(0),
        profit: new Prisma.Decimal(0),
        meta: { adminNote: body.note, actorId },
      },
      select: { id: true, reference: true },
    });

    await writeAudit(tx, {
      actorId,
      action: isCredit ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
      targetType: 'User',
      targetId: target.id,
      meta: { amount: amount.toFixed(2), note: body.note, transactionId: txn.id },
      ipAddress: ip,
    });

    const final = await tx.wallet.findUnique({
      where: { userId: target.id },
      select: { balance: true },
    });

    return {
      message: `Wallet ${isCredit ? 'credited' : 'debited'} successfully`,
      newBalance: (final?.balance ?? new Prisma.Decimal(0)).toFixed(2),
      transactionReference: txn.reference,
    };
  });
}

// ═════════════════════════════════════════════════════════════
// 3. TRANSACTIONS
// ═════════════════════════════════════════════════════════════

export async function listTransactions(query: TransactionsListQuery) {
  const { q, userId, reference, status, type, from, to, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.TransactionWhereInput = {
    ...(userId ? { userId } : {}),
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
    ...(reference ? { reference: { contains: reference, mode: 'insensitive' } } : {}),
    ...(q
      ? {
          OR: [
            { reference: { contains: q, mode: 'insensitive' } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
            { user: { phone: { contains: q } } },
            { user: { name: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
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
        amount: true, providerCost: true, sellingPrice: true, profit: true,
        failureReason: true, providerTried: true, providerRef: true,
        createdAt: true, updatedAt: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    items: items.map((t) => ({
      id: t.id, reference: t.reference, type: t.type, status: t.status,
      amount: t.amount.toFixed(2), providerCost: t.providerCost.toFixed(2),
      sellingPrice: t.sellingPrice.toFixed(2), profit: t.profit.toFixed(2),
      failureReason: t.failureReason, providerTried: t.providerTried,
      providerRef: t.providerRef, createdAt: t.createdAt, updatedAt: t.updatedAt,
      user: t.user,
    })),
    pagination: {
      page, limit, total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}

export async function getTransactionDetail(params: TxnIdParams) {
  const t = await prisma.transaction.findUnique({
    where: { id: params.id },
    include: { user: { select: { id: true, name: true, email: true, phone: true } } },
  });
  if (!t) throw ApiError.notFound('Transaction not found', 'TXN_NOT_FOUND');

  return {
    id: t.id, reference: t.reference, type: t.type, status: t.status,
    amount: t.amount.toFixed(2), providerCost: t.providerCost.toFixed(2),
    sellingPrice: t.sellingPrice.toFixed(2), profit: t.profit.toFixed(2),
    idempotencyKey: t.idempotencyKey, providerTried: t.providerTried,
    providerRef: t.providerRef, providerResponse: t.providerResponse,
    failureReason: t.failureReason, meta: t.meta,
    refundedAt: t.refundedAt, refundedBy: t.refundedBy, refundReference: t.refundReference,
    createdAt: t.createdAt, updatedAt: t.updatedAt, user: t.user,
  };
}

export async function markTransaction(
  actorId: string,
  params: TxnIdParams,
  body: MarkTxnBody,
  ip: string | null
) {
  return prisma.$transaction(async (tx) => {
    const t = await tx.transaction.findUnique({
      where: { id: params.id },
      select: {
        id: true, userId: true, status: true, type: true,
        amount: true, sellingPrice: true, providerCost: true, profit: true,
        meta: true, reference: true,
      },
    });
    if (!t) throw ApiError.notFound('Transaction not found', 'TXN_NOT_FOUND');
    if (t.status !== 'PENDING') {
      throw ApiError.badRequest(
        `Cannot mark transaction from status ${t.status} — only PENDING can be marked`,
        'INVALID_STATUS'
      );
    }

    if (body.status === 'SUCCESS') {
      await tx.transaction.update({
        where: { id: t.id },
        data: { status: 'SUCCESS', failureReason: null },
      });
      await writeAudit(tx, {
        actorId, action: 'MARK_TXN_SUCCESS', targetType: 'Transaction', targetId: t.id,
        meta: { note: body.note, originalReference: t.reference }, ipAddress: ip,
      });
      return { message: 'Transaction marked SUCCESS', id: t.id };
    }

    const refundRef = generateReference('ADMRF');
    const oldMeta = (t.meta as Record<string, unknown> | null) ?? {};

    await tx.wallet.update({
      where: { userId: t.userId },
      data: { balance: { increment: t.amount }, version: { increment: 1 } },
    });

    await tx.transaction.create({
      data: {
        userId: t.userId,
        reference: refundRef,
        type: 'REFUND',
        status: 'SUCCESS',
        amount: t.amount,
        providerCost: new Prisma.Decimal(0),
        sellingPrice: new Prisma.Decimal(0),
        profit: new Prisma.Decimal(0),
        meta: {
          originalReference: t.reference,
          originalTransactionId: t.id,
          adminNote: body.note,
          actorId,
        },
      },
    });

    await tx.transaction.update({
      where: { id: t.id },
      data: {
        status: 'FAILED',
        profit: new Prisma.Decimal(0),
        failureReason: body.note,
        refundedAt: new Date(),
        refundedBy: actorId,
        refundReference: refundRef,
        meta: { ...oldMeta, adminMarkedFailedBy: actorId, adminNote: body.note },
      },
    });

    await writeAudit(tx, {
      actorId, action: 'MARK_TXN_FAILED', targetType: 'Transaction', targetId: t.id,
      meta: {
        note: body.note,
        originalReference: t.reference,
        refundReference: refundRef,
        amount: t.amount.toFixed(2),
      },
      ipAddress: ip,
    });

    return {
      message: 'Transaction marked FAILED and refunded',
      id: t.id,
      refundReference: refundRef,
    };
  });
}

export async function refundTransaction(
  actorId: string,
  params: TxnIdParams,
  body: RefundTxnBody,
  ip: string | null
) {
  return prisma.$transaction(async (tx) => {
    const t = await tx.transaction.findUnique({
      where: { id: params.id },
      select: {
        id: true, userId: true, status: true, amount: true,
        refundedAt: true, meta: true, reference: true,
      },
    });
    if (!t) throw ApiError.notFound('Transaction not found', 'TXN_NOT_FOUND');
    if (t.status !== 'FAILED') {
      throw ApiError.badRequest(
        `Cannot refund transaction with status ${t.status} — only FAILED`,
        'INVALID_STATUS'
      );
    }
    if (t.refundedAt) {
      throw ApiError.conflict('Transaction already refunded', 'ALREADY_REFUNDED');
    }

    const refundRef = generateReference('ADMRF');
    const oldMeta = (t.meta as Record<string, unknown> | null) ?? {};

    await tx.wallet.update({
      where: { userId: t.userId },
      data: { balance: { increment: t.amount }, version: { increment: 1 } },
    });

    await tx.transaction.create({
      data: {
        userId: t.userId,
        reference: refundRef,
        type: 'REFUND',
        status: 'SUCCESS',
        amount: t.amount,
        providerCost: new Prisma.Decimal(0),
        sellingPrice: new Prisma.Decimal(0),
        profit: new Prisma.Decimal(0),
        meta: {
          originalReference: t.reference,
          originalTransactionId: t.id,
          adminNote: body.note,
          actorId,
        },
      },
    });

    await tx.transaction.update({
      where: { id: t.id },
      data: {
        status: 'REFUNDED',
        refundedAt: new Date(),
        refundedBy: actorId,
        refundReference: refundRef,
        profit: new Prisma.Decimal(0),
        meta: { ...oldMeta, adminRefundBy: actorId, adminNote: body.note },
      },
    });

    await writeAudit(tx, {
      actorId, action: 'REFUND_TRANSACTION', targetType: 'Transaction', targetId: t.id,
      meta: {
        note: body.note,
        refundReference: refundRef,
        originalReference: t.reference,
        amount: t.amount.toFixed(2),
      },
      ipAddress: ip,
    });

    return { message: 'Transaction refunded', refundReference: refundRef };
  });
}

// ═════════════════════════════════════════════════════════════
// 4. PRICING & NETWORK CONTROL
// ═════════════════════════════════════════════════════════════

export async function createDataPlan(
  actorId: string,
  body: CreateDataPlanBody,
  ip: string | null
) {
  const sellingPrice = new Prisma.Decimal(body.sellingPrice);
  const providerCost = new Prisma.Decimal(body.providerCost);

  try {
    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.dataPlan.create({
        data: {
          network: body.network,
          name: body.name,
          sizeMb: body.sizeMb,
          validityDays: body.validityDays,
          sellingPrice,
          providerCost,
          providerPlanA: body.providerPlanA ?? null,
          providerPlanB: body.providerPlanB ?? null,
          providerPlanC: body.providerPlanC ?? null,
          enabled: body.enabled,
        },
      });
      await writeAudit(tx, {
        actorId, action: 'CREATE_DATA_PLAN', targetType: 'DataPlan', targetId: created.id,
        meta: { network: body.network, name: body.name, sellingPrice: sellingPrice.toFixed(2) },
        ipAddress: ip,
      });
      return created;
    });

    return {
      id: plan.id, network: plan.network, name: plan.name,
      sizeMb: plan.sizeMb, validityDays: plan.validityDays,
      sellingPrice: plan.sellingPrice.toFixed(2),
      providerCost: plan.providerCost.toFixed(2),
      profit: calculateProfit(plan.sellingPrice, plan.providerCost).toFixed(2),
      providerPlanA: plan.providerPlanA,
      providerPlanB: plan.providerPlanB,
      providerPlanC: plan.providerPlanC,
      enabled: plan.enabled,
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.conflict('A plan with this network and name already exists', 'DUPLICATE_PLAN');
    }
    throw err;
  }
}

export async function updateDataPlan(
  actorId: string,
  params: DataPlanIdParams,
  body: UpdateDataPlanBody,
  ip: string | null
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.dataPlan.findUnique({
      where: { id: params.id },
      select: { id: true, network: true, name: true },
    });
    if (!existing) throw ApiError.notFound('Data plan not found', 'PLAN_NOT_FOUND');

    const data: Prisma.DataPlanUpdateInput = {};
    if (body.sellingPrice !== undefined) data.sellingPrice = new Prisma.Decimal(body.sellingPrice);
    if (body.providerCost !== undefined) data.providerCost = new Prisma.Decimal(body.providerCost);
    if (body.providerPlanA !== undefined) data.providerPlanA = body.providerPlanA;
    if (body.providerPlanB !== undefined) data.providerPlanB = body.providerPlanB;
    if (body.providerPlanC !== undefined) data.providerPlanC = body.providerPlanC;
    if (body.enabled !== undefined) data.enabled = body.enabled;

    const updated = await tx.dataPlan.update({ where: { id: params.id }, data });

    await writeAudit(tx, {
      actorId, action: 'UPDATE_DATA_PLAN', targetType: 'DataPlan', targetId: params.id,
      meta: {
        changes: body as unknown as Prisma.InputJsonValue,
        planName: existing.name, network: existing.network,
      },
      ipAddress: ip,
    });

    return {
      id: updated.id, network: updated.network, name: updated.name,
      sellingPrice: updated.sellingPrice.toFixed(2),
      providerCost: updated.providerCost.toFixed(2),
      profit: calculateProfit(updated.sellingPrice, updated.providerCost).toFixed(2),
      providerPlanA: updated.providerPlanA,
      providerPlanB: updated.providerPlanB,
      providerPlanC: updated.providerPlanC,
      enabled: updated.enabled,
    };
  });
}

export async function listDataPlans() {
  const plans = await prisma.dataPlan.findMany({
    orderBy: [{ network: 'asc' }, { sellingPrice: 'asc' }],
  });
  return plans.map((p) => ({
    id: p.id, network: p.network, name: p.name,
    sizeMb: p.sizeMb, validityDays: p.validityDays,
    sellingPrice: p.sellingPrice.toFixed(2),
    providerCost: p.providerCost.toFixed(2),
    profit: calculateProfit(p.sellingPrice, p.providerCost).toFixed(2),
    providerPlanA: p.providerPlanA,
    providerPlanB: p.providerPlanB,
    providerPlanC: p.providerPlanC,
    enabled: p.enabled,
  }));
}

export async function listBouquets() {
  const bouquets = await prisma.cableBouquet.findMany({
    orderBy: [{ provider: 'asc' }, { sellingPrice: 'asc' }],
  });
  return bouquets.map((b) => ({
    id: b.id, provider: b.provider, name: b.name,
    sellingPrice: b.sellingPrice.toFixed(2),
    providerCost: b.providerCost.toFixed(2),
    profit: calculateProfit(b.sellingPrice, b.providerCost).toFixed(2),
    providerPlanA: b.providerPlanA,
    providerPlanB: b.providerPlanB,
    providerPlanC: b.providerPlanC,
    enabled: b.enabled,
  }));
}

export async function updateBouquet(
  actorId: string,
  params: BouquetIdParams,
  body: UpdateBouquetBody,
  ip: string | null
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.cableBouquet.findUnique({
      where: { id: params.id },
      select: { id: true, provider: true, name: true },
    });
    if (!existing) throw ApiError.notFound('Bouquet not found', 'BOUQUET_NOT_FOUND');

    const data: Prisma.CableBouquetUpdateInput = {};
    if (body.sellingPrice !== undefined) data.sellingPrice = new Prisma.Decimal(body.sellingPrice);
    if (body.providerCost !== undefined) data.providerCost = new Prisma.Decimal(body.providerCost);
    if (body.providerPlanA !== undefined) data.providerPlanA = body.providerPlanA;
    if (body.providerPlanB !== undefined) data.providerPlanB = body.providerPlanB;
    if (body.providerPlanC !== undefined) data.providerPlanC = body.providerPlanC;
    if (body.enabled !== undefined) data.enabled = body.enabled;

    const updated = await tx.cableBouquet.update({ where: { id: params.id }, data });

    await writeAudit(tx, {
      actorId, action: 'UPDATE_BOUQUET', targetType: 'CableBouquet', targetId: params.id,
      meta: {
        changes: body as unknown as Prisma.InputJsonValue,
        bouquetName: existing.name, provider: existing.provider,
      },
      ipAddress: ip,
    });

    return {
      id: updated.id, provider: updated.provider, name: updated.name,
      sellingPrice: updated.sellingPrice.toFixed(2),
      providerCost: updated.providerCost.toFixed(2),
      profit: calculateProfit(updated.sellingPrice, updated.providerCost).toFixed(2),
      providerPlanA: updated.providerPlanA,
      providerPlanB: updated.providerPlanB,
      providerPlanC: updated.providerPlanC,
      enabled: updated.enabled,
    };
  });
}

export async function listServiceConfigs() {
  const configs = await prisma.serviceConfig.findMany({ orderBy: { key: 'asc' } });
  return configs.map((c) => ({
    id: c.id, key: c.key, enabled: c.enabled,
    marginPct: c.marginPct.toFixed(2),
    minAmount: c.minAmount ? c.minAmount.toFixed(2) : null,
    maxAmount: c.maxAmount ? c.maxAmount.toFixed(2) : null,
    announcement: c.announcement, updatedAt: c.updatedAt,
  }));
}

export async function updateServiceConfig(
  actorId: string,
  params: ServiceConfigKeyParams,
  body: UpdateServiceConfigBody,
  ip: string | null
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.serviceConfig.findUnique({ where: { key: params.key } });
    if (!existing) throw ApiError.notFound('Service config not found', 'CONFIG_NOT_FOUND');

    const data: Prisma.ServiceConfigUpdateInput = {};
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.marginPct !== undefined) data.marginPct = new Prisma.Decimal(body.marginPct);
    if (body.minAmount !== undefined) {
      data.minAmount = body.minAmount === null ? null : new Prisma.Decimal(body.minAmount);
    }
    if (body.maxAmount !== undefined) {
      data.maxAmount = body.maxAmount === null ? null : new Prisma.Decimal(body.maxAmount);
    }
    if (body.announcement !== undefined) data.announcement = body.announcement;

    const updated = await tx.serviceConfig.update({ where: { key: params.key }, data });

    await writeAudit(tx, {
      actorId, action: 'UPDATE_SERVICE_CONFIG', targetType: 'ServiceConfig', targetId: updated.id,
      meta: { key: params.key, changes: body as unknown as Prisma.InputJsonValue },
      ipAddress: ip,
    });

    return {
      id: updated.id, key: updated.key, enabled: updated.enabled,
      marginPct: updated.marginPct.toFixed(2),
      minAmount: updated.minAmount ? updated.minAmount.toFixed(2) : null,
      maxAmount: updated.maxAmount ? updated.maxAmount.toFixed(2) : null,
      announcement: updated.announcement,
    };
  });
}

export async function postAnnouncement(
  actorId: string,
  body: AnnouncementBody,
  ip: string | null
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.serviceConfig.findUnique({
      where: { key: 'GLOBAL_ANNOUNCEMENT' },
    });

    const data = { enabled: body.active, announcement: body.message };

    const result = existing
      ? await tx.serviceConfig.update({ where: { key: 'GLOBAL_ANNOUNCEMENT' }, data })
      : await tx.serviceConfig.create({
          data: {
            key: 'GLOBAL_ANNOUNCEMENT',
            enabled: body.active,
            marginPct: new Prisma.Decimal(0),
            announcement: body.message,
          },
        });

    await writeAudit(tx, {
      actorId, action: 'POST_ANNOUNCEMENT', targetType: 'ServiceConfig', targetId: result.id,
      meta: { message: body.message, active: body.active }, ipAddress: ip,
    });

    return {
      message: 'Announcement posted',
      active: result.enabled,
      announcement: result.announcement,
    };
  });
}

// ═════════════════════════════════════════════════════════════
// 5. AUDIT LOG
// ═════════════════════════════════════════════════════════════

export async function listAuditLogs(query: AuditListQuery) {
  const { actorId, action, targetType, targetId, from, to, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.AuditLogWhereInput = {
    ...(actorId ? { actorId } : {}),
    ...(action ? { action } : {}),
    ...(targetType ? { targetType } : {}),
    ...(targetId ? { targetId } : {}),
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
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { actor: { select: { id: true, name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    items: items.map((a) => ({
      id: a.id, actor: a.actor, action: a.action,
      targetType: a.targetType, targetId: a.targetId,
      meta: a.meta, ipAddress: a.ipAddress, createdAt: a.createdAt,
    })),
    pagination: {
      page, limit, total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}