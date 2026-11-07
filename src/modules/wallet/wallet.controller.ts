import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import * as walletService from './wallet.service';
import { historyQuerySchema } from './wallet.validation';

export const getWallet = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const result = await walletService.getWallet(req.user.id);
  sendSuccess(res, { data: result });
});

export const getHistory = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();

  // Parse & coerce again — do NOT trust raw req.query strings.
  // - `page` and `limit` become numbers
  // - `status`, `from`, `to` are validated (enum / ISO datetime)
  // - invalid input throws ZodError → errorMiddleware → HTTP 400
  // This makes the controller safe even if validate() middleware
  // is ever removed from the route by mistake.
  const query = historyQuerySchema.parse(req.query);

  const result = await walletService.getWalletHistory(req.user.id, query);

  sendSuccess(res, {
    data: result.items,
    meta: result.pagination,
  });
});