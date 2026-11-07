import { Router } from 'express';
import * as controller from './admin.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { adminMiddleware } from '../../middlewares/admin.middleware';

const router = Router();

// ── Every admin route: authenticated + ADMIN role ─────
router.use(authMiddleware);
router.use(adminMiddleware);

// ── 1. Dashboard ───────────────────────────────────────
router.get('/dashboard', controller.getDashboard);

// ── 2. Users ───────────────────────────────────────────
router.get('/users', controller.listUsers);
router.get('/users/:id', controller.getUserDetail);
router.post('/users/:id/block', controller.blockUser);
router.post('/users/:id/unblock', controller.unblockUser);
router.post('/users/:id/reset-password', controller.resetUserPassword);
router.post('/users/:id/wallet', controller.adjustWallet);

// ── 3. Transactions ────────────────────────────────────
router.get('/transactions', controller.listTransactions);
router.get('/transactions/:id', controller.getTransactionDetail);
router.post('/transactions/:id/mark', controller.markTransaction);
router.post('/transactions/:id/refund', controller.refundTransaction);

// ── 4. Pricing & Network Control ───────────────────────
// Data plans
router.get('/plans', controller.listDataPlans);
router.post('/plans', controller.createDataPlan);
router.patch('/plans/:id', controller.updateDataPlan);

// Cable bouquets
router.get('/bouquets', controller.listBouquets);
router.patch('/bouquets/:id', controller.updateBouquet);

// Service configs (airtime margins, enable/disable)
router.get('/service-configs', controller.listServiceConfigs);
router.patch('/service-configs/:key', controller.updateServiceConfig);

// Global announcement
router.post('/announcements', controller.postAnnouncement);

// ── 5. Audit log ───────────────────────────────────────
router.get('/audit-logs', controller.listAuditLogs);

export default router;