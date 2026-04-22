import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

function formatZodErrors(error: ZodError): Array<{ field: string; message: string }> {
  return error.errors.map(err => ({
    field: err.path.join('.'),
    message: err.message,
  }));
}

/**
 * Validate request body against a Zod schema.
 * Replaces req.body with the parsed (coerced/transformed) value.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ success: false, error: 'Validation failed', errors: formatZodErrors(err) });
        return;
      }
      res.status(400).json({ success: false, error: 'Invalid request data' });
    }
  };
}

/**
 * Validate query parameters against a Zod schema.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query) as any;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ success: false, error: 'Validation failed', errors: formatZodErrors(err) });
        return;
      }
      res.status(400).json({ success: false, error: 'Invalid query parameters' });
    }
  };
}

/**
 * Validate URL params against a Zod schema.
 */
export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.params = schema.parse(req.params) as any;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ success: false, error: 'Validation failed', errors: formatZodErrors(err) });
        return;
      }
      res.status(400).json({ success: false, error: 'Invalid URL parameters' });
    }
  };
}
