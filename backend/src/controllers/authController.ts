import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { logAction } from '../lib/auditLog';
import {
  generateAccessToken, generateRefreshToken, verifyRefreshTokenJWT,
  storeRefreshToken, validateRefreshToken, removeRefreshToken,
  cacheSessionVersion,
  JwtPayload,
} from '../middleware/auth';

type AuthenticatedUserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  avatar_url: string | null;
  is_active: boolean;
  company_id: string | null;
  company_name: string | null;
  company_gstin: string | null;
  company_logo: string | null;
  item_terminology: string | null;
  item_terminology_plural: string | null;
  onboarding_completed: boolean | null;
  plan_type: string | null;
  company_is_active: boolean | null;
  resolved_godown_id: string | null;
};

function sessionAccessError(message: string, status = 403) {
  return Object.assign(new Error(message), { status });
}

export async function createAuthSessionForUser(
  user: AuthenticatedUserRow,
  meta?: { ip?: string; userAgent?: string; action?: string }
) {
  if (user.is_active === false) {
    throw sessionAccessError('Your account has been deactivated. Contact admin.');
  }

  if (user.role !== 'super_admin' && user.company_id != null && user.company_is_active === false) {
    throw sessionAccessError('Your company license has been deactivated. Please contact support.');
  }

  const versionResult = await query(
    `UPDATE users SET session_version = session_version + 1, last_login_at = NOW()
     WHERE id = $1
     RETURNING session_version`,
    [user.id]
  );
  const newSessionVersion = versionResult.rows[0].session_version;

  await cacheSessionVersion(user.id, newSessionVersion);

  const tokenPayload: JwtPayload = {
    id: user.id,
    company_id: user.role === 'super_admin' ? '' : user.company_id || '',
    role: user.role,
    godown_id: user.role === 'super_admin' ? null : user.resolved_godown_id || null,
    email: user.email,
    session_version: newSessionVersion,
  };

  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);

  await storeRefreshToken(user.id, refreshToken);

  await logAction(
    user.id,
    user.company_id ?? null,
    meta?.action || 'login',
    'user',
    user.id,
    null,
    null,
    meta?.ip,
    meta?.userAgent
  );

  const companyPayload =
    user.role === 'super_admin' || user.company_id == null
      ? null
      : {
          id: user.company_id,
          name: user.company_name,
          gstin: user.company_gstin,
          logo_url: user.company_logo,
          item_terminology: user.item_terminology,
          item_terminology_plural: user.item_terminology_plural,
          onboarding_completed: user.onboarding_completed,
          plan_type: user.plan_type,
        };

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      avatar_url: user.avatar_url,
    },
    company: companyPayload,
    accessToken,
    refreshToken,
  };
}

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
       LEFT JOIN companies c ON c.id = u.company_id AND c.is_deleted = false
       LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.is_deleted = false
       LEFT JOIN godowns dg ON dg.company_id = u.company_id AND dg.is_default = true AND dg.is_deleted = false
       WHERE u.email = $1 AND u.is_deleted = false
         AND (
           u.role = 'super_admin'
           OR (u.company_id IS NOT NULL AND c.id IS NOT NULL)
         )`,
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

    const session = await createAuthSessionForUser(user, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      action: 'login',
    });

    res.json(success(session));
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(error(err.message));
    }
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
       LEFT JOIN companies c ON c.id = u.company_id AND c.is_deleted = false
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

    if (user.role !== 'super_admin') {
      if (!user.company_id || !user.company_is_active) {
        await removeRefreshToken(decoded.id);
        return res.status(401).json(error('Account not found or company inactive'));
      }
    }

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
      company_id: user.role === 'super_admin' ? '' : user.company_id,
      role: user.role,
      godown_id: user.role === 'super_admin' ? null : user.resolved_godown_id || null,
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
      await logAction(req.user.id, req.user.company_id ? req.user.company_id : null, 'logout', 'user', req.user.id);
    }
    res.json(success({ message: 'Logged out successfully' }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── GET /api/auth/me ──────────────────────────────────────────
export async function getMe(req: Request, res: Response) {
  try {
    const roleCheck = await query(`SELECT role, company_id FROM users WHERE id = $1 AND is_deleted = false`, [
      req.user!.id,
    ]);
    if (!roleCheck.rows.length) {
      return res.status(404).json(error('User not found'));
    }
    if (roleCheck.rows[0].role === 'super_admin') {
      const uRes = await query(
        `SELECT id, name, email, phone, role, avatar_url, company_id FROM users WHERE id = $1 AND is_deleted = false`,
        [req.user!.id]
      );
      const u = uRes.rows[0];
      return res.json(
        success({
          user: {
            id: u.id,
            name: u.name,
            email: u.email,
            phone: u.phone,
            role: u.role,
            avatar_url: u.avatar_url,
          },
          company: null,
          license: null,
          godown: null,
        })
      );
    }

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
        trial_days_remaining: r.license_status === 'trial' && r.license_expires_at
          ? Math.max(0, Math.ceil((new Date(r.license_expires_at).getTime() - Date.now()) / 86400000))
          : null,
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
    await logAction(user.id, user.company_id ?? null, 'reset_password', 'user', user.id);

    res.json(success({ message: 'Password reset successfully. Please login with your new password.' }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/auth/trial-signup ───────────────────────────────
// Self-serve 15-day free trial. Creates registrant + company + user + trial license
// in one transaction. No admin approval required.
export async function trialSignup(req: Request, res: Response) {
  try {
    const { name, email, password, business_name, phone } = req.body;

    const cleanEmail = email.toLowerCase().trim();

    // Ensure the email isn't already an application user
    const existing = await query(
      `SELECT id FROM users WHERE email = $1 AND is_deleted = false LIMIT 1`,
      [cleanEmail]
    );
    if (existing.rows.length) {
      return res.status(409).json(error('An account with this email already exists. Please log in.'));
    }

    // Fetch Diamond tier (trial gets full feature access)
    const tierRes = await query(
      `SELECT id, max_users FROM license_tiers WHERE name = 'diamond' AND is_active = true LIMIT 1`
    );
    if (!tierRes.rows.length) {
      return res.status(500).json(error('Trial configuration error. Please contact support.'));
    }
    const tier = tierRes.rows[0];

    const passwordHash = await bcrypt.hash(password, 12);
    const trialExpiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 days

    const result = await withTransaction(async (client) => {
      // 1. Create or reuse registrant
      let registrantId: string;
      const regCheck = await client.query(
        `SELECT id FROM registrants WHERE email = $1 AND is_deleted = false LIMIT 1`,
        [cleanEmail]
      );
      if (regCheck.rows.length) {
        registrantId = regCheck.rows[0].id;
      } else {
        const regRes = await client.query(
          `INSERT INTO registrants (name, email, phone, password_hash, is_verified, is_active)
           VALUES ($1, $2, $3, $4, true, true)
           RETURNING id`,
          [name.trim(), cleanEmail, phone?.trim() || null, passwordHash]
        );
        registrantId = regRes.rows[0].id;
      }

      // 2. Create trial license (company_id filled after company creation)
      const licRes = await client.query(
        `INSERT INTO licenses (registrant_id, tier_id, status, activated_at, expires_at, notes)
         VALUES ($1, $2, 'trial', NOW(), $3, 'Self-serve 15-day free trial')
         RETURNING id, license_key`,
        [registrantId, tier.id, trialExpiresAt]
      );
      const license = licRes.rows[0];

      // 3. Create company
      const companyRes = await client.query(
        `INSERT INTO companies (name, email, license_id)
         VALUES ($1, $2, $3)
         RETURNING id, name`,
        [business_name.trim(), cleanEmail, license.id]
      );
      const company = companyRes.rows[0];

      // 4. Link license → company
      await client.query(
        `UPDATE licenses SET company_id = $1 WHERE id = $2`,
        [company.id, license.id]
      );

      // 5. Create application user (company_admin, same credentials)
      const userRes = await client.query(
        `INSERT INTO users (company_id, name, email, password_hash, role, is_active)
         VALUES ($1, $2, $3, $4, 'company_admin', true)
         RETURNING id, name, email, role`,
        [company.id, name.trim(), cleanEmail, passwordHash]
      );
      const user = userRes.rows[0];

      return { user, company, license, trialExpiresAt };
    });

    const daysRemaining = 15;

    res.status(201).json(success({
      message: `Your 15-day free trial is active! Log in with your email and password.`,
      email: cleanEmail,
      company_name: result.company.name,
      trial_expires_at: result.trialExpiresAt,
      trial_days_remaining: daysRemaining,
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
