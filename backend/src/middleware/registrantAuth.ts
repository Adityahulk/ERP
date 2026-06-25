import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface RegistrantPayload {
  id: string;
  email: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      registrant?: RegistrantPayload;
    }
  }
}

export function generateRegistrantToken(payload: RegistrantPayload): string {
  return jwt.sign({ ...payload, _type: 'registrant' }, env.JWT_SECRET, { expiresIn: '7d' });
}

export function verifyRegistrantToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Access token is required' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as any;
    if (decoded._type !== 'registrant') {
      res.status(401).json({ success: false, error: 'Invalid token type' });
      return;
    }
    req.registrant = { id: decoded.id, email: decoded.email, name: decoded.name };
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ success: false, error: 'Token expired', code: 'TOKEN_EXPIRED' });
      return;
    }
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
}
