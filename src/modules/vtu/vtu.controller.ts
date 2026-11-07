import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import * as vtuService from './vtu.service';
import { transactionsQuerySchema } from './vtu.validation';

// ═════════════════════════════════════════════════════════
// Buy Data
// ═════════════════════════════════════════════════════════
export const buyData = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();

  // idempotencyMiddleware guarantees this header exists.
  const idempotencyKey = req.header('Idempotency-Key')!;

  const result = await vtuService.buyData(req.user.id, req.body, idempotencyKey);

  // SUCCESS → 200, FAILED → 200 (with status field). Failure is business
  // outcome, not HTTP error — the user paid once, we refunded, life goes on.
  sendSuccess(res, {
    statusCode: 200,
    message: result.message,
    data: result,
  });
});

// ═════════════════════════════════════════════════════════
// Buy Airtime
// ═════════════════════════════════════════════════════════
export const buyAirtime = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const idempotencyKey = req.header('Idempotency-Key')!;
  const result = await vtuService.buyAirtime(req.user.id, req.body, idempotencyKey);
  sendSuccess(res, { message: result.message, data: result });
});

// ═════════════════════════════════════════════════════════
// Verify Cable Customer (no money moves)
// ═════════════════════════════════════════════════════════
export const verifyCable = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const result = await vtuService.verifyCableCustomer(req.body);
  sendSuccess(res, { message: 'Customer verified', data: result });
});

// ═════════════════════════════════════════════════════════
// Buy Cable
// ═════════════════════════════════════════════════════════
export const buyCable = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const idempotencyKey = req.header('Idempotency-Key')!;
  const result = await vtuService.buyCable(req.user.id, req.body, idempotencyKey);
  sendSuccess(res, { message: result.message, data: result });
});

// ═════════════════════════════════════════════════════════
// Transaction History (unified)
// ═════════════════════════════════════════════════════════
export const getTransactions = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();

  // Defense-in-depth: parse again even though middleware validated.
  const query = transactionsQuerySchema.parse(req.query);

  const result = await vtuService.getUserTransactions(req.user.id, query);
  sendSuccess(res, { data: result.items, meta: result.pagination });
});

// ═════════════════════════════════════════════════════════
// Receipt
// ═════════════════════════════════════════════════════════
export const getReceipt = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const { reference } = req.params as { reference: string };
  const result = await vtuService.getTransactionReceipt(req.user.id, reference);
  sendSuccess(res, { data: result });
});