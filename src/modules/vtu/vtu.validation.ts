import { z } from 'zod';

const phoneNg = z
  .string()
  .regex(/^0[789][01]\d{8}$/, 'Enter a valid Nigerian phone number');

const pin4 = z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits');

const networkEnum = z.enum(['MTN', 'AIRTEL', 'GLO', 'NINE_MOBILE']);
const cableEnum = z.enum(['DSTV', 'GOTV', 'STARTIMES']);

// ─── Buy Data ────────────────────────────────────────────
export const buyDataSchema = z.object({
  planId: z.string().min(1, 'planId is required'),
  phone: phoneNg,
  pin: pin4,
});

// ─── Buy Airtime ─────────────────────────────────────────
export const buyAirtimeSchema = z.object({
  network: networkEnum,
  amount: z
    .number({ invalid_type_error: 'amount must be a number' })
    .min(50, 'Minimum airtime amount is ₦50')
    .max(50_000, 'Maximum airtime amount is ₦50,000')
    .refine((v) => Number.isFinite(v), 'amount must be finite'),
  phone: phoneNg,
  pin: pin4,
});

// ─── Buy Cable ───────────────────────────────────────────
export const buyCableSchema = z.object({
  provider: cableEnum,
  bouquetId: z.string().min(1, 'bouquetId is required'),
  smartcardNumber: z
    .string()
    .regex(/^\d{10,12}$/, 'Smartcard number must be 10–12 digits'),
  pin: pin4,
});

// ─── Verify Cable Customer ───────────────────────────────
export const verifyCableSchema = z.object({
  provider: cableEnum,
  smartcardNumber: z
    .string()
    .regex(/^\d{10,12}$/, 'Smartcard number must be 10–12 digits'),
});

// ─── Transactions list query ─────────────────────────────
export const transactionsQuerySchema = z.object({
  page: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => parseInt(v, 10))
    .refine((v) => v >= 1)
    .default('1'),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => parseInt(v, 10))
    .refine((v) => v >= 1 && v <= 50)
    .default('20'),
  type: z.enum(['DATA', 'AIRTIME', 'CABLE']).optional(),
  status: z.enum(['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export type BuyDataInput = z.infer<typeof buyDataSchema>;
export type BuyAirtimeInput = z.infer<typeof buyAirtimeSchema>;
export type BuyCableInput = z.infer<typeof buyCableSchema>;
export type VerifyCableInput = z.infer<typeof verifyCableSchema>;
export type TransactionsQuery = z.infer<typeof transactionsQuerySchema>;