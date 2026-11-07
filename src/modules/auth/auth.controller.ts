import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import * as authService from './auth.service';

const REFRESH_COOKIE = 'vtu_refresh';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax' as const,
    path: '/',
    domain: env.isProd ? env.COOKIE_DOMAIN : undefined,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

// ─── Client-type detection ──────────────────────────────
function isMobileClient(req: Request): boolean {
  const header = (req.header('X-Client-Type') ?? '').toLowerCase().trim();
  return header === 'mobile' || header === 'app';
}

// ─── Refresh-token extraction (priority: cookie → header → body) ───
function extractRefreshToken(req: Request): string | undefined {
  // 1) Cookie (web)
  const fromCookie = req.cookies?.[REFRESH_COOKIE];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;

  // 2) Authorization: Bearer <refresh> (mobile)
  const authHeader = req.header('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) return token;
  }

  // 3) Body: { refreshToken } (mobile fallback)
  const fromBody = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;

  return undefined;
}

// ═════════════════════════════════════════════════════════
// Register
// ═════════════════════════════════════════════════════════
export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.register(req.body);
  sendSuccess(res, {
    statusCode: 201,
    message: 'Account created. Please set your transaction PIN.',
    data: result,
  });
});

// ═════════════════════════════════════════════════════════
// Login (dual-mode)
// ═════════════════════════════════════════════════════════
export const login = asyncHandler(async (req: Request, res: Response) => {
  const mobile = isMobileClient(req);

  const result = await authService.login(
    req.body,
    req.headers['user-agent'],
    req.ip
  );

  // Always set the cookie — harmless for mobile, required for web.
  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());

  const payload: Record<string, unknown> = {
    accessToken: result.accessToken,
    user: result.user,
  };

  // Mobile: also return refresh token in body (mobile has no cookie jar).
  if (mobile) {
    payload.refreshToken = result.refreshToken;
    payload.refreshTokenExpiresAt = result.refreshTokenExpiresAt;
  }

  sendSuccess(res, { message: 'Logged in', data: payload });
});

// ═════════════════════════════════════════════════════════
// Refresh (dual-mode)
// ═════════════════════════════════════════════════════════
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const mobile = isMobileClient(req);
  const raw = extractRefreshToken(req);

  if (!raw) {
    throw ApiError.unauthorized('Refresh token missing', 'NO_REFRESH_TOKEN');
  }

  const result = await authService.refresh(raw, req.headers['user-agent'], req.ip);

  // Rotate cookie (web) — mobile ignores it.
  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());

  const payload: Record<string, unknown> = {
    accessToken: result.accessToken,
  };
  if (mobile) {
    payload.refreshToken = result.refreshToken;
    payload.refreshTokenExpiresAt = result.refreshTokenExpiresAt;
  }

  sendSuccess(res, { message: 'Token refreshed', data: payload });
});

// ═════════════════════════════════════════════════════════
// Logout (dual-mode)
// ═════════════════════════════════════════════════════════
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const raw = extractRefreshToken(req);
  await authService.logout(raw);
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
  sendSuccess(res, { message: 'Logged out' });
});

// ═════════════════════════════════════════════════════════
// PIN
// ═════════════════════════════════════════════════════════
export const setPin = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  await authService.setPin(req.user.id, req.body);
  sendSuccess(res, { message: 'Transaction PIN set' });
});

export const changePin = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  await authService.changePin(req.user.id, req.body);
  sendSuccess(res, { message: 'Transaction PIN updated' });
});

// ═════════════════════════════════════════════════════════
// Password
// ═════════════════════════════════════════════════════════
export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  await authService.changePassword(req.user.id, req.body);
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
  sendSuccess(res, { message: 'Password updated. Please log in again.' });
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.forgotPassword(req.body, req.ip);
  sendSuccess(res, {
    message: 'If the email exists, a reset code has been sent.',
  });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.resetPassword(req.body);
  sendSuccess(res, { message: 'Password reset. Please log in.' });
});