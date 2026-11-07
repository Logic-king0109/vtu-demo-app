import { z } from 'zod';

export const historyQuerySchema = z.object({
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
    .refine((v) => v >= 1 && v <= 50, 'limit must be 1-50')
    .default('20'),
  status: z.enum(['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED']).optional(),
  from: z
    .string()
    .datetime({ offset: true, message: 'from must be ISO date' })
    .optional(),
  to: z
    .string()
    .datetime({ offset: true, message: 'to must be ISO date' })
    .optional(),
});

export type HistoryQuery = z.infer<typeof historyQuerySchema>;