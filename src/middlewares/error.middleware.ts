import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';
import { env } from '../config/env';

// ─── Normalize anything thrown into an ApiError-shaped result ───
function normalize(
  err: unknown
): { statusCode: number; code: string; message: string; details?: unknown; operational: boolean } {
  if (err instanceof ApiError) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
      operational: err.isOperational,
    };
  }

  if (err instanceof ZodError) {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request payload',
      details: err.flatten().fieldErrors,
      operational: true,
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
      return {
        statusCode: 409,
        code: 'DUPLICATE',
        message: `Duplicate value for ${target}`,
        operational: true,
      };
    }
    if (err.code === 'P2025') {
      return {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Record not found',
        operational: true,
      };
    }
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return {
      statusCode: 400,
      code: 'INVALID_JSON',
      message: 'Malformed JSON body',
      operational: true,
    };
  }

  return {
    statusCode: 500,
    code: 'INTERNAL',
    message: 'Internal server error',
    operational: false,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const { statusCode, code, message, details, operational } = normalize(err);

  // Log: operational → warn (no stack), non-operational → error (with stack)
  const logPayload = {
    reqId: (req as Request & { id?: string }).id,
    method: req.method,
    path: req.originalUrl,
    statusCode,
    code,
    ...(operational ? {} : { err }),
  };
  if (operational) logger.warn(logPayload, message);
  else logger.error(logPayload, message);

  // Never leak internals in production for unexpected errors
  const safeMessage = operational || !env.isProd ? message : 'Internal server error';

  res.status(statusCode).json({
    success: false,
    message: safeMessage,
    code,
    ...(details !== undefined && operational ? { details } : {}),
  });
}