import { z } from 'zod';

// ─── Shared ─────────────────────────────────────────────
const cuid = z.string().min(1, 'id is required');

const paginationFields = {
  page: z
    .string()
    .regex(/^\d+$/, 'page must be a positive integer')
    .transform((v) => parseInt(v, 10))
    .refine((v) => v >= 1, 'page must be >= 1')
    .default('1'),
  limit: z
    .string()
    .regex(/^\d+$/, 'limit must be a positive integer')
    .transform((v) => parseInt(v, 10))
    .refine((v) => v >= 1 && v <= 100, 'limit must be 1-100')
    .default('20'),
};

// ═════════════════════════════════════════════════════════
// 1. DASHBOARD
// ═════════════════════════════════════════════════════════
export const dashboardRangeSchema = z.object({
  range: z.enum(['today', '7d', '30d', 'all']).default('today'),
});
export type DashboardRange = z.infer<typeof dashboardRangeSchema>;

// ═════════════════════════════════════════════════════════
// 2. USERS
// ═════════════════════════════════════════════════════════
export const usersListQuerySchema = z.object({
  q: z.string().trim().min(1).max(80).optional(), // name/email/phone search
  status: z.enum(['ACTIVE', 'BLOCKED']).optional(),
  ...paginationFields,
});
export type UsersListQuery = z.infer<typeof usersListQuerySchema>;

export const userIdParamsSchema = z.object({
  id: cuid,
});
export type UserIdParams = z.infer<typeof userIdParamsSchema>;

// Block / unblock
export const blockUserBodySchema = z.object({
  reason: z.string().trim().min(3).max(200).optional(),
});
export type BlockUserBody = z.infer<typeof blockUserBodySchema>;

// Admin reset a user's password (generates temp password, returns it once)
export const resetUserPasswordBodySchema = z.object({
  reason: z.string().trim().min(3).max(200).optional(),
});
export type ResetUserPasswordBody = z.infer<typeof resetUserPasswordBodySchema>;

// Admin fund / deduct wallet
export const adjustWalletBodySchema = z
  .object({
    direction: z.enum(['CREDIT', 'DEBIT']),
    amount: z
      .number({ invalid_type_error: 'amount must be a number' })
      .positive('amount must be > 0')
      .max(1_000_000, 'amount too large')
      .refine((v) => Number.isFinite(v), 'amount must be finite'),
    note: z.string().trim().min(3, 'note is required').max(200),
  })
  .strict();
export type AdjustWalletBody = z.infer<typeof adjustWalletBodySchema>;

// ═════════════════════════════════════════════════════════
// 3. TRANSACTIONS
// ═════════════════════════════════════════════════════════
export const transactionsListQuerySchema = z.object({
  q: z.string().trim().min(1).max(80).optional(),          // ref or user email
  userId: z.string().min(1).optional(),
  reference: z.string().min(1).max(80).optional(),
  status: z.enum(['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED']).optional(),
  type: z.enum(['FUNDING', 'DATA', 'AIRTIME', 'CABLE', 'REFUND', 'ADMIN_CREDIT', 'ADMIN_DEBIT']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  ...paginationFields,
});
export type TransactionsListQuery = z.infer<typeof transactionsListQuerySchema>;

export const txnIdParamsSchema = z.object({
  id: cuid,
});
export type TxnIdParams = z.infer<typeof txnIdParamsSchema>;

export const markTxnBodySchema = z
  .object({
    status: z.enum(['SUCCESS', 'FAILED']),
    note: z.string().trim().min(3).max(200),
  })
  .strict();
export type MarkTxnBody = z.infer<typeof markTxnBodySchema>;

export const refundTxnBodySchema = z
  .object({
    note: z.string().trim().min(3).max(200),
  })
  .strict();
export type RefundTxnBody = z.infer<typeof refundTxnBodySchema>;

// ═════════════════════════════════════════════════════════
// 4. PRICING & NETWORK CONTROL
// ═════════════════════════════════════════════════════════

// Update a data plan (selling price, provider cost, codes, enabled)
export const updateDataPlanBodySchema = z
  .object({
    sellingPrice: z.number().positive().max(1_000_000).optional(),
    providerCost: z.number().nonnegative().max(1_000_000).optional(),
    providerPlanA: z.string().min(1).max(60).nullable().optional(),
    providerPlanB: z.string().min(1).max(60).nullable().optional(),
    providerPlanC: z.string().min(1).max(60).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'at least one field required');
export type UpdateDataPlanBody = z.infer<typeof updateDataPlanBodySchema>;

export const dataPlanIdParamsSchema = z.object({
  id: cuid,
});
export type DataPlanIdParams = z.infer<typeof dataPlanIdParamsSchema>;

// Create a new data plan
export const createDataPlanBodySchema = z
  .object({
    network: z.enum(['MTN', 'AIRTEL', 'GLO', 'NINE_MOBILE']),
    name: z.string().trim().min(2).max(80),
    sizeMb: z.number().int().positive().max(1_000_000),
    validityDays: z.number().int().positive().max(365),
    sellingPrice: z.number().positive().max(1_000_000),
    providerCost: z.number().nonnegative().max(1_000_000),
    providerPlanA: z.string().min(1).max(60).nullable().optional(),
    providerPlanB: z.string().min(1).max(60).nullable().optional(),
    providerPlanC: z.string().min(1).max(60).nullable().optional(),
    enabled: z.boolean().optional().default(true),
  })
  .strict();
export type CreateDataPlanBody = z.infer<typeof createDataPlanBodySchema>;

// Update a cable bouquet
export const updateBouquetBodySchema = z
  .object({
    sellingPrice: z.number().positive().max(1_000_000).optional(),
    providerCost: z.number().nonnegative().max(1_000_000).optional(),
    providerPlanA: z.string().min(1).max(60).nullable().optional(),
    providerPlanB: z.string().min(1).max(60).nullable().optional(),
    providerPlanC: z.string().min(1).max(60).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'at least one field required');
export type UpdateBouquetBody = z.infer<typeof updateBouquetBodySchema>;

export const bouquetIdParamsSchema = z.object({
  id: cuid,
});
export type BouquetIdParams = z.infer<typeof bouquetIdParamsSchema>;

// Service config (airtime margins + enable/disable + announcement)
export const updateServiceConfigBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    marginPct: z.number().min(0).max(100).optional(),
    minAmount: z.number().nonnegative().max(1_000_000).nullable().optional(),
    maxAmount: z.number().positive().max(1_000_000).nullable().optional(),
    announcement: z.string().trim().max(300).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'at least one field required')
  .refine(
    (v) => !(v.minAmount != null && v.maxAmount != null) || v.minAmount <= v.maxAmount,
    'minAmount must be <= maxAmount'
  );
export type UpdateServiceConfigBody = z.infer<typeof updateServiceConfigBodySchema>;

export const serviceConfigKeyParamsSchema = z.object({
  key: z.string().regex(/^[A-Z_]{3,40}$/, 'invalid config key'),
});
export type ServiceConfigKeyParams = z.infer<typeof serviceConfigKeyParamsSchema>;

// Announcement (global post shown to users — matches spec Part 6.4)
export const announcementBodySchema = z
  .object({
    message: z.string().trim().min(3).max(500),
    active: z.boolean().default(true),
  })
  .strict();
export type AnnouncementBody = z.infer<typeof announcementBodySchema>;

// ═════════════════════════════════════════════════════════
// 5. AUDIT LOG (read-only view)
// ═════════════════════════════════════════════════════════
export const auditListQuerySchema = z.object({
  actorId: z.string().min(1).optional(),
  action: z.string().min(1).max(60).optional(),
  targetType: z.string().min(1).max(40).optional(),
  targetId: z.string().min(1).max(60).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  ...paginationFields,
});
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;