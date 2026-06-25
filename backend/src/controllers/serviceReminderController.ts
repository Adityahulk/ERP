import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';

export async function listServiceReminders(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { status } = req.query;
    const where: string[] = ['sr.company_id = $1', 'sr.is_deleted = false'];
    const params: any[] = [companyId];
    if (status === 'upcoming') where.push(`sr.status = 'pending' AND sr.due_date >= CURRENT_DATE`);
    else if (status === 'overdue') where.push(`sr.status = 'pending' AND sr.due_date < CURRENT_DATE`);
    else if (status === 'completed') where.push(`sr.status = 'completed'`);
    const rows = await query(
      `SELECT sr.*, p.name AS party_name, p.phone AS party_phone, p.email AS party_email, it.name AS item_name
       FROM service_reminders sr
       LEFT JOIN parties p ON p.id = sr.party_id
       LEFT JOIN items it ON it.id = sr.item_id
       WHERE ${where.join(' AND ')}
       ORDER BY sr.due_date ASC`,
      params,
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function createServiceReminder(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body;
    if (!d.title?.trim() || !d.due_date || !d.reminder_type) return res.status(400).json(error('title, due_date, and reminder_type are required'));
    const result = await query(
      `INSERT INTO service_reminders (company_id, party_id, item_id, reminder_type, title, notes, due_date, recurrence, channel, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [companyId, d.party_id || null, d.item_id || null, d.reminder_type, d.title.trim(), d.notes || null, d.due_date, d.recurrence || null, d.channel || 'whatsapp', req.user!.id],
    );
    res.status(201).json(success(result.rows[0]));
  } catch (err: any) { res.status(400).json(error(err.message)); }
}

export async function updateServiceReminder(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body;
    const result = await query(
      `UPDATE service_reminders SET
         title = COALESCE($1, title), notes = COALESCE($2, notes), due_date = COALESCE($3, due_date),
         recurrence = COALESCE($4, recurrence), channel = COALESCE($5, channel), status = COALESCE($6, status)
       WHERE id = $7 AND company_id = $8 RETURNING *`,
      [d.title, d.notes, d.due_date, d.recurrence, d.channel, d.status, req.params.id, companyId],
    );
    if (!result.rows.length) return res.status(404).json(error('Reminder not found'));
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function deleteServiceReminder(req: Request, res: Response) {
  try {
    await query(`UPDATE service_reminders SET is_deleted = true WHERE id = $1 AND company_id = $2`, [req.params.id, req.user!.company_id]);
    res.json(success({ deleted: true }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
