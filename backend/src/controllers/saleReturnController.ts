import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';

async function nextCreditNoteNumber(companyId: string, client: any) {
  const yr = new Date().getFullYear().toString().slice(-2);
  const res = await client.query(
    `SELECT COUNT(*)::int AS cnt FROM sale_returns WHERE company_id = $1 AND is_deleted = false`,
    [companyId],
  );
  const seq = String((res.rows[0].cnt || 0) + 1).padStart(4, '0');
  return `CN/${yr}/${seq}`;
}

export async function listSaleReturns(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { search, limit = 50, page = 1 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const conditions: string[] = ['r.company_id = $1', 'r.is_deleted = false'];
    const values: any[] = [companyId];
    let idx = 2;

    if (search) {
      conditions.push(`(r.credit_note_number ILIKE $${idx} OR r.party_name_snapshot ILIKE $${idx})`);
      values.push(`%${search}%`); idx++;
    }

    const where = conditions.join(' AND ');
    const rows = await query(
      `SELECT r.*, p.name AS party_name,
              COALESCE((
                SELECT json_agg(ri ORDER BY ri.created_at, ri.id)
                FROM sale_return_items ri
                WHERE ri.return_id = r.id
              ), '[]'::json) AS items
       FROM sale_returns r LEFT JOIN parties p ON p.id = r.party_id
       WHERE ${where} ORDER BY r.return_date DESC, r.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset],
    );
    res.json(success({ data: rows.rows }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function createSaleReturn(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body;
    if (!d.items?.length) return res.status(400).json(error('At least one item required'));

    const result = await withTransaction(async (client) => {
      const cnNumber = d.credit_note_number?.trim() || await nextCreditNoteNumber(companyId, client);

      const partySnap = d.party_id
        ? await client.query(`SELECT name FROM parties WHERE id = $1 AND company_id = $2`, [d.party_id, companyId])
        : { rows: [] };

      const totalAmount = (d.items as any[]).reduce(
        (s: number, it: any) => s + Math.round(it.quantity * it.unit_price), 0,
      );

      const returnRes = await client.query(
        `INSERT INTO sale_returns
           (company_id, party_id, invoice_id, credit_note_number, return_date, reason,
            total_amount, party_name_snapshot, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          companyId, d.party_id || null, d.invoice_id || null, cnNumber,
          d.return_date || new Date().toISOString().split('T')[0],
          d.reason || null, totalAmount,
          partySnap.rows[0]?.name || d.party_name || null,
          req.user!.id,
        ],
      );
      const returnId = returnRes.rows[0].id;

      for (const it of d.items as any[]) {
        await client.query(
          `INSERT INTO sale_return_items (return_id, item_id, item_name, hsn_code, unit, quantity, unit_price, gst_rate)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [returnId, it.item_id || null, it.item_name || it.name,
           it.hsn_code || null, it.unit || null, it.quantity, it.unit_price, it.gst_rate || 0],
        );
      }

      // Reduce party balance (credit note reduces what they owe)
      if (d.party_id) {
        await client.query(
          `UPDATE parties SET balance = balance - $1 WHERE id = $2`,
          [totalAmount, d.party_id],
        );
        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration)
           SELECT $1, $2, 'credit', $3, balance, 'credit_note', $4, 'Sale return / credit note'
           FROM parties WHERE id = $2`,
          [companyId, d.party_id, totalAmount, returnId],
        );
      }

      return returnRes.rows[0];
    });

    res.status(201).json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function updateSaleReturn(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { id } = req.params;
    const d = req.body;
    if (!d.items?.length) return res.status(400).json(error('At least one item required'));

    const result = await withTransaction(async (client) => {
      const oldRes = await client.query(
        `SELECT * FROM sale_returns WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE`,
        [id, companyId],
      );
      if (!oldRes.rows.length) throw new Error('Credit note not found');
      const old = oldRes.rows[0];

      if (old.party_id && Number(old.total_amount || 0) !== 0) {
        await client.query(
          `UPDATE parties SET balance = balance + $1 WHERE id = $2 AND company_id = $3`,
          [Number(old.total_amount || 0), old.party_id, companyId],
        );
      }
      await client.query(
        `DELETE FROM party_ledger WHERE company_id = $1 AND reference_type = 'credit_note' AND reference_id = $2`,
        [companyId, id],
      );
      await client.query(`DELETE FROM sale_return_items WHERE return_id = $1`, [id]);

      const totalAmount = (d.items as any[]).reduce(
        (s: number, it: any) => s + Math.round((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)),
        0,
      );

      const partySnap = d.party_id
        ? await client.query(`SELECT name FROM parties WHERE id = $1 AND company_id = $2`, [d.party_id, companyId])
        : { rows: [] };

      const updated = await client.query(
        `UPDATE sale_returns SET
           party_id = $1,
           invoice_id = $2,
           credit_note_number = $3,
           return_date = $4,
           reason = $5,
           total_amount = $6,
           party_name_snapshot = $7,
           updated_at = NOW()
         WHERE id = $8 AND company_id = $9
         RETURNING *`,
        [
          d.party_id || null,
          d.invoice_id || null,
          String(d.credit_note_number || old.credit_note_number).trim(),
          d.return_date || old.return_date,
          d.reason || null,
          totalAmount,
          partySnap.rows[0]?.name || d.party_name || null,
          id,
          companyId,
        ],
      );

      for (const it of d.items as any[]) {
        await client.query(
          `INSERT INTO sale_return_items (return_id, item_id, item_name, hsn_code, unit, quantity, unit_price, gst_rate)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            it.item_id || null,
            it.item_name || it.name || 'Item',
            it.hsn_code || null,
            it.unit || null,
            Number(it.quantity) || 0,
            Number(it.unit_price) || 0,
            Number(it.gst_rate) || 0,
          ],
        );
      }

      if (d.party_id) {
        await client.query(
          `UPDATE parties SET balance = balance - $1 WHERE id = $2 AND company_id = $3`,
          [totalAmount, d.party_id, companyId],
        );
        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration)
           SELECT $1, $2, 'credit', $3, balance, 'credit_note', $4, 'Sale return / credit note updated'
           FROM parties WHERE id = $2 AND company_id = $1`,
          [companyId, d.party_id, totalAmount, id],
        );
      }

      return updated.rows[0];
    });

    res.json(success(result));
  } catch (err: any) {
    const msg = err?.message || 'Failed to update credit note';
    res.status(/not found|required/i.test(msg) ? 400 : 500).json(error(msg));
  }
}
