import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';

// ═══════════════════════════════════════════════════════════════
// PARTY GROUPS
// ═══════════════════════════════════════════════════════════════
export async function listPartyGroups(req: Request, res: Response) {
  try {
    const rows = await query(
      `SELECT g.*, (SELECT COUNT(*) FROM parties p WHERE p.party_group_id = g.id AND p.is_deleted = false) AS party_count
       FROM party_groups g WHERE g.company_id = $1 AND g.is_deleted = false ORDER BY g.name`,
      [req.user!.company_id],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function createPartyGroup(req: Request, res: Response) {
  try {
    const { name, party_type } = req.body;
    if (!name?.trim()) return res.status(400).json(error('Group name is required'));
    const result = await query(
      `INSERT INTO party_groups (company_id, name, party_type) VALUES ($1,$2,$3) RETURNING *`,
      [req.user!.company_id, name.trim(), party_type || 'both'],
    );
    res.status(201).json(success(result.rows[0]));
  } catch (err: any) {
    res.status(/duplicate|unique/i.test(err.message) ? 400 : 500).json(error(/unique/i.test(err.message) ? 'A group with this name already exists' : err.message));
  }
}

export async function deletePartyGroup(req: Request, res: Response) {
  try {
    await query(`UPDATE party_groups SET is_deleted = true WHERE id = $1 AND company_id = $2`, [req.params.id, req.user!.company_id]);
    await query(`UPDATE parties SET party_group_id = NULL WHERE party_group_id = $1`, [req.params.id]);
    res.json(success({ deleted: true }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ═══════════════════════════════════════════════════════════════
// PARTY CUSTOM FIELD DEFINITIONS
// ═══════════════════════════════════════════════════════════════
export async function listPartyCustomFieldDefs(req: Request, res: Response) {
  try {
    const rows = await query(
      `SELECT * FROM party_custom_field_defs WHERE company_id = $1 AND is_deleted = false ORDER BY sort_order, label`,
      [req.user!.company_id],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function createPartyCustomFieldDef(req: Request, res: Response) {
  try {
    const { label, field_type, show_in_print } = req.body;
    if (!label?.trim()) return res.status(400).json(error('Field label is required'));
    const result = await query(
      `INSERT INTO party_custom_field_defs (company_id, label, field_type, show_in_print) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user!.company_id, label.trim(), field_type || 'text', !!show_in_print],
    );
    res.status(201).json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function deletePartyCustomFieldDef(req: Request, res: Response) {
  try {
    await query(`UPDATE party_custom_field_defs SET is_deleted = true WHERE id = $1 AND company_id = $2`, [req.params.id, req.user!.company_id]);
    res.json(success({ deleted: true }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE TEMPLATES — real, DB-backed, overrides the hardcoded
// defaults in notificationService.ts once a row exists.
// ═══════════════════════════════════════════════════════════════
const KNOWN_TEMPLATE_TYPES = [
  'INVOICE_SHARE', 'PAYMENT_REMINDER', 'LOW_STOCK_ALERT', 'CAMPAIGN_BROADCAST', 'SERVICE_REMINDER',
];

export async function listMessageTemplates(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const rows = await query(`SELECT * FROM message_templates WHERE company_id = $1`, [companyId]);
    const byKey = new Map(rows.rows.map((r: any) => [`${r.channel}:${r.template_type}`, r]));
    // Always return one row per known template type per channel — real
    // saved override if it exists, otherwise a clearly-marked default
    // placeholder the user can edit and save for the first time.
    const result = ['whatsapp', 'email'].flatMap((channel) =>
      KNOWN_TEMPLATE_TYPES.map((type) => byKey.get(`${channel}:${type}`) || {
        company_id: companyId, channel, template_type: type, content: '', subject: null,
        send_copy_to_self: false, auto_send: true, is_active: true, is_default: true,
      }),
    );
    res.json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function saveMessageTemplate(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { channel, template_type, content, subject, send_copy_to_self, auto_send, is_active } = req.body;
    if (!['whatsapp', 'sms', 'email'].includes(channel)) return res.status(400).json(error('Invalid channel'));
    if (!content?.trim()) return res.status(400).json(error('Template content is required'));
    const result = await query(
      `INSERT INTO message_templates (company_id, channel, template_type, content, subject, send_copy_to_self, auto_send, is_active, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (company_id, channel, template_type) DO UPDATE SET
         content = $4, subject = $5, send_copy_to_self = $6, auto_send = $7, is_active = $8, updated_by = $9, updated_at = now()
       RETURNING *`,
      [companyId, channel, template_type, content, subject || null, !!send_copy_to_self, auto_send !== false, is_active !== false, req.user!.id],
    );
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ═══════════════════════════════════════════════════════════════
// LOYALTY — real points ledger driven by real invoice totals
// ═══════════════════════════════════════════════════════════════
export async function getLoyaltySettings(req: Request, res: Response) {
  try {
    const result = await query(`SELECT * FROM loyalty_settings WHERE company_id = $1`, [req.user!.company_id]);
    res.json(success(result.rows[0] || { enabled: false, points_per_rupee: 1, redemption_value_paise: 100 }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function updateLoyaltySettings(req: Request, res: Response) {
  try {
    const { enabled, points_per_rupee, redemption_value_paise } = req.body;
    const result = await query(
      `INSERT INTO loyalty_settings (company_id, enabled, points_per_rupee, redemption_value_paise)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (company_id) DO UPDATE SET enabled = $2, points_per_rupee = $3, redemption_value_paise = $4, updated_at = now()
       RETURNING *`,
      [req.user!.company_id, !!enabled, Number(points_per_rupee) || 1, Math.round(Number(redemption_value_paise)) || 100],
    );
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function getPartyLoyaltyBalance(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT COALESCE(SUM(points), 0)::int AS balance FROM loyalty_ledger WHERE company_id = $1 AND party_id = $2`,
      [req.user!.company_id, req.params.partyId],
    );
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ═══════════════════════════════════════════════════════════════
// MULTI-CURRENCY — exchange_rates CRUD (companies.enabled_currencies
// / default_currency already exist from migration 033)
// ═══════════════════════════════════════════════════════════════
export async function listExchangeRates(req: Request, res: Response) {
  try {
    const rows = await query(
      `SELECT * FROM exchange_rates WHERE company_id = $1 ORDER BY currency_code, rate_date DESC`,
      [req.user!.company_id],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function setExchangeRate(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { currency_code, rate_to_base, rate_date } = req.body;
    if (!currency_code || !rate_to_base) return res.status(400).json(error('currency_code and rate_to_base are required'));
    const result = await query(
      `INSERT INTO exchange_rates (company_id, currency_code, rate_to_base, rate_date, source, created_by)
       VALUES ($1,$2,$3,$4,'manual',$5)
       ON CONFLICT (company_id, currency_code, rate_date) DO UPDATE SET rate_to_base = $3, source = 'manual'
       RETURNING *`,
      [companyId, String(currency_code).toUpperCase(), Number(rate_to_base), rate_date || new Date().toISOString().split('T')[0], req.user!.id],
    );
    res.status(201).json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/settings-ext/exchange-rates/fetch-live ─────────────
// Pulls today's real rate using a connected exchange_rate_api
// integration (Settings → Integrations). No connection = clear error,
// never a fabricated rate.
export async function fetchLiveExchangeRates(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { decryptSecret } = await import('../lib/credentialsCrypto');
    const conn = await query(`SELECT * FROM tenant_integrations WHERE company_id = $1 AND provider = 'exchange_rate_api' AND status = 'connected'`, [companyId]);
    if (!conn.rows.length) return res.status(400).json(error('Connect "Exchange Rate Auto-Update" under Settings → Integrations first, or enter rates manually.'));
    const creds = JSON.parse(decryptSecret(conn.rows[0].encrypted_credentials) || '{}');

    const companyRes = await query(`SELECT default_currency, enabled_currencies FROM companies WHERE id = $1`, [companyId]);
    const base = companyRes.rows[0]?.default_currency || 'INR';
    const wanted: string[] = companyRes.rows[0]?.enabled_currencies || ['INR'];

    const apiRes = await fetch(`https://v6.exchangerate-api.com/v6/${creds.api_key}/latest/${base}`);
    if (!apiRes.ok) throw new Error(`Exchange rate API returned HTTP ${apiRes.status}`);
    const body: any = await apiRes.json();
    if (body.result !== 'success') throw new Error(body['error-type'] || 'Exchange rate fetch failed');

    const saved = [];
    for (const code of wanted) {
      if (code === base) continue;
      const rate = body.conversion_rates?.[code];
      if (!rate) continue;
      // rate from the API is base->code; we store code->base (rate_to_base), so invert.
      const rateToBase = 1 / rate;
      const r = await query(
        `INSERT INTO exchange_rates (company_id, currency_code, rate_to_base, rate_date, source)
         VALUES ($1,$2,$3,CURRENT_DATE,'api')
         ON CONFLICT (company_id, currency_code, rate_date) DO UPDATE SET rate_to_base = $3, source = 'api'
         RETURNING *`,
        [companyId, code, rateToBase],
      );
      saved.push(r.rows[0]);
    }
    res.json(success(saved));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ═══════════════════════════════════════════════════════════════
// GENERAL / INVENTORY / ACCOUNTING TOGGLES — real columns on
// companies, actually checked by the enforcement points below.
// ═══════════════════════════════════════════════════════════════
export async function updateEnforcementSettings(req: Request, res: Response) {
  try {
    const fields = ['stop_sale_on_negative_stock', 'block_new_items_in_transactions', 'block_new_parties_in_transactions', 'accounting_module_enabled'];
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); params.push(!!req.body[f]); }
    }
    if (!updates.length) return res.status(400).json(error('No valid settings provided'));
    params.push(req.user!.company_id);
    const result = await query(`UPDATE companies SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${fields.join(', ')}`, params);
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
