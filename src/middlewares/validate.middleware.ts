import { Request, Response, NextFunction } from 'express';
import { ZodTypeAny } from 'zod';

type Schemas = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
};

/**
 * Validates req.body / req.query / req.params against Zod schemas.
 * Replaces each with the PARSED result so downstream code gets coerced,
 * trimmed, and stripped values — not the raw input.
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        // Express types req.query as Readonly; cast for assignment
        req.query = schemas.query.parse(req.query) as typeof req.query;
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Convenience: body-only validator.
 */
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return validate({ body: schema });
}