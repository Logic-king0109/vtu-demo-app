import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';

/**
 * Must run AFTER authMiddleware. Rejects non-admins.
 */
export function adminMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    return next(ApiError.unauthorized('Not authenticated', 'NO_USER'));
  }
  if (req.user.role !== 'ADMIN') {
    return next(ApiError.forbidden('Admin access required', 'NOT_ADMIN'));
  }
  next();
}