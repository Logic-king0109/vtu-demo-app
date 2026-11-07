import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { prisma } from '../config/db';

export type AuthUser = {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'BLOCKED';
};

// Augment Express Request so downstream code gets typed req.user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

type AccessTokenPayload = {
  sub: string;
  email: string;
  role: 'USER' | 'ADMIN';
};

export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Missing access token', 'NO_TOKEN');
    }

    const token = header.slice(7).trim();
    if (!token) {
      throw ApiError.unauthorized('Empty access token', 'NO_TOKEN');
    }

    let payload: AccessTokenPayload;
    try {
      payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    } catch (err) {
      const isExpired = err instanceof jwt.TokenExpiredError;
      throw new ApiError(
        401,
        isExpired ? 'Access token expired' : 'Invalid access token',
        isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
      );
    }

    // Fetch fresh user state — so a blocked user loses access immediately,
    // even if their access token hasn't expired yet.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, status: true },
    });

    if (!user) {
      throw ApiError.unauthorized('User no longer exists', 'USER_GONE');
    }
    if (user.status === 'BLOCKED') {
      throw ApiError.forbidden('Account is blocked', 'ACCOUNT_BLOCKED');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}