import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { logAction } from '../lib/auditLog';
import {
  generateAccessToken, generateRefreshToken, verifyRefreshTokenJWT,
  storeRefreshToken, validateRefreshToken, removeRefreshToken,
  cacheSessionVersion,
  JwtPayload,
} from '../middleware/auth';

// ── POST /api/auth/login ──────────────────────────────────────
export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    const result = await query(
      `SELECT u.*,
              c.name as company_name, c.gstin as company_gstin, c.logo_url as company_logo,
              c.item_terminology, c.item_terminology_plural, c.onboarding_completed,
              c.plan_type, c.is_active as company_is_active,
              COALESCE(ep.godown_id, dg.id) as resolved_godown_id
       FROM users u
       JOIN companies c ON u.company_id = c.id AND c.is_deleted = false
       LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.is_deleted = false
       LEFT JOIN godowns dg ON dg.company_id = u.company_id AND dg.is_default = true AND dg.is_deleted = false
       WHERE u.email = $1 AND u.is_deleted = false`,
      [email.toLowerCase().trim()]
    );

    if (!result.rows.length) {
      return res.status(401).json(error('Invalid email or password'));
    }

    // Same email can exist in multiple companies; pick the row whose password matches.
    let user: (typeof result.rows)[0] | undefined;
    for (const row of result.rows) {
      const valid = await bcrypt.compare(password, row.password_hash);
      if (valid) {
        user = row;
        break;
      }
    }

    if (!user) {
      return res.status(401).json(error('Invalid email or password'));
    }

    if (user.is_active === false) {
      return res.status(403).json(error('Your account has been deactivated. Contact admin.'));
    }

    if (user.company_is_active === false) {
      return res.status(403).json(error('Your company license has been deactivated. Please contact support.'));
    }

    // Increment session_version — this kicks out any previously logged-in device
    const versionResult = await query(
      `UPDATE users SET session_version = session_version + 1, last_login_at = NOW()
       WHERE id = $1
       RETURNING session_version`,
      [user.id]
    );
    const newSessionVersion = versionResult.rows[0].session_version;

    // Cache the new session version in Redis for fast single-device checks
    await cacheSessionVersion(user.id, newSessionVersion);

    const tokenPayload: JwtPayload = {
      id: user.id,
      company_id: user.company_id,
      role: user.role,
      godown_id: user.resolved_godown_id || null,
      email: user.email,
      session_version: newSessionVersion,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Store refresh token in Redis (replaces any existing — old device refresh fails)
    await storeRefreshToken(user.id, refreshToken);

    // Audit
    await logAction(user.id, user.company_id, 'login', 'user', user.id, null, null, req.ip, req.get('User-Agent'));

    res.json(success({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar_url: user.avatar_url,
      },
      company: {
        id: user.company_id,
        name: user.company_name,
        gstin: user.company_gstin,
        logo_url: user.company_logo,
        item_terminology: user.item_terminology,
        item_terminology_plural: user.item_terminology_plural,
        onboarding_completed: user.onboarding_completed,
        plan_type: user.plan_type,
      },
      accessToken,
      refreshToken,
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/auth/refresh ────────────────────────────────────
export async function refresh(req: Request, res: Response) {
  try {
    const { refreshToken: token } = req.body;
    if (!token) return res.status(400).json(error('Refresh token is required'));

    let decoded: JwtPayload;
    try {
      decoded = verifyRefreshTokenJWT(token);
    } catch {
      return res.status(401).json(error('Invalid or expired refresh token'));
    }

    const valid = await validateRefreshToken(decoded.id, token);
    if (!valid) {
      return res.status(401).json(error('Refresh token has been revoked'));
    }

    // Fetch fresh user data
    const result = await query(
      `SELECT u.role, u.is_active, u.email, u.company_id, u.session_version,
              COALESCE(ep.godown_id, dg.id) as resolved_godown_id,
              c.is_active as company_is_active
       FROM users u
       INNER JOIN companies c ON c.id = u.company_id AND c.is_deleted = false AND c.is_active = true
       LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.is_deleted = false
       LEFT JOIN godowns dg ON dg.company_id = u.company_id AND dg.is_default = true AND dg.is_deleted = false
       WHERE u.id = $1 AND u.is_deleted = false`,
      [decoded.id]
    );

    if (!result.rows.length || !result.rows[0].is_active) {
      await removeRefreshToken(decoded.id);
      return res.status(401).json(error('Account not found or deactivated'));
    }

    const user = result.rows[0];

    // Verify session version matches — old device refresh is rejected
    if (decoded.session_version !== user.session_version) {
      await removeRefreshToken(decoded.id);
      return res.status(401).json({
        success: false,
        error: 'You have been signed in on another device. Please log in again.',
        code: 'SESSION_REPLACED',
      });
    }

    const payload: JwtPayload = {
      id: decoded.id,
      company_id: user.company_id,
      role: user.role,
      godown_id: user.resolved_godown_id || null,
      email: user.email,
      session_version: user.session_version,
    };

    const newAccessToken = generateAccessToken(payload);
    const newRefreshToken = generateRefreshToken(payload);
    await storeRefreshToken(decoded.id, newRefreshToken);

    // Refresh the Redis session version cache TTL
    await cacheSessionVersion(decoded.id, user.session_version);

    res.json(success({ accessToken: newAccessToken, refreshToken: newRefreshToken }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/auth/logout ─────────────────────────────────────
export async function logout(req: Request, res: Response) {
  try {
    if (req.user) {
      await removeRefreshToken(req.user.id);
      await logAction(req.user.id, req.user.company_id, 'logout', 'user', req.user.id);
    }
    res.json(success({ message: 'Logged out successfully' }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── GET /api/auth/me ──────────────────────────────────────────
export async function getMe(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.avatar_url, u.company_id,
              c.name as company_name, c.legal_name, c.gstin, c.pan, c.logo_url, c.signature_url,
              c.city, c.state, c.pincode, c.state_code, c.phone as company_phone, c.email as company_email,
              c.financial_year_start, c.invoice_prefix, c.po_prefix, c.quotation_prefix,
              c.default_due_days, c.currency, c.timezone,
              c.item_terminology, c.item_terminology_plural, c.default_gst_rate, c.default_hsn,
              c.bank_name, c.bank_account_number, c.bank_ifsc, c.bank_branch, c.upi_id,
              c.terms_and_conditions, c.invoice_notes,
              c.plan_type, c.onboarding_completed, c.license_id,
              g.id as godown_id, g.name as godown_name,
              -- License info
              lic.license_key, lic.status as license_status,
              lic.activated_at as license_activated_at, lic.expires_at as license_expires_at,
              lt.name as license_tier_name, lt.display_name as license_tier_display_name,
              lt.max_users as license_max_users,
              (SELECT COUNT(*) FROM users u2
               WHERE u2.company_id = u.company_id AND u2.is_deleted = false AND u2.is_active = true
              ) as license_used_users
       FROM users u
       JOIN companies c ON u.company_id = c.id AND c.is_deleted = false AND c.is_active = true
       LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.is_deleted = false
       LEFT JOIN godowns g ON g.id = COALESCE(ep.godown_id, (SELECT id FROM godowns WHERE company_id = u.company_id AND is_default = true AND is_deleted = false LIMIT 1))
       LEFT JOIN licenses lic ON lic.id = c.license_id AND lic.is_deleted = false
       LEFT JOIN license_tiers lt ON lt.id = lic.tier_id
       WHERE u.id = $1 AND u.is_deleted = false`,
      [req.user!.id]
    );

    if (!result.rows.length) {
      return res.status(404).json(error('User not found'));
    }

    const r = result.rows[0];
    res.json(success({
      user: {
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        role: r.role, avatar_url: r.avatar_url,
      },
      company: {
        id: r.company_id, name: r.company_name, legal_name: r.legal_name,
        gstin: r.gstin, pan: r.pan, logo_url: r.logo_url, signature_url: r.signature_url,
        city: r.city, state: r.state, pincode: r.pincode, state_code: r.state_code,
        phone: r.company_phone, email: r.company_email,
        financial_year_start: r.financial_year_start,
        invoice_prefix: r.invoice_prefix, po_prefix: r.po_prefix, quotation_prefix: r.quotation_prefix,
        default_due_days: r.default_due_days, currency: r.currency, timezone: r.timezone,
        item_terminology: r.item_terminology, item_terminology_plural: r.item_terminology_plural,
        default_gst_rate: r.default_gst_rate, default_hsn: r.default_hsn,
        bank_name: r.bank_name, bank_account_number: r.bank_account_number,
        bank_ifsc: r.bank_ifsc, bank_branch: r.bank_branch, upi_id: r.upi_id,
        terms_and_conditions: r.terms_and_conditions, invoice_notes: r.invoice_notes,
        plan_type: r.plan_type, onboarding_completed: r.onboarding_completed,
      },
      license: r.license_id ? {
        license_key: r.license_key,
        status: r.license_status,
        tier_name: r.license_tier_name,
        tier_display_name: r.license_tier_display_name,
        max_users: r.license_max_users,
        used_users: parseInt(r.license_used_users),
        activated_at: r.license_activated_at,
        expires_at: r.license_expires_at,
      } : null,
      godown: r.godown_id ? { id: r.godown_id, name: r.godown_name } : null,
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/auth/forgot-password ────────────────────────────
export async function forgotPassword(req: Request, res: Response) {
  try {
    const { email } = req.body;
    const result = await query(
      'SELECT id, company_id FROM users WHERE email = $1 AND is_deleted = false AND is_active = true',
      [email.toLowerCase().trim()]
    );

    if (!result.rows.length) {
      return res.json(success({ message: 'If the email exists, a reset link has been sent.' }));
    }

    const user = result.rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
      'UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3',
      [resetToken, expires, user.id]
    );

    const responseData: any = { message: 'If the email exists, a reset link has been sent.' };
    if (process.env.NODE_ENV === 'development') {
      responseData.resetToken = resetToken;
    }

    res.json(success(responseData));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/auth/reset-password ─────────────────────────────
export async function resetPassword(req: Request, res: Response) {
  try {
    const { token, password } = req.body;

    const result = await query(
      `SELECT id, company_id FROM users
       WHERE password_reset_token = $1 AND password_reset_expires > NOW() AND is_deleted = false`,
      [token]
    );

    if (!result.rows.length) {
      return res.status(400).json(error('Invalid or expired reset token'));
    }

    const user = result.rows[0];
    const hash = await bcrypt.hash(password, 12);

    await query(
      'UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL WHERE id = $2',
      [hash, user.id]
    );

    await removeRefreshToken(user.id);
    await logAction(user.id, user.company_id, 'reset_password', 'user', user.id);

    res.json(success({ message: 'Password reset successfully. Please login with your new password.' }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
