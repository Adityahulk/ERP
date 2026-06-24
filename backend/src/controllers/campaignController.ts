import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { enqueueJob } from '../jobs/queues';

// ── GET /api/campaigns ───────────────────────────────────────────
export async function listCampaigns(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const rows = await query(
      `SELECT * FROM campaigns WHERE company_id = $1 AND is_deleted = false ORDER BY created_at DESC LIMIT 100`,
      [companyId],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function getCampaign(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const campaign = await query(`SELECT * FROM campaigns WHERE id = $1 AND company_id = $2 AND is_deleted = false`, [req.params.id, companyId]);
    if (!campaign.rows.length) return res.status(404).json(error('Campaign not found'));
    const recipients = await query(`SELECT status, COUNT(*)::int AS count FROM campaign_recipients WHERE campaign_id = $1 GROUP BY status`, [req.params.id]);
    res.json(success({ ...campaign.rows[0], recipientBreakdown: recipients.rows }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

/** Resolves a segment name to a real list of contactable parties. No fake/sample data. */
async function resolveSegment(companyId: string, channel: 'whatsapp' | 'email', segment: string) {
  const contactCol = channel === 'whatsapp' ? 'phone' : 'email';
  let where = `company_id = $1 AND is_deleted = false AND ${contactCol} IS NOT NULL AND ${contactCol} != ''`;
  if (segment === 'customers') where += ` AND party_type IN ('customer', 'both')`;
  else if (segment === 'suppliers') where += ` AND party_type IN ('supplier', 'both')`;
  else if (segment === 'with_dues') where += ` AND balance > 0`;
  const rows = await query(`SELECT id, name, ${contactCol} AS contact FROM parties WHERE ${where}`, [companyId]);
  return rows.rows;
}

// ── POST /api/campaigns ───────────────────────────────────────────
// Creates the campaign and its real recipient list, but does NOT send
// yet — sending is a separate explicit action (POST /:id/send), so a
// campaign can be reviewed before anything goes out.
export async function createCampaign(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { channel, name, subject, message, segment } = req.body;
    if (!['whatsapp', 'email'].includes(channel)) return res.status(400).json(error('channel must be whatsapp or email'));
    if (!name?.trim() || !message?.trim()) return res.status(400).json(error('name and message are required'));
    if (channel === 'email' && !subject?.trim()) return res.status(400).json(error('subject is required for email campaigns'));

    const recipients = await resolveSegment(companyId, channel, segment || 'all');
    if (recipients.length === 0) {
      return res.status(400).json(error(`No parties found with a ${channel === 'whatsapp' ? 'phone number' : 'email address'} on file for this segment`));
    }

    const campaignRes = await query(
      `INSERT INTO campaigns (company_id, channel, name, subject, message, segment, recipient_count, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [companyId, channel, name.trim(), subject?.trim() || null, message, segment || 'all', recipients.length, req.user!.id],
    );
    const campaign = campaignRes.rows[0];

    for (const r of recipients) {
      await query(
        `INSERT INTO campaign_recipients (campaign_id, party_id, contact) VALUES ($1,$2,$3)`,
        [campaign.id, r.id, r.contact],
      );
    }

    res.status(201).json(success(campaign));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/campaigns/:id/send ──────────────────────────────────
export async function sendCampaign(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const campaign = await query(`SELECT * FROM campaigns WHERE id = $1 AND company_id = $2 AND is_deleted = false`, [req.params.id, companyId]);
    if (!campaign.rows.length) return res.status(404).json(error('Campaign not found'));
    if (campaign.rows[0].status !== 'draft') return res.status(400).json(error('This campaign has already been queued or sent'));

    await query(`UPDATE campaigns SET status = 'queued' WHERE id = $1`, [req.params.id]);
    const queueName = campaign.rows[0].channel === 'whatsapp' ? 'whatsappCampaign' : 'emailCampaign';
    const { jobId } = await enqueueJob(queueName, { campaignId: req.params.id, companyId }, { companyId });

    res.status(202).json(success({ queued: true, jobId }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function deleteCampaign(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const campaign = await query(`SELECT status FROM campaigns WHERE id = $1 AND company_id = $2`, [req.params.id, companyId]);
    if (!campaign.rows.length) return res.status(404).json(error('Campaign not found'));
    if (campaign.rows[0].status !== 'draft') return res.status(400).json(error('Only draft campaigns can be deleted'));
    await query(`UPDATE campaigns SET is_deleted = true WHERE id = $1`, [req.params.id]);
    res.json(success({ deleted: true }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
