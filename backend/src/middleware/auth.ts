import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { redis } from '../config/redis';

export interface JwtPayload {
  id: string;
  company_id: string;
  role: string;
  godown_id: string | null;
  email: string;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Verify JWT access token and attach user to request.
 * Token payload: { id, company_id, role, godown_id, email }
 */
export function verifyToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Access token is required' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ success: false, error: 'Access token expired', code: 'TOKEN_EXPIRED' });
      return;
    }
    res.status(401).json({ success: false, error: 'Invalid access token' });
  }
}

/**
 * Generate JWT access token (15 min default)
 */
export function generateAccessToken(payload: JwtPayload): string {
  return jwt.sign({ ...payload }, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRY as any });
}

/**
 * Generate JWT refresh token (7 days default)
 */
export function generateRefreshToken(payload: JwtPayload): string {
  return jwt.sign({ ...payload }, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRY as any });
}

/**
 * Verify a refresh token
 */
export function verifyRefreshTokenJWT(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
}

/**
 * Store refresh token hash in Redis with 7-day TTL
 */
export async function storeRefreshToken(userId: string, token: string): Promise<void> {
  await redis.setex(`refresh:${userId}`, 7 * 24 * 60 * 60, token);
}

/**
 * Validate refresh token exists in Redis
 */
export async function validateRefreshToken(userId: string, token: string): Promise<boolean> {
  const stored = await redis.get(`refresh:${userId}`);
  return stored === token;
}

/**
 * Remove refresh token from Redis (logout)
 */
export async function removeRefreshToken(userId: string): Promise<void> {
  await redis.del(`refresh:${userId}`);
}

/**
 * Optional auth — attaches user if token exists but doesn't block
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(authHeader.split(' ')[1], env.JWT_SECRET) as JwtPayload;
    } catch { /* continue without user */ }
  }
  next();
}
