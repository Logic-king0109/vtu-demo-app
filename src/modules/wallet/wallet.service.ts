import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { ApiError } from '../../utils/ApiError';
import type { HistoryQuery } from './wallet.validation';

// Wallet history = EVERY transaction type that changes the balance.
// - FUNDING       → increases balance
// - DATA          → decreases balance (purchase)
// - AIRTIME       → decreases balance (purchase)
// - CABLE         → decreases balance (purchase)
// - REFUND        → increases balance (auto or admin refund)
// - ADMIN_CREDIT  → increases balance
// - ADMIN_DEBIT   → decreases balance
const WALLET_TX_TYPES: Prisma.TransactionWhereInput['type'] = {
  in: ['FUNDING', 'DATA', 'AIRTIME', 'CABLE', 'REFUND', 'ADMIN_CREDIT', 'ADMIN_DEBIT'],
};

export async function getWallet(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      vaNumber: true,
      vaBankName: true,
      vaAccountName: true,
      vaCreatedAt: true,
      wallet: {
        select: {
          balance: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
  if (!user.wallet) throw ApiError.internal('Wallet missing for user', 'WALLET_MISSING');

  return {
    balance: user.wallet.balance.toFixed(2),
    walletUpdatedAt: user.wallet.updatedAt,
    virtualAccount: user.vaNumber
      ? {
          accountNumber: user.vaNumber,
          bankName: user.vaBankName,
          accountName: user.vaAccountName,
          createdAt: user.vaCreatedAt,
        }
      : null,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
    },
  };
}

export async function getWalletHistory(userId: string, query: HistoryQuery) {
  const { page, limit, status, from, to } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.TransactionWhereInput = {
    userId,
    type: WALLET_TX_TYPES,
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
        id: true,
        reference: true,
        type: true,
        status: true,
        amount: true,
        failureReason: true,
        createdAt: true,
        meta: true,
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  const data = items.map((t) => ({
    id: t.id,
    reference: t.reference,
    type: t.type,
    status: t.status,
    amount: t.amount.toFixed(2),
    failureReason: t.failureReason,
    createdAt: t.createdAt,
    meta: t.meta,
  }));

  return {
    items: data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}