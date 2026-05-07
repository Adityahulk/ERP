import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { generateRegistrantToken } from '../middleware/registrantAuth';
import { createAuthSessionForUser } from './authController';
import { issueOtp, verifyOtp, getActiveOtpMeta, OtpRateLimitError } from '../services/otpService';
import { sendMail, renderResetLinkEmail, isMailerConfigured } from '../services/mailer';
import { env } from '../config/env';

// Short-lived token returned during signup that lets the client call verify/resend without password.
// Encodes the registrant id + email; verified server-side via JWT secret.
import jwt from 'jsonwebtoken';

const VERIFICATION_TOKEN_TTL = '30m';

interface VerificationTokenPayload {
  registrant_id: string;
  email: string;
  scope: 'pending_verification';
}

function issueVerificationToken(p: { registrant_id: string; email: string }): string {
  const payload: VerificationTokenPayload = {
    registrant_id: p.registrant_id,
    email: p.email,
    scope: 'pending_verification',
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: VERIFICATION_TOKEN_TTL });
}

function decodeVerificationToken(token: string): VerificationTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as VerificationTokenPayload;
    if (decoded.scope !== 'pending_verification') return null;
    return decoded;
  } catch {
    return null;
  }
}

// ── POST /api/register ────────────────────────────────────────
// Public — create a registrant account (unverified) and dispatch a signup OTP.
export async function register(req: Request, res: Response) {
  try {
    const { name, email, phone, password } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    // Check uniqueness — if a verified account already exists, refuse.
    // If an unverified account exists, allow re-issuing the OTP (so users who closed the tab can resume).
    const existing = await query(
      'SELECT id, email_verified_at, password_hash FROM registrants WHERE email = $1 AND is_deleted = false',
      [normalizedEmail]
    );

    let registrantId: string;
    let registrantName: string = name.trim();

    if (existing.rows.length) {
      const row = existing.rows[0];
      if (row.email_verified_at) {
        return res.status(409).json(error('An account with this email already exists. Please log in.'));
      }
      // Replace password & name on resume so the user can recover from a half-finished signup
      const hash = await bcrypt.hash(password, 12);
      await query(
        `UPDATE registrants SET name = $1, phone = $2, password_hash = $3, updated_at = NOW()
         WHERE id = $4`,
        [registrantName, phone || null, hash, row.id]
      );
      registrantId = row.id;
    } else {
      const hash = await bcrypt.hash(password, 12);
      const result = await query(
        `INSERT INTO registrants (name, email, phone, password_hash, is_verified, is_active)
         VALUES ($1, $2, $3, $4, false, true)
         RETURNING id, name`,
        [registrantName, normalizedEmail, phone || null, hash]
      );
      registrantId = result.rows[0].id;
      registrantName = result.rows[0].name;
    }

    // Send verification OTP
    let otpInfo;
    try {
      otpInfo = await issueOtp({
        registrant_id: registrantId,
        channel: 'email',
        identifier: normalizedEmail,
        purpose: 'signup_verify',
        recipientName: registrantName,
      });
    } catch (e) {
      if (e instanceof OtpRateLimitError) {
        return res.status(429).json(error(e.message));
      }
      throw e;
    }

    const verificationToken = issueVerificationToken({ registrant_id: registrantId, email: normalizedEmail });

    res.status(201).json(success({
      message: 'We sent a verification code to your email. Enter it to finish creating your account.',
      verification_token: verificationToken,
      email_masked: otpInfo.identifier_masked,
      expires_at: otpInfo.expires_at,
      delivered: otpInfo.delivered,
      // Dev only — surface the code if SMTP isn't configured so the flow remains testable.
      ...(otpInfo.dev_code ? { dev_code: otpInfo.dev_code } : {}),
    }));
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json(error(err.message));
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/register/verify ─────────────────────────────────
// Public — supply the verification_token from /register plus the OTP to finish signup.
export async function verifySignup(req: Request, res: Response) {
  try {
    const { verification_token, code } = req.body;
    if (!verification_token || !code) {
      return res.status(400).json(error('Verification token and code are required'));
    }
    const decoded = decodeVerificationToken(verification_token);
    if (!decoded) return res.status(400).json(error('Verification session expired. Please sign up again.'));

    const result = await verifyOtp({
      registrant_id: decoded.registrant_id,
      code,
      purpose: 'signup_verify',
    });

    if (!result.ok) {
      const messages: Record<string, string> = {
        expired: 'This code has expired. Please request a new one.',
        not_found: 'No active verification request. Please request a new code.',
        invalid: result.attempts_remaining
          ? `Incorrect code. ${result.attempts_remaining} attempt${result.attempts_remaining === 1 ? '' : 's'} remaining.`
          : 'Incorrect code. Please request a new one.',
        too_many_attempts: 'Too many incorrect attempts. Please request a new code.',
      };
      return res.status(400).json(error(messages[result.reason!] || 'Verification failed'));
    }

    // Mark verified and issue a normal login session.
    const upd = await query(
      `UPDATE registrants
         SET is_verified = true,
             email_verified_at = NOW(),
             last_login_at = NOW()
       WHERE id = $1 AND is_deleted = false
       RETURNING id, name, email, phone, is_verified`,
      [decoded.registrant_id]
    );
    if (!upd.rows.length) return res.status(404).json(error('Registrant not found'));

    const r = upd.rows[0];
    const token = generateRegistrantToken({ id: r.id, email: r.email, name: r.name });

    res.json(success({
      registrant: r,
      token,
      message: 'Email verified successfully.',
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/register/resend-verification ────────────────────
// Public — resends the signup OTP. Accepts either the verification_token (preferred)
// or an email (used when the token expired but the user is still on the page).
export async function resendSignupOtp(req: Request, res: Response) {
  try {
    const { verification_token, email } = req.body;
    let registrantId: string | null = null;
    let registrantEmail: string | null = null;

    if (verification_token) {
      const decoded = decodeVerificationToken(verification_token);
      if (decoded) {
        registrantId = decoded.registrant_id;
        registrantEmail = decoded.email;
      }
    }
    if (!registrantId && email) {
      const r = await query(
        'SELECT id, email FROM registrants WHERE email = $1 AND is_deleted = false AND email_verified_at IS NULL',
        [String(email).toLowerCase().trim()]
      );
      if (r.rows.length) {
        registrantId = r.rows[0].id;
        registrantEmail = r.rows[0].email;
      }
    }

    if (!registrantId || !registrantEmail) {
      // Don't leak whether the email exists — reply success-shaped
      return res.json(success({ message: 'If an unverified account exists, a new code has been sent.' }));
    }

    const nameRow = await query('SELECT name FROM registrants WHERE id = $1', [registrantId]);

    let otpInfo;
    try {
      otpInfo = await issueOtp({
        registrant_id: registrantId,
        channel: 'email',
        identifier: registrantEmail,
        purpose: 'signup_verify',
        recipientName: nameRow.rows[0]?.name,
      });
    } catch (e) {
      if (e instanceof OtpRateLimitError) {
        return res.status(429).json(error(e.message));
      }
      throw e;
    }

    const newToken = issueVerificationToken({ registrant_id: registrantId, email: registrantEmail });
    res.json(success({
      message: 'A new code has been sent.',
      verification_token: newToken,
      email_masked: otpInfo.identifier_masked,
      expires_at: otpInfo.expires_at,
      delivered: otpInfo.delivered,
      ...(otpInfo.dev_code ? { dev_code: otpInfo.dev_code } : {}),
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── GET /api/register/verification-status ─────────────────────
// Public — given a verification_token, return masked email + expiry so the verify page can show context.
export async function getVerificationStatus(req: Request, res: Response) {
  try {
    const token = String(req.query.token || '');
    if (!token) return res.status(400).json(error('Verification token is required'));
    const decoded = decodeVerificationToken(token);
    if (!decoded) return res.status(400).json(error('Verification session expired. Please sign up again.'));

    const meta = await getActiveOtpMeta({ registrant_id: decoded.registrant_id }, 'signup_verify');
    res.json(success({
      registrant_email_masked: meta?.identifier_masked || decoded.email,
      expires_at: meta?.expires_at || null,
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/register/login ──────────────────────────────────
// Public — registrant login. Refuses unverified accounts and prompts the client to verify.
export async function registrantLogin(req: Request, res: Response) {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email).toLowerCase().trim();

    const result = await query(
      `SELECT id, name, email, phone, password_hash, is_active, is_verified, email_verified_at
       FROM registrants
       WHERE email = $1 AND is_deleted = false`,
      [normalizedEmail]
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

    // Block sign-in for unverified accounts and re-issue an OTP so the client can route to /verify.
    if (!registrant.email_verified_at) {
      let otpInfo;
      try {
        otpInfo = await issueOtp({
          registrant_id: registrant.id,
          channel: 'email',
          identifier: registrant.email,
          purpose: 'signup_verify',
          recipientName: registrant.name,
        });
      } catch (e) {
        if (e instanceof OtpRateLimitError) {
          // User triggered too many resends — still tell client to verify, no fresh code.
        } else {
          throw e;
        }
      }
      const verificationToken = issueVerificationToken({ registrant_id: registrant.id, email: registrant.email });
      return res.status(403).json({
        success: false,
        error: 'Please verify your email before signing in.',
        code: 'EMAIL_NOT_VERIFIED',
        data: {
          verification_token: verificationToken,
          email_masked: otpInfo?.identifier_masked,
          expires_at: otpInfo?.expires_at,
          delivered: otpInfo?.delivered,
          ...(otpInfo?.dev_code ? { dev_code: otpInfo.dev_code } : {}),
        },
      });
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
export async function getRegistrantMe(req: Request, res: Response) {
  try {
    const registrantId = req.registrant!.id;

    const registrantResult = await query(
      `SELECT id, name, email, phone, is_verified, email_verified_at, created_at
       FROM registrants WHERE id = $1 AND is_deleted = false`,
      [registrantId]
    );

    if (!registrantResult.rows.length) {
      return res.status(404).json(error('Registrant not found'));
    }

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
// Public — send a reset link via email. Always returns success-shaped reply (no email enumeration).
export async function registrantForgotPassword(req: Request, res: Response) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json(error('Email is required'));
    const cleanEmail = String(email).toLowerCase().trim();

    const result = await query(
      'SELECT id, name, email FROM registrants WHERE email = $1 AND is_deleted = false AND is_active = true',
      [cleanEmail]
    );

    // Always reply with the same shape so attackers can't probe for valid emails.
    const okReply: any = {
      message: 'If an account exists for that email, we sent a reset link.',
      delivered: false,
    };

    if (!result.rows.length) {
      return res.json(success(okReply));
    }

    const r = result.rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
      'UPDATE registrants SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3',
      [resetToken, expires, r.id]
    );

    const baseUrl = (env.FRONTEND_URL || '').replace(/\/$/, '') || '';
    const link = `${baseUrl}/register/reset-password?token=${encodeURIComponent(resetToken)}`;
    const tpl = renderResetLinkEmail(r.name, link);
    const send = await sendMail({ to: r.email, subject: tpl.subject, html: tpl.html, text: tpl.text });

    okReply.delivered = send.delivered;
    if (env.NODE_ENV !== 'production' && (!send.delivered || !isMailerConfigured())) {
      // Surface the link in dev so the flow remains testable.
      okReply.dev_reset_link = link;
    }
    res.json(success(okReply));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/register/reset-password ────────────────────────
export async function registrantResetPassword(req: Request, res: Response) {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json(error('Token and password are required'));
    if (String(password).length < 8) return res.status(400).json(error('Password must be at least 8 characters'));

    const result = await query(
      `SELECT id FROM registrants
       WHERE password_reset_token = $1 AND password_reset_expires > NOW() AND is_deleted = false`,
      [token]
    );

    if (!result.rows.length) {
      return res.status(400).json(error('Invalid or expired reset link. Please request a new one.'));
    }

    const hash = await bcrypt.hash(password, 12);
    await query(
      `UPDATE registrants
         SET password_hash = $1,
             password_reset_token = NULL,
             password_reset_expires = NULL,
             updated_at = NOW()
       WHERE id = $2`,
      [hash, result.rows[0].id]
    );

    res.json(success({ message: 'Password reset successfully. You can now sign in.' }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
