import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';
import { query } from '../config/db';

function refreshTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Tenant users: real company UUID. Platform super_admin: empty string (DB user.company_id is null). */
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
 * Verify JWT access token, attach user to request, and enforce single-device login.
 * PostgreSQL is authoritative so a stale or read-only Redis node can never
 * revive an old session.
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
    const raw = jwt.verify(token, env.JWT_SECRET) as JwtPayload & { company_id?: string };
    decoded = { ...raw, company_id: raw.company_id ?? '' };
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ success: false, error: 'Access token expired', code: 'TOKEN_EXPIRED' });
      return;
    }
    res.status(401).json({ success: false, error: 'Invalid access token' });
    return;
  }

  const versionResult = await query(
    `SELECT session_version
     FROM users
     WHERE id = $1 AND is_deleted = false AND is_active = true`,
    [decoded.id]
  );

  if (!versionResult.rows.length) {
    res.status(401).json({ success: false, error: 'Account not found or deactivated' });
    return;
  }

  const currentVersion = Number(versionResult.rows[0].session_version);
  if (decoded.session_version !== currentVersion) {
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
  const raw = jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload & { company_id?: string };
  return { ...raw, company_id: raw.company_id ?? '' };
}

/**
 * Store one refresh token hash per user in PostgreSQL. A new login replaces
 * the previous hash, preserving single-device refresh semantics without
 * depending on Redis availability.
 */
export async function storeRefreshToken(userId: string, token: string): Promise<void> {
  const hash = refreshTokenHash(token);
  await query(
    `UPDATE users
     SET refresh_token_hash = $1,
         refresh_token_expires_at = NOW() + INTERVAL '7 days'
     WHERE id = $2 AND is_deleted = false`,
    [hash, userId]
  );
}

/**
 * Validate the active refresh token against PostgreSQL.
 */
export async function validateRefreshToken(userId: string, token: string): Promise<boolean> {
  const expectedHash = refreshTokenHash(token);

  const result = await query(
    `SELECT refresh_token_hash
     FROM users
     WHERE id = $1
       AND is_deleted = false
       AND is_active = true
       AND refresh_token_expires_at > NOW()`,
    [userId]
  );
  return result.rows[0]?.refresh_token_hash === expectedHash;
}

/**
 * Remove the active refresh token on logout or account invalidation.
 */
export async function removeRefreshToken(userId: string): Promise<void> {
  await query(
    `UPDATE users
     SET refresh_token_hash = NULL,
         refresh_token_expires_at = NULL
    WHERE id = $1`,
    [userId]
  );
}

/**
 * Optional auth — attaches user if token exists but doesn't block
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const raw = jwt.verify(authHeader.split(' ')[1], env.JWT_SECRET) as JwtPayload & { company_id?: string };
      req.user = { ...raw, company_id: raw.company_id ?? '' };
    } catch { /* continue without user */ }
  }
  next();
}
