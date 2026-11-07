import { Router, raw } from 'express';
import { vaWebhook } from './webhook.controller';
import { rateLimitWebhook } from '../../middlewares/rateLimit.middleware';

const router = Router();


router.post(
  '/va',
  rateLimitWebhook,
  raw({ type: '*/*', limit: '256kb' }),
  vaWebhook
);

export default router;