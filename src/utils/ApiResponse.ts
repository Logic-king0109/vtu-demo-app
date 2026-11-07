import { Response } from 'express';

type SuccessOptions<T> = {
  statusCode?: number;
  message?: string;
  data?: T;
  meta?: Record<string, unknown>;
};

export function sendSuccess<T>(res: Response, opts: SuccessOptions<T> = {}): void {
  const { statusCode = 200, message = 'OK', data, meta } = opts;
  res.status(statusCode).json({
    success: true,
    message,
    ...(data !== undefined ? { data } : {}),
    ...(meta !== undefined ? { meta } : {}),
  });
}

export function sendCreated<T>(res: Response, data: T, message = 'Created'): void {
  sendSuccess(res, { statusCode: 201, message, data });
}

export function sendNoContent(res: Response): void {
  res.status(204).end();
}