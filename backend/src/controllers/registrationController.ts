import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { generateRegistrantToken } from '../middleware/registrantAuth';
import { createAuthSessionForUser } from './authController';

// ── POST /api/register ────────────────────────────────────────
// Public — create a registrant account
export async function register(req: Request, res: Response) {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json(error('Name, email, and password are required'));
    }

    if (password.length < 8) {
      return res.status(400).json(error('Password must be at least 8 characters'));
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check uniqueness
    const existing = await query(
      'SELECT id FROM registrants WHERE email = $1 AND is_deleted = false',
      [normalizedEmail]
    );
    if (existing.rows.length) {
      return res.status(409).json(error('An account with this email already exists'));
    }

    const hash = await bcrypt.hash(password, 12);

    const result = await query(
      `INSERT INTO registrants (name, email, phone, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, phone, is_verified, created_at`,
      [name.trim(), normalizedEmail, phone || null, hash]
    );

    const registrant = result.rows[0];
    const token = generateRegistrantToken({ id: registrant.id, email: registrant.email, name: registrant.name });

    res.status(201).json(success({ registrant, token }));
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(error(err.message));
    }
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/register/login ──────────────────────────────────
// Public — registrant login (separate from application user login)
export async function registrantLogin(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json(error('Email and password are required'));
    }

    const result = await query(
      `SELECT id, name, email, phone, password_hash, is_active, is_verified
       FROM registrants
       WHERE email = $1 AND is_deleted = false`,
      [email.toLowerCase().trim()]
    );

    if (!result.rows.length) {
      return res.status(401).json(error('Invalid email or password'));
    }

    const registrant = result.rows[0];
    const valid = await bcrypt.compare(password, registrant.password_hash);
    if (!valid) {
      return res.status(401).json(error('Invalid email or password'));
    }

    if (!registrant.is_active) {
      return res.status(403).json(error('Your account has been deactivated. Please contact support.'));
    }

    await query('UPDATE registrants SET last_login_at = NOW() WHERE id = $1', [registrant.id]);

    const token = generateRegistrantToken({ id: registrant.id, email: registrant.email, name: registrant.name });

    res.json(success({
      registrant: {
        id: registrant.id,
        name: registrant.name,
        email: registrant.email,
        phone: registrant.phone,
        is_verified: registrant.is_verified,
      },
      token,
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── GET /api/register/me ──────────────────────────────────────
// Authenticated registrant — get profile + license summary
export async function getRegistrantMe(req: Request, res: Response) {
  try {
    const registrantId = req.registrant!.id;

    const registrantResult = await query(
      `SELECT id, name, email, phone, is_verified, created_at FROM registrants
       WHERE id = $1 AND is_deleted = false`,
      [registrantId]
    );

    if (!registrantResult.rows.length) {
      return res.status(404).json(error('Registrant not found'));
    }

    // Fetch their licenses with tier and company info
    const licensesResult = await query(
      `SELECT l.id, l.license_key, l.status, l.activated_at, l.expires_at, l.requested_at,
              lt.name as tier_name, lt.display_name as tier_display_name,
              lt.max_users, lt.price_inr,
              c.id as company_id, c.name as company_name,
              (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.is_deleted = false AND u.is_active = true) as active_users
       FROM licenses l
       JOIN license_tiers lt ON lt.id = l.tier_id
       LEFT JOIN companies c ON c.id = l.company_id
       WHERE l.registrant_id = $1 AND l.is_deleted = false
       ORDER BY COALESCE(l.activated_at, l.requested_at, l.created_at) DESC, l.created_at DESC`,
      [registrantId]
    );

    res.json(success({
      registrant: registrantResult.rows[0],
      licenses: licensesResult.rows,
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/register/licenses/:id/launch ───────────────────
// Authenticated registrant — launch an owned company directly
export async function launchOwnedCompany(req: Request, res: Response) {
  try {
    const registrantId = req.registrant!.id;
    const { id } = req.params;

    const licenseResult = await query(
      `SELECT l.id, l.status, l.company_id, c.name AS company_name, r.email AS registrant_email
       FROM licenses l
       JOIN registrants r ON r.id = l.registrant_id AND r.is_deleted = false
       LEFT JOIN companies c ON c.id = l.company_id AND c.is_deleted = false
       WHERE l.id = $1 AND l.registrant_id = $2 AND l.is_deleted = false
       LIMIT 1`,
      [id, registrantId]
    );

    if (!licenseResult.rows.length) {
      return res.status(404).json(error('License not found'));
    }

    const license = licenseResult.rows[0];
    if (!license.company_id) {
      return res.status(400).json(error('This license is not linked to a company yet.'));
    }
    if (!['active', 'trial'].includes(String(license.status))) {
      return res.status(400).json(error(`This company cannot be opened while the license is ${license.status}.`));
    }

    const usersResult = await query(
      `SELECT u.id
       FROM users u
       WHERE u.company_id = $1
         AND u.is_deleted = false
         AND u.is_active = true
       ORDER BY
         CASE WHEN lower(u.email) = lower($2) THEN 0 ELSE 1 END,
         CASE
           WHEN u.role IN ('company_admin', 'admin') THEN 0
           WHEN u.role IN ('manager', 'accountant', 'cashier') THEN 1
           ELSE 2
         END,
         u.created_at ASC
       LIMIT 1`,
      [license.company_id, license.registrant_email]
    );

    if (!usersResult.rows.length) {
      return res.status(404).json(error('No active company user found for this license.'));
    }

    const userId = usersResult.rows[0].id;

    const userSessionResult = await query(
      `SELECT u.*,
              c.name as company_name, c.gstin as company_gstin, c.logo_url as company_logo,
              c.item_terminology, c.item_terminology_plural, c.onboarding_completed,
              c.plan_type, c.is_active as company_is_active,
              COALESCE(ep.godown_id, dg.id) as resolved_godown_id
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id AND c.is_deleted = false
       LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.is_deleted = false
       LEFT JOIN godowns dg ON dg.company_id = u.company_id AND dg.is_default = true AND dg.is_deleted = false
       WHERE u.id = $1 AND u.is_deleted = false
       LIMIT 1`,
      [userId]
    );

    if (!userSessionResult.rows.length) {
      return res.status(404).json(error('Company user not found'));
    }

    const session = await createAuthSessionForUser(userSessionResult.rows[0], {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      action: 'registrant_launch_company',
    });

    res.json(success({
      ...session,
      source_license: {
        id: license.id,
        company_id: license.company_id,
        company_name: license.company_name,
        status: license.status,
      },
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/register/forgot-password ───────────────────────
export async function registrantForgotPassword(req: Request, res: Response) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json(error('Email is required'));

    const result = await query(
      'SELECT id FROM registrants WHERE email = $1 AND is_deleted = false AND is_active = true',
      [email.toLowerCase().trim()]
    );

    if (!result.rows.length) {
      return res.json(success({ message: 'If the email exists, a reset link has been sent.' }));
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
      'UPDATE registrants SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3',
      [resetToken, expires, result.rows[0].id]
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

// ── POST /api/register/reset-password ────────────────────────
export async function registrantResetPassword(req: Request, res: Response) {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json(error('Token and password are required'));

    const result = await query(
      `SELECT id FROM registrants
       WHERE password_reset_token = $1 AND password_reset_expires > NOW() AND is_deleted = false`,
      [token]
    );

    if (!result.rows.length) {
      return res.status(400).json(error('Invalid or expired reset token'));
    }

    const hash = await bcrypt.hash(password, 12);
    await query(
      'UPDATE registrants SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL WHERE id = $2',
      [hash, result.rows[0].id]
    );

    res.json(success({ message: 'Password reset successfully.' }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
