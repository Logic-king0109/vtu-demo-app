import { Router } from 'express';
import * as controller from './auth.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { validateBody } from '../../middlewares/validate.middleware';
import { rateLimitAuth } from '../../middlewares/rateLimit.middleware';
import {
  registerSchema, loginSchema, setPinSchema, changePinSchema,
  changePasswordSchema, forgotPasswordSchema, resetPasswordSchema,
} from './auth.validation';

const router = Router();

// ── Public (rate-limited per IP) ──────────────────────
router.post('/register', rateLimitAuth, validateBody(registerSchema), controller.register);
router.post('/login', rateLimitAuth, validateBody(loginSchema), controller.login);

// Refresh + logout: no body validation (accept cookie / header / body).
// Rate-limited to prevent token-guessing on mobile header path.
router.post('/refresh', rateLimitAuth, controller.refresh);
router.post('/logout', rateLimitAuth, controller.logout);

router.post('/forgot-password', rateLimitAuth, validateBody(forgotPasswordSchema), controller.forgotPassword);
router.post('/reset-password', rateLimitAuth, validateBody(resetPasswordSchema), controller.resetPassword);

// ── Authenticated ──────────────────────────────────────
router.post('/pin', authMiddleware, validateBody(setPinSchema), controller.setPin);
router.patch('/pin', authMiddleware, validateBody(changePinSchema), controller.changePin);
router.patch('/password', authMiddleware, validateBody(changePasswordSchema), controller.changePassword);

export default router;