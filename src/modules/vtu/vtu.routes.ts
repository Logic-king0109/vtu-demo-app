import { Router } from 'express';
import * as controller from './vtu.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { validateBody, validate } from '../../middlewares/validate.middleware';
import { idempotencyMiddleware } from '../../middlewares/idempotency.middleware';
import { rateLimitPurchase } from '../../middlewares/rateLimit.middleware';
import {
  buyDataSchema, buyAirtimeSchema, buyCableSchema,
  verifyCableSchema, transactionsQuerySchema,
} from './vtu.validation';

const router = Router();

// All VTU routes require authentication
router.use(authMiddleware);

// ── Purchases (rate-limited per user, validated, idempotent) ──
// Order matters:
//   1) rateLimitPurchase      → cheapest rejection
//   2) validateBody           → 400 on bad shape, does NOT burn the key
//   3) idempotencyMiddleware  → 409 on duplicate, only claimed on valid input
//   4) controller             → executes the purchase
router.post(
  '/data',
  rateLimitPurchase,
  validateBody(buyDataSchema),
  idempotencyMiddleware,
  controller.buyData
);

router.post(
  '/airtime',
  rateLimitPurchase,
  validateBody(buyAirtimeSchema),
  idempotencyMiddleware,
  controller.buyAirtime
);

router.post(
  '/cable',
  rateLimitPurchase,
  validateBody(buyCableSchema),
  idempotencyMiddleware,
  controller.buyCable
);

// ── Cable verification (no money moves, no idempotency needed) ──
router.post(
  '/cable/verify',
  rateLimitPurchase,
  validateBody(verifyCableSchema),
  controller.verifyCable
);

// ── History + receipts ─────────────────────────────────
router.get(
  '/transactions',
  validate({ query: transactionsQuerySchema }),
  controller.getTransactions
);

router.get('/transactions/:reference', controller.getReceipt);

export default router;