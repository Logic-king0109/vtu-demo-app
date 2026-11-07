import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import * as adminService from './admin.service';
import {
  dashboardRangeSchema, usersListQuerySchema, userIdParamsSchema,
  blockUserBodySchema, resetUserPasswordBodySchema, adjustWalletBodySchema,
  transactionsListQuerySchema, txnIdParamsSchema, markTxnBodySchema, refundTxnBodySchema,
  dataPlanIdParamsSchema, updateDataPlanBodySchema, createDataPlanBodySchema,
  bouquetIdParamsSchema, updateBouquetBodySchema,
  serviceConfigKeyParamsSchema, updateServiceConfigBodySchema,
  announcementBodySchema, auditListQuerySchema,
} from './admin.validation';

// Every admin route passes through authMiddleware + adminMiddleware
// before reaching these controllers. So `req.user` is guaranteed
// ADMIN and `req.user!.id` is the acting admin.

function actorId(req: Request): string {
  if (!req.user) throw ApiError.unauthorized();
  return req.user.id;
}

// Normalize req.ip (string | undefined) → (string | null)
function clientIp(req: Request): string | null {
  return req.ip ?? null;
}

// ═════════════════════════════════════════════════════════
// 1. DASHBOARD
// ═════════════════════════════════════════════════════════
export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const parsed = dashboardRangeSchema.parse(req.query);
  const result = await adminService.getDashboard(parsed.range);
  sendSuccess(res, { data: result });
});

// ═════════════════════════════════════════════════════════
// 2. USERS
// ═════════════════════════════════════════════════════════
export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const query = usersListQuerySchema.parse(req.query);
  const result = await adminService.listUsers(query);
  sendSuccess(res, { data: result.items, meta: result.pagination });
});

export const getUserDetail = asyncHandler(async (req: Request, res: Response) => {
  const params = userIdParamsSchema.parse(req.params);
  const result = await adminService.getUserDetail(params);
  sendSuccess(res, { data: result });
});

export const blockUser = asyncHandler(async (req: Request, res: Response) => {
  const params = userIdParamsSchema.parse(req.params);
  const body = blockUserBodySchema.parse(req.body);
  const result = await adminService.blockUser(actorId(req), params, body, clientIp(req));
  sendSuccess(res, { message: result.message, data: { status: result.status } });
});

export const unblockUser = asyncHandler(async (req: Request, res: Response) => {
  const params = userIdParamsSchema.parse(req.params);
  const result = await adminService.unblockUser(actorId(req), params, clientIp(req));
  sendSuccess(res, { message: result.message, data: { status: result.status } });
});

export const resetUserPassword = asyncHandler(async (req: Request, res: Response) => {
  const params = userIdParamsSchema.parse(req.params);
  const body = resetUserPasswordBodySchema.parse(req.body);
  const result = await adminService.resetUserPassword(actorId(req), params, body, clientIp(req));
  sendSuccess(res, { message: result.message, data: { temporaryPassword: result.temporaryPassword } });
});

export const adjustWallet = asyncHandler(async (req: Request, res: Response) => {
  const params = userIdParamsSchema.parse(req.params);
  const body = adjustWalletBodySchema.parse(req.body);
  const result = await adminService.adjustWallet(actorId(req), params, body, clientIp(req));
  sendSuccess(res, { message: result.message, data: result });
});

// ═════════════════════════════════════════════════════════
// 3. TRANSACTIONS
// ═════════════════════════════════════════════════════════
export const listTransactions = asyncHandler(async (req: Request, res: Response) => {
  const query = transactionsListQuerySchema.parse(req.query);
  const result = await adminService.listTransactions(query);
  sendSuccess(res, { data: result.items, meta: result.pagination });
});

export const getTransactionDetail = asyncHandler(async (req: Request, res: Response) => {
  const params = txnIdParamsSchema.parse(req.params);
  const result = await adminService.getTransactionDetail(params);
  sendSuccess(res, { data: result });
});

export const markTransaction = asyncHandler(async (req: Request, res: Response) => {
  const params = txnIdParamsSchema.parse(req.params);
  const body = markTxnBodySchema.parse(req.body);
  const result = await adminService.markTransaction(actorId(req), params, body, clientIp(req));
  sendSuccess(res, { message: result.message, data: result });
});

export const refundTransaction = asyncHandler(async (req: Request, res: Response) => {
  const params = txnIdParamsSchema.parse(req.params);
  const body = refundTxnBodySchema.parse(req.body);
  const result = await adminService.refundTransaction(actorId(req), params, body, clientIp(req));
  sendSuccess(res, { message: result.message, data: result });
});

// ═════════════════════════════════════════════════════════
// 4. PRICING & NETWORK CONTROL
// ═════════════════════════════════════════════════════════
export const listDataPlans = asyncHandler(async (_req: Request, res: Response) => {
  const result = await adminService.listDataPlans();
  sendSuccess(res, { data: result });
});

export const createDataPlan = asyncHandler(async (req: Request, res: Response) => {
  const body = createDataPlanBodySchema.parse(req.body);
  const result = await adminService.createDataPlan(actorId(req), body, clientIp(req));
  sendSuccess(res, { statusCode: 201, message: 'Data plan created', data: result });
});

export const updateDataPlan = asyncHandler(async (req: Request, res: Response) => {
  const params = dataPlanIdParamsSchema.parse(req.params);
  const body = updateDataPlanBodySchema.parse(req.body);
  const result = await adminService.updateDataPlan(actorId(req), params, body, clientIp(req));
  sendSuccess(res, { message: 'Data plan updated', data: result });
});

export const listBouquets = asyncHandler(async (_req: Request, res: Response) => {
  const result = await adminService.listBouquets();
  sendSuccess(res, { data: result });
});

export const updateBouquet = asyncHandler(async (req: Request, res: Response) => {
  const params = bouquetIdParamsSchema.parse(req.params);
  const body = updateBouquetBodySchema.parse(req.body);
  const result = await adminService.updateBouquet(actorId(req), params, body, clientIp(req));
  sendSuccess(res, { message: 'Bouquet updated', data: result });
});

export const listServiceConfigs = asyncHandler(async (_req: Request, res: Response) => {
  const result = await adminService.listServiceConfigs();
  sendSuccess(res, { data: result });
});

export const updateServiceConfig = asyncHandler(async (req: Request, res: Response) => {
  const params = serviceConfigKeyParamsSchema.parse(req.params);
  const body = updateServiceConfigBodySchema.parse(req.body);
  const result = await adminService.updateServiceConfig(actorId(req), params, body, clientIp(req));
  sendSuccess(res, { message: 'Service config updated', data: result });
});

export const postAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const body = announcementBodySchema.parse(req.body);
  const result = await adminService.postAnnouncement(actorId(req), body, clientIp(req));
  sendSuccess(res, { message: result.message, data: result });
});

// ═════════════════════════════════════════════════════════
// 5. AUDIT LOG
// ═════════════════════════════════════════════════════════
export const listAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const query = auditListQuerySchema.parse(req.query);
  const result = await adminService.listAuditLogs(query);
  sendSuccess(res, { data: result.items, meta: result.pagination });
});