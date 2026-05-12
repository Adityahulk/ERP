import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../config/logger';

let transporter: Transporter | null = null;

function hasResendConfig(): boolean {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM);
}

function hasSmtpConfig(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

function activeProvider(): 'resend' | 'smtp' | null {
  if (env.MAIL_PROVIDER === 'resend') return hasResendConfig() ? 'resend' : null;
  if (env.MAIL_PROVIDER === 'smtp') return hasSmtpConfig() ? 'smtp' : null;
  if (hasResendConfig()) return 'resend';
  if (hasSmtpConfig()) return 'smtp';
  return null;
}

export function isMailerConfigured(): boolean {
  return activeProvider() !== null;
}

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  if (!hasSmtpConfig()) return null;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT || 587,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS! },
  });
  return transporter;
}

export interface SendMailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send a transactional email. In dev (no SMTP configured) the call is logged and resolves
 * successfully so flows can still be tested — the OTP/link is also logged to the console.
 */
export async function sendMail({ to, subject, html, text }: SendMailArgs): Promise<{ delivered: boolean; reason?: string }> {
  const provider = activeProvider();
  if (!provider) {
    logger.warn(`[mailer] transactional email provider not configured — would have sent: to=${to} subject="${subject}"`);
    if (env.NODE_ENV !== 'production') {
      // In dev print the body so we can copy the OTP / reset link from logs
      logger.info(`[mailer:dev] body:\n${text || html}`);
    }
    return { delivered: false, reason: 'mailer_not_configured' };
  }

  try {
    if (provider === 'resend') {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.RESEND_FROM,
          to: [to],
          subject,
          html,
          text: text || html.replace(/<[^>]+>/g, ' '),
          ...(env.RESEND_REPLY_TO ? { reply_to: env.RESEND_REPLY_TO } : {}),
        }),
      });
      const payloadText = await response.text();
      let payload: any = null;
      try {
        payload = payloadText ? JSON.parse(payloadText) : null;
      } catch {
        payload = payloadText;
      }
      if (!response.ok) {
        const msg = typeof payload?.message === 'string'
          ? payload.message
          : typeof payload?.error === 'string'
            ? payload.error
            : payloadText || `HTTP ${response.status}`;
        throw new Error(`Resend email delivery failed: ${msg}`);
      }
    } else {
      const tx = getTransporter();
      if (!tx) throw new Error('SMTP mailer is not configured');
      await tx.sendMail({
        from: env.SMTP_FROM,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]+>/g, ' '),
      });
    }
    return { delivered: true };
  } catch (e: any) {
    logger.error(`[mailer] ${provider} send failed to=${to} subject="${subject}"`, e);
    return { delivered: false, reason: e?.message || 'send_failed' };
  }
}

const HTML_FRAME = (title: string, body: string) => `
<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f3ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 16px;">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(76,29,149,0.12);">
        <tr><td style="background:linear-gradient(135deg,#6d28d9,#3b0764);padding:24px 32px;color:#ffffff;">
          <div style="font-size:22px;font-weight:700;letter-spacing:-0.4px;">Microtechnique Accounts</div>
          <div style="font-size:13px;opacity:0.85;margin-top:4px;">${title}</div>
        </td></tr>
        <tr><td style="padding:28px 32px;color:#1f2937;font-size:15px;line-height:1.55;">
          ${body}
        </td></tr>
        <tr><td style="padding:18px 32px;background:#fafafa;color:#6b7280;font-size:12px;border-top:1px solid #f0eaff;">
          You are receiving this email because someone signed up or requested a password reset on Microtechnique Accounts.
          If that wasn't you, you can safely ignore this message.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

export function renderOtpEmail(name: string, code: string, purpose: 'signup_verify' | 'password_reset' | 'login_2fa') {
  const headlines: Record<string, string> = {
    signup_verify: 'Verify your email address',
    password_reset: 'Reset your password',
    login_2fa: 'Sign-in verification code',
  };
  const blurbs: Record<string, string> = {
    signup_verify: 'Use the code below to finish creating your Microtechnique Accounts profile.',
    password_reset: 'Use the code below to reset your password. This code will expire shortly.',
    login_2fa: 'Use the code below to complete your sign-in.',
  };
  const headline = headlines[purpose];
  const blurb = blurbs[purpose];

  const html = HTML_FRAME(headline, `
    <p style="margin:0 0 12px 0;">Hi ${name || 'there'},</p>
    <p style="margin:0 0 20px 0;">${blurb}</p>
    <div style="background:#f5f3ff;border:1px solid #ede9fe;border-radius:12px;padding:18px;text-align:center;font-size:30px;letter-spacing:8px;font-weight:700;color:#5b21b6;font-family:'SFMono-Regular',Menlo,monospace;">
      ${code}
    </div>
    <p style="margin:18px 0 0 0;color:#6b7280;font-size:13px;">This code expires in ${env.OTP_TTL_MINUTES} minutes. Don't share it with anyone — our team will never ask for this code.</p>
  `);

  const text = `Hi ${name || 'there'},\n\n${blurb}\n\nVerification code: ${code}\n(Expires in ${env.OTP_TTL_MINUTES} minutes)\n\nIf this wasn't you, you can ignore this email.`;
  return { subject: `[${code}] ${headline}`, html, text };
}

export function renderResetLinkEmail(name: string, link: string) {
  const html = HTML_FRAME('Reset your password', `
    <p style="margin:0 0 12px 0;">Hi ${name || 'there'},</p>
    <p style="margin:0 0 20px 0;">Click the button below to choose a new password. This link expires in 1 hour.</p>
    <p style="margin:0 0 18px 0;text-align:center;">
      <a href="${link}" style="display:inline-block;background:#6d28d9;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;">Reset password</a>
    </p>
    <p style="margin:0;color:#6b7280;font-size:13px;">Or copy this URL into your browser:<br><span style="word-break:break-all;color:#6d28d9;">${link}</span></p>
  `);
  const text = `Hi ${name || 'there'},\n\nReset your password using this link (expires in 1 hour):\n${link}\n\nIf this wasn't you, you can ignore this email.`;
  return { subject: 'Reset your Microtechnique password', html, text };
}
