import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { logger } from '../../utils/logger';
import { handleVaWebhook } from './webhook.service';

/**
 * VA provider webhook handler.
 *
 * IMPORTANT: this route mounts `express.raw()` — so `req.body` is a Buffer,
 * NOT parsed JSON. Signature verification needs the raw bytes exactly as
 * the provider sent them.
 */
export const vaWebhook = asyncHandler(async (req: Request, res: Response) => {
  // req.body is a Buffer thanks to express.raw() on the route
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');

  const signature =
    req.header('x-monnify-signature') ??
    req.header('x-webhook-signature') ??
    req.header('x-signature');

  const ip = req.ip;

  try {
    const result = await handleVaWebhook(rawBody, signature, ip);
    res.status(result.httpStatus).json(result.body);
  } catch (err) {
    // handleVaWebhook throws on real processing errors — let the global
    // error middleware format the response.
    logger.error({ err, ip }, '[webhook.controller] unhandled exception');
    throw err;
  }
});