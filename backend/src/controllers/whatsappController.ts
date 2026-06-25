import { Request, Response } from 'express';
import twilio from 'twilio';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { encryptSecret, decryptSecret } from '../lib/credentialsCrypto';
import { logAction } from '../lib/auditLog';

// ── GET /api/whatsapp/settings ──────────────────────────────────
export async function getWhatsappSettings(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT whatsapp_mode, whatsapp_twilio_account_sid, whatsapp_twilio_number, whatsapp_twilio_verified_at,
              whatsapp_cloud_phone_number_id, whatsapp_cloud_verified_at
       FROM companies WHERE id = $1`,
      [req.user!.company_id],
    );
    const row = result.rows[0] || {};
    res.json(success({
      mode: row.whatsapp_mode || 'twilio',
      twilioAccountSid: row.whatsapp_twilio_account_sid || null,
      twilioNumber: row.whatsapp_twilio_number || null,
      twilioVerifiedAt: row.whatsapp_twilio_verified_at || null,
      hasAuthToken: !!row.whatsapp_twilio_account_sid,
      cloudPhoneNumberId: row.whatsapp_cloud_phone_number_id || null,
      cloudVerifiedAt: row.whatsapp_cloud_verified_at || null,
      hasCloudToken: !!row.whatsapp_cloud_phone_number_id,
    }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── PATCH /api/whatsapp/mode ─────────────────────────────────────
export async function setWhatsappMode(req: Request, res: Response) {
  try {
    const mode = String(req.body?.mode || '');
    if (!['twilio', 'cloud_api', 'qr_login'].includes(mode)) return res.status(400).json(error('mode must be "twilio", "cloud_api", or "qr_login"'));
    await query(`UPDATE companies SET whatsapp_mode = $1 WHERE id = $2`, [mode, req.user!.company_id]);
    await logAction(req.user!.id, req.user!.company_id, 'whatsapp_mode_changed', 'company', req.user!.company_id, null, { mode }, req.ip);
    res.json(success({ mode }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── PATCH /api/whatsapp/twilio-config ────────────────────────────
export async function setTwilioConfig(req: Request, res: Response) {
  try {
    const { account_sid, auth_token, whatsapp_number } = req.body;
    if (!account_sid || !auth_token || !whatsapp_number) {
      return res.status(400).json(error('account_sid, auth_token, and whatsapp_number are all required'));
    }
    const encrypted = encryptSecret(String(auth_token));
    await query(
      `UPDATE companies SET whatsapp_twilio_account_sid = $1, whatsapp_twilio_auth_token_encrypted = $2,
              whatsapp_twilio_number = $3, whatsapp_twilio_verified_at = NULL
       WHERE id = $4`,
      [account_sid, encrypted, whatsapp_number, req.user!.company_id],
    );
    await logAction(req.user!.id, req.user!.company_id, 'whatsapp_twilio_config_updated', 'company', req.user!.company_id, null, { account_sid, whatsapp_number }, req.ip);
    res.json(success({ saved: true }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/whatsapp/test-connection ───────────────────────────
export async function testTwilioConnection(req: Request, res: Response) {
  try {
    const companyRes = await query(
      `SELECT whatsapp_twilio_account_sid, whatsapp_twilio_auth_token_encrypted FROM companies WHERE id = $1`,
      [req.user!.company_id],
    );
    const row = companyRes.rows[0];
    if (!row?.whatsapp_twilio_account_sid) return res.status(400).json(error('Save your Twilio Account SID and Auth Token first.'));
    const authToken = decryptSecret(row.whatsapp_twilio_auth_token_encrypted);
    if (!authToken) return res.status(400).json(error('Could not decrypt the stored Auth Token — please re-enter it.'));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const client = twilio(row.whatsapp_twilio_account_sid, authToken);
    const account = await client.api.v2010.accounts(row.whatsapp_twilio_account_sid).fetch();

    await query(`UPDATE companies SET whatsapp_twilio_verified_at = now() WHERE id = $1`, [req.user!.company_id]);
    res.json(success({ connected: true, accountStatus: account.status, friendlyName: account.friendlyName }));
  } catch (err: any) {
    res.status(400).json(error(`Twilio connection failed: ${err.message}`));
  }
}

// ── PATCH /api/whatsapp/cloud-config ─────────────────────────────
export async function setCloudApiConfig(req: Request, res: Response) {
  try {
    const { access_token, phone_number_id } = req.body;
    if (!access_token || !phone_number_id) {
      return res.status(400).json(error('access_token and phone_number_id are both required'));
    }
    const encrypted = encryptSecret(String(access_token));
    await query(
      `UPDATE companies SET whatsapp_cloud_access_token_encrypted = $1, whatsapp_cloud_phone_number_id = $2, whatsapp_cloud_verified_at = NULL
       WHERE id = $3`,
      [encrypted, phone_number_id, req.user!.company_id],
    );
    await logAction(req.user!.id, req.user!.company_id, 'whatsapp_cloud_config_updated', 'company', req.user!.company_id, null, { phone_number_id }, req.ip);
    res.json(success({ saved: true }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/whatsapp/test-cloud-connection ─────────────────────
export async function testCloudConnection(req: Request, res: Response) {
  try {
    const { cloudApiProvider } = await import('../services/whatsapp/cloudApiProvider');
    const result = await cloudApiProvider.testConnection(req.user!.company_id);
    if (result.connected) {
      await query(`UPDATE companies SET whatsapp_cloud_verified_at = now() WHERE id = $1`, [req.user!.company_id]);
    }
    res.json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/whatsapp/dashboard ──────────────────────────────────
export async function getWhatsappDashboard(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const companyRes = await query(`SELECT whatsapp_mode, whatsapp_twilio_number, whatsapp_cloud_phone_number_id FROM companies WHERE id = $1`, [companyId]);
    const mode = companyRes.rows[0]?.whatsapp_mode || 'twilio';
    const connectedNumber = mode === 'cloud_api' ? companyRes.rows[0]?.whatsapp_cloud_phone_number_id : companyRes.rows[0]?.whatsapp_twilio_number;
    const today = await query(
      `SELECT
         COUNT(*)::int AS total_today,
         COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_today,
         COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered_today,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_today,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_today
       FROM notification_logs
       WHERE company_id = $1 AND channel = 'whatsapp'
         AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`,
      [companyId],
    );
    res.json(success({
      activeMode: mode,
      connectedNumber: connectedNumber || null,
      ...today.rows[0],
    }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/whatsapp/logs ────────────────────────────────────────
export async function getWhatsappLogs(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { status, message_type, from_date, to_date, search, page = '1', limit = '25' } = req.query as any;
    const where: string[] = [`company_id = $1`, `channel = 'whatsapp'`];
    const params: any[] = [companyId];
    if (status) { where.push(`status = $${params.length + 1}`); params.push(status); }
    if (message_type) { where.push(`message_type = $${params.length + 1}`); params.push(message_type); }
    if (from_date) { where.push(`created_at >= $${params.length + 1}::date`); params.push(from_date); }
    if (to_date) { where.push(`created_at <= $${params.length + 1}::date + interval '1 day'`); params.push(to_date); }
    if (search) { where.push(`(recipient_phone ILIKE $${params.length + 1} OR recipient_name ILIKE $${params.length + 1})`); params.push(`%${search}%`); }

    const offset = (Math.max(1, parseInt(page)) - 1) * Math.max(1, parseInt(limit));
    const rows = await query(
      `SELECT * FROM notification_logs WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit), offset],
    );
    const countRes = await query(`SELECT COUNT(*)::int AS total FROM notification_logs WHERE ${where.join(' AND ')}`, params);
    res.json(success(rows.rows, { total: countRes.rows[0].total, page: parseInt(page), limit: parseInt(limit) }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
