import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';
import { redis } from '../config/redis';

function refreshTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface JwtPayload {
  id: string;
  company_id: string;
  role: string;
  godown_id: string | null;
  email: string;
  session_version: number;
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
 * Cache the current session_version for a user in Redis (TTL: 24h).
 * We set this on login so verifyToken can check without a DB query.
 */
export async function cacheSessionVersion(userId: string, version: number): Promise<void> {
  await redis.setex(`session_ver:${userId}`, 24 * 60 * 60, String(version));
}

/**
 * Retrieve cached session_version. Returns null if not cached.
 */
async function getCachedSessionVersion(userId: string): Promise<number | null> {
  const val = await redis.get(`session_ver:${userId}`);
  return val !== null ? parseInt(val, 10) : null;
}

/**
 * Verify JWT access token, attach user to request, and enforce single-device login.
 * If the token's session_version doesn't match the DB/cache value, the old device is rejected.
 */
export async function verifyToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Access token is required' });
    return;
  }

  const token = authHeader.split(' ')[1];

  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ success: false, error: 'Access token expired', code: 'TOKEN_EXPIRED' });
      return;
    }
    res.status(401).json({ success: false, error: 'Invalid access token' });
    return;
  }

  // Single-device enforcement: check session_version against Redis cache
  // If not cached (e.g. Redis restart), skip check — next login will reset it
  const cachedVersion = await getCachedSessionVersion(decoded.id);
  if (cachedVersion !== null && decoded.session_version !== cachedVersion) {
    res.status(401).json({
      success: false,
      error: 'You have been signed in on another device. Please log in again.',
      code: 'SESSION_REPLACED',
    });
    return;
  }

  req.user = decoded;
  next();
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
 * Store refresh token hash in Redis with 7-day TTL.
 * Storing only ONE hash per user means logging in on a new device
 * automatically invalidates the previous device's refresh token.
 */
export async function storeRefreshToken(userId: string, token: string): Promise<void> {
  await redis.setex(`refresh:${userId}`, 7 * 24 * 60 * 60, refreshTokenHash(token));
}

/**
 * Validate refresh token exists in Redis
 */
export async function validateRefreshToken(userId: string, token: string): Promise<boolean> {
  const stored = await redis.get(`refresh:${userId}`);
  return stored === refreshTokenHash(token);
}

/**
 * Remove refresh token from Redis (logout)
 */
export async function removeRefreshToken(userId: string): Promise<void> {
  await redis.del(`refresh:${userId}`);
  await redis.del(`session_ver:${userId}`);
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
