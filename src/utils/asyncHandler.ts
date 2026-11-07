import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

/**
 * Wraps async route handlers so rejected promises are forwarded to
 * the global error middleware. Express 4 doesn't do this natively.
 */
export function asyncHandler(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}