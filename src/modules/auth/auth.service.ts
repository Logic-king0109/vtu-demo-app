import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomInt, randomBytes, createHash } from 'crypto';
import { prisma } from '../../config/db';
import { redis, redisKeys } from '../../config/redis';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { sendPasswordResetOtp } from '../../services/email.service';
import { createVirtualAccount } from '../../services/virtualAccount.service';
import type {
  RegisterInput, LoginInput, SetPinInput, ChangePinInput,
  ChangePasswordInput, ForgotPasswordInput, ResetPasswordInput,
} from './auth.validation';

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_BYTES = 48;

// ═════════════════════════════════════════════════════════════
// Token helpers
// ═════════════════════════════════════════════════════════════

type AccessTokenPayload = {
  sub: string;
  email: string;
  role: 'USER' | 'ADMIN';
};

function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

async function issueRefreshToken(userId: string, ua?: string, ip?: string) {
  const raw = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
  const tokenHash = hashRefreshToken(raw);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      userAgent: ua?.slice(0, 200),
      ipAddress: ip?.slice(0, 60),
    },
  });

  return { raw, expiresAt };
}

// ═════════════════════════════════════════════════════════════
// Register
// ═════════════════════════════════════════════════════════════

export async function register(input: RegisterInput) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { phone: input.phone }] },
    select: { email: true, phone: true },
  });
  if (existing) {
    if (existing.email === input.email) {
      throw ApiError.conflict('Email already registered', 'EMAIL_TAKEN');
    }
    throw ApiError.conflict('Phone already registered', 'PHONE_TAKEN');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  // Placeholder PIN hash — user must set PIN before first purchase.
  // Hashing a random value prevents "no pin" bypass if user forgets to set one.
  const pinHash = await bcrypt.hash(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

  // Create user + wallet in one transaction
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        passwordHash,
        pinHash,
      },
      select: { id: true, name: true, email: true, phone: true, createdAt: true },
    });
    await tx.wallet.create({ data: { userId: created.id } });
    return created;
  });

  // Create virtual account — best-effort. If VA provider is down,
  // user account still exists; we surface a warning but don't rollback.
  let vaInfo: { accountNumber: string; bankName: string; accountName: string } | null = null;
  try {
    const va = await createVirtualAccount({
      userId: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
    });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        vaNumber: va.accountNumber,
        vaBankName: va.bankName,
        vaAccountName: va.accountName,
        vaReference: va.reference,
        vaCreatedAt: new Date(),
      },
    });
    vaInfo = {
      accountNumber: va.accountNumber,
      bankName: va.bankName,
      accountName: va.accountName,
    };
  } catch (err) {
    logger.error(
      { err, userId: user.id },
      '[auth.register] VA creation failed — user can fund later after retry'
    );
  }

  return {
    user,
    virtualAccount: vaInfo,
    needsPinSetup: true,
  };
}

// ═════════════════════════════════════════════════════════════
// Login
// ═════════════════════════════════════════════════════════════

export async function login(input: LoginInput, ua?: string, ip?: string) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: {
      id: true, name: true, email: true, phone: true,
      passwordHash: true, role: true, status: true,
    },
  });

  // Use same error for unknown email and wrong password (no user enumeration)
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }
  if (user.status === 'BLOCKED') {
    throw ApiError.forbidden('Account is blocked', 'ACCOUNT_BLOCKED');
  }

  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });
  const { raw: refreshRaw, expiresAt } = await issueRefreshToken(user.id, ua, ip);

  return {
    accessToken,
    refreshToken: refreshRaw,
    refreshTokenExpiresAt: expiresAt,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    },
  };
}

// ═════════════════════════════════════════════════════════════
// Refresh (rotate)
// ═════════════════════════════════════════════════════════════

export async function refresh(rawRefreshToken: string, ua?: string, ip?: string) {
  if (!rawRefreshToken) {
    throw ApiError.unauthorized('Refresh token missing', 'NO_REFRESH_TOKEN');
  }
  const tokenHash = hashRefreshToken(rawRefreshToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, role: true, status: true } } },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw ApiError.unauthorized('Refresh token invalid or expired', 'INVALID_REFRESH_TOKEN');
  }
  if (stored.user.status === 'BLOCKED') {
    throw ApiError.forbidden('Account is blocked', 'ACCOUNT_BLOCKED');
  }

  // Rotate: revoke old, issue new
  const { raw: newRaw, expiresAt } = await prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const raw = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const created = await tx.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: hashRefreshToken(raw),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent: ua?.slice(0, 200),
        ipAddress: ip?.slice(0, 60),
      },
    });
    return { raw, expiresAt: created.expiresAt };
  });

  const accessToken = signAccessToken({
    sub: stored.user.id,
    email: stored.user.email,
    role: stored.user.role,
  });

  return {
    accessToken,
    refreshToken: newRaw,
    refreshTokenExpiresAt: expiresAt,
  };
}

// ═════════════════════════════════════════════════════════════
// Logout
// ═════════════════════════════════════════════════════════════

export async function logout(rawRefreshToken: string | undefined): Promise<void> {
  if (!rawRefreshToken) return;
  const tokenHash = hashRefreshToken(rawRefreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ═════════════════════════════════════════════════════════════
// PIN setup + change
// ═════════════════════════════════════════════════════════════

export async function setPin(userId: string, input: SetPinInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');

  const pinHash = await bcrypt.hash(input.pin, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: userId },
    data: {
      pinHash,
      pinVersion: { increment: 1 },
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    },
  });

  // Clear any existing lock
  await redis.del(redisKeys.pinLock(userId), redisKeys.pinAttempts(userId));
}

export async function changePin(userId: string, input: ChangePinInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pinHash: true },
  });
  if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');

  const ok = await bcrypt.compare(input.currentPin, user.pinHash);
  if (!ok) {
    throw ApiError.badRequest('Current PIN is incorrect', 'INVALID_PIN');
  }

  const pinHash = await bcrypt.hash(input.newPin, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: userId },
    data: {
      pinHash,
      pinVersion: { increment: 1 },
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    },
  });
}

// ═════════════════════════════════════════════════════════════
// Change password (authenticated)
// ═════════════════════════════════════════════════════════════

export async function changePassword(userId: string, input: ChangePasswordInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');

  const ok = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!ok) throw ApiError.badRequest('Current password is incorrect', 'INVALID_PASSWORD');

  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    // Revoke all refresh tokens (force re-login on all devices)
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
}

// ═════════════════════════════════════════════════════════════
// Forgot / reset password (OTP via email)
// ═════════════════════════════════════════════════════════════

export async function forgotPassword(input: ForgotPasswordInput, ip?: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, name: true, email: true },
  });

  // Respond identically whether email exists or not (no enumeration)
  if (!user) {
    logger.info({ email: input.email }, '[auth.forgotPassword] unknown email — silently ignoring');
    return;
  }

  const otp = randomInt(100000, 999999).toString();
  const otpHash = createHash('sha256').update(otp).digest('hex');
  const ttlSeconds = env.OTP_TTL_MINUTES * 60;

  // Store hashed OTP in Redis (also create DB record for audit)
  await redis.set(
    redisKeys.passwordResetOtp(user.id),
    otpHash,
    'EX',
    ttlSeconds
  );
  await redis.set(
    redisKeys.passwordResetAttempts(user.id),
    '0',
    'EX',
    ttlSeconds
  );

  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      otpHash,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      ipAddress: ip?.slice(0, 60),
    },
  });

  await sendPasswordResetOtp(user.email, user.name, otp);
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (!user) {
    throw ApiError.badRequest('Invalid OTP or email', 'INVALID_OTP');
  }

  const attemptsRaw = await redis.get(redisKeys.passwordResetAttempts(user.id));
  const attempts = parseInt(attemptsRaw ?? '0', 10);
  if (attempts >= env.OTP_MAX_ATTEMPTS) {
    throw ApiError.tooMany('Too many OTP attempts. Request a new code.', 'OTP_LOCKED');
  }

  const storedHash = await redis.get(redisKeys.passwordResetOtp(user.id));
  const providedHash = createHash('sha256').update(input.otp).digest('hex');

  if (!storedHash || storedHash !== providedHash) {
    await redis.incr(redisKeys.passwordResetAttempts(user.id));
    throw ApiError.badRequest('Invalid OTP or email', 'INVALID_OTP');
  }

  // Consume OTP — single use
  await redis.del(redisKeys.passwordResetOtp(user.id));
  await redis.del(redisKeys.passwordResetAttempts(user.id));

  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.passwordReset.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
}