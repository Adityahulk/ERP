/**
 * OTP service — generates, stores, and verifies one-time codes for:
 *  - signup email/phone verification
 *  - password reset
 *  - login MFA (future)
 *
 * Codes are stored hashed (bcrypt) so they can't be read out of the DB.
 * Existing unconsumed codes for the same (owner, purpose) are invalidated when a new one is issued.
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '../config/db';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { sendMail, renderOtpEmail, isMailerConfigured } from './mailer';

export type OtpPurpose = 'signup_verify' | 'password_reset' | 'login_2fa' | 'change_email';
export type OtpChannel = 'email' | 'sms';

export interface OwnerRef {
  registrant_id?: string | null;
  user_id?: string | null;
}

export interface IssueOtpArgs extends OwnerRef {
  channel: OtpChannel;
  identifier: string;          // email address or phone number
  purpose: OtpPurpose;
  recipientName?: string;
}

export interface IssueOtpResult {
  delivered: boolean;
  channel: OtpChannel;
  identifier_masked: string;
  expires_at: Date;
  /** When SMTP isn't configured (dev), the code is returned so the developer can finish the flow. */
  dev_code?: string;
  reason?: string;
}

export interface VerifyOtpArgs extends OwnerRef {
  code: string;
  purpose: OtpPurpose;
}

export interface VerifyOtpResult {
  ok: boolean;
  /** Reason on failure: 'expired'|'not_found'|'invalid'|'too_many_attempts' */
  reason?: 'expired' | 'not_found' | 'invalid' | 'too_many_attempts';
  attempts_remaining?: number;
}

function generateNumericCode(length: number): string {
  // crypto-strong, never zero-padded weirdness
  const max = 10 ** length;
  const n = crypto.randomInt(0, max);
  return String(n).padStart(length, '0');
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const visible = local.length <= 2 ? local[0] : `${local[0]}${local[1]}`;
  return `${visible}${'•'.repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return phone;
  return `${'•'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function maskIdentifier(channel: OtpChannel, value: string): string {
  return channel === 'email' ? maskEmail(value) : maskPhone(value);
}

function ownerWhere(owner: OwnerRef): { sql: string; params: any[] } {
  if (owner.registrant_id) {
    return { sql: 'registrant_id = $1', params: [owner.registrant_id] };
  }
  if (owner.user_id) {
    return { sql: 'user_id = $1', params: [owner.user_id] };
  }
  throw new Error('OTP owner is required (registrant_id or user_id)');
}

export class OtpRateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Please wait ${retryAfterSeconds}s before requesting another code`);
    this.name = 'OtpRateLimitError';
  }
}

/**
 * Generate a fresh OTP, persist it (hashed), and dispatch via the chosen channel.
 * Throws OtpRateLimitError if a code was sent within the cooldown window.
 */
export async function issueOtp(args: IssueOtpArgs): Promise<IssueOtpResult> {
  const owner = ownerWhere({ registrant_id: args.registrant_id, user_id: args.user_id });

  // Cooldown: refuse if a non-consumed code was sent within the last OTP_RESEND_COOLDOWN_SECONDS
  const recent = await query(
    `SELECT last_sent_at FROM verification_codes
     WHERE ${owner.sql} AND purpose = $${owner.params.length + 1} AND consumed_at IS NULL
     ORDER BY last_sent_at DESC LIMIT 1`,
    [...owner.params, args.purpose]
  );
  if (recent.rows.length) {
    const last = new Date(recent.rows[0].last_sent_at).getTime();
    const elapsed = Math.floor((Date.now() - last) / 1000);
    const cooldown = env.OTP_RESEND_COOLDOWN_SECONDS;
    if (elapsed < cooldown) {
      throw new OtpRateLimitError(cooldown - elapsed);
    }
  }

  const code = generateNumericCode(env.OTP_LENGTH);
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000);

  // Invalidate any previous unconsumed codes for this owner+purpose
  await query(
    `UPDATE verification_codes SET consumed_at = NOW(), expires_at = NOW()
     WHERE ${owner.sql} AND purpose = $${owner.params.length + 1} AND consumed_at IS NULL`,
    [...owner.params, args.purpose]
  );

  await query(
    `INSERT INTO verification_codes
       (registrant_id, user_id, channel, identifier, purpose, code_hash, expires_at, max_attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      args.registrant_id || null,
      args.user_id || null,
      args.channel,
      args.identifier,
      args.purpose,
      codeHash,
      expiresAt,
      env.OTP_MAX_ATTEMPTS,
    ]
  );

  // Dispatch
  let delivered = false;
  let reason: string | undefined;
  if (args.channel === 'email') {
    const tpl = renderOtpEmail(
      args.recipientName || '',
      code,
      args.purpose === 'change_email' ? 'signup_verify' : args.purpose,
    );
    const send = await sendMail({ to: args.identifier, subject: tpl.subject, html: tpl.html, text: tpl.text });
    delivered = send.delivered;
    reason = send.reason;
  } else {
    // SMS path — currently logs only. (Twilio SMS hookup would go here.)
    logger.info(`[otp] SMS would send code=${code} to=${args.identifier} purpose=${args.purpose}`);
    delivered = false;
    reason = 'sms_not_configured';
  }

  const result: IssueOtpResult = {
    delivered,
    channel: args.channel,
    identifier_masked: maskIdentifier(args.channel, args.identifier),
    expires_at: expiresAt,
    reason,
  };
  // In non-production environments without configured transport, surface the code so devs can complete the flow.
  if (env.NODE_ENV !== 'production' && !delivered && (args.channel !== 'email' || !isMailerConfigured())) {
    result.dev_code = code;
  }
  return result;
}

/**
 * Verify a submitted code. On success, the row is marked consumed and the function returns ok:true.
 * Failed attempts increment a counter — after max_attempts, the code is invalidated.
 */
export async function verifyOtp(args: VerifyOtpArgs): Promise<VerifyOtpResult> {
  const owner = ownerWhere({ registrant_id: args.registrant_id, user_id: args.user_id });

  const result = await query(
    `SELECT id, code_hash, attempts, max_attempts, expires_at, identifier
     FROM verification_codes
     WHERE ${owner.sql} AND purpose = $${owner.params.length + 1} AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [...owner.params, args.purpose]
  );

  if (!result.rows.length) {
    return { ok: false, reason: 'not_found' };
  }
  const row = result.rows[0];

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await query('UPDATE verification_codes SET consumed_at = NOW() WHERE id = $1', [row.id]);
    return { ok: false, reason: 'expired' };
  }

  if (row.attempts >= row.max_attempts) {
    await query('UPDATE verification_codes SET consumed_at = NOW() WHERE id = $1', [row.id]);
    return { ok: false, reason: 'too_many_attempts' };
  }

  const submitted = String(args.code || '').trim();
  const matches = await bcrypt.compare(submitted, row.code_hash);
  if (!matches) {
    const updated = await query(
      'UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts, max_attempts',
      [row.id]
    );
    const remaining = Math.max(0, updated.rows[0].max_attempts - updated.rows[0].attempts);
    return { ok: false, reason: 'invalid', attempts_remaining: remaining };
  }

  await query('UPDATE verification_codes SET consumed_at = NOW() WHERE id = $1', [row.id]);
  return { ok: true };
}

/** Fetch the most recent unconsumed code's metadata (channel, masked identifier, expiry) — used by the verify page. */
export async function getActiveOtpMeta(owner: OwnerRef, purpose: OtpPurpose) {
  const w = ownerWhere(owner);
  const r = await query(
    `SELECT channel, identifier, expires_at
     FROM verification_codes
     WHERE ${w.sql} AND purpose = $${w.params.length + 1} AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [...w.params, purpose]
  );
  if (!r.rows.length) return null;
  return {
    channel: r.rows[0].channel as OtpChannel,
    identifier_masked: maskIdentifier(r.rows[0].channel, r.rows[0].identifier),
    expires_at: r.rows[0].expires_at as Date,
  };
}
