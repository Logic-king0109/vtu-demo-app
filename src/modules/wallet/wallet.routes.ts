import { Router } from 'express';
import * as controller from './wallet.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { historyQuerySchema } from './wallet.validation';

const router = Router();

router.use(authMiddleware);

router.get('/', controller.getWallet);
router.get('/history', validate({ query: historyQuerySchema }), controller.getHistory);

export default router;