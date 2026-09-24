import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { generateSalesDocumentPDF } from '../services/pdfService';
import { isMailerConfigured, sendMail } from '../services/mailer';

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
      `SELECT r.*, p.name AS party_name, p.phone AS party_phone, p.email AS party_email,
              i.invoice_number,
              COALESCE((
                SELECT json_agg(ri ORDER BY ri.created_at, ri.id)
                FROM sale_return_items ri
                WHERE ri.return_id = r.id
              ), '[]'::json) AS items
       FROM sale_returns r
       LEFT JOIN parties p ON p.id = r.party_id AND p.company_id = r.company_id
       LEFT JOIN invoices i ON i.id = r.invoice_id AND i.company_id = r.company_id
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
      if (old.status === 'cancelled') throw new Error('A cancelled credit note cannot be edited');

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

async function loadSaleReturnDocument(id: string, companyId: string) {
  const [returnRes, itemsRes, companyRes] = await Promise.all([
    query(
      `SELECT r.*, p.name AS party_name, p.phone AS party_phone, p.email AS party_email,
              p.gstin AS party_gstin, p.billing_address AS party_address, i.invoice_number
       FROM sale_returns r
       LEFT JOIN parties p ON p.id = r.party_id AND p.company_id = r.company_id
       LEFT JOIN invoices i ON i.id = r.invoice_id AND i.company_id = r.company_id
       WHERE r.id = $1 AND r.company_id = $2 AND r.is_deleted = false`,
      [id, companyId],
    ),
    query(`SELECT * FROM sale_return_items WHERE return_id = $1 ORDER BY created_at, id`, [id]),
    query(`SELECT * FROM companies WHERE id = $1 AND is_deleted = false`, [companyId]),
  ]);
  if (!returnRes.rows.length) throw Object.assign(new Error('Credit note not found'), { status: 404 });
  if (!companyRes.rows.length) throw Object.assign(new Error('Company not found'), { status: 404 });
  const creditNote = returnRes.rows[0];
  const party = creditNote.party_id
    ? (await query(`SELECT * FROM parties WHERE id = $1 AND company_id = $2`, [creditNote.party_id, companyId])).rows[0]
    : null;
  return { creditNote, items: itemsRes.rows, company: companyRes.rows[0], party };
}

export async function getSaleReturn(req: Request, res: Response) {
  try {
    const loaded = await loadSaleReturnDocument(req.params.id, req.user!.company_id);
    res.json(success({ ...loaded.creditNote, items: loaded.items }));
  } catch (err: any) {
    res.status(err?.status || 500).json(error(err?.message || 'Failed to load credit note'));
  }
}

export async function getSaleReturnPDF(req: Request, res: Response) {
  try {
    const loaded = await loadSaleReturnDocument(req.params.id, req.user!.company_id);
    const pdf = await generateSalesDocumentPDF('credit_note', loaded.creditNote, loaded.company, loaded.party, loaded.items);
    const filename = `${String(loaded.creditNote.credit_note_number || 'credit-note').replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${String(req.query.inline || '') === '1' ? 'inline' : 'attachment'}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  } catch (err: any) {
    res.status(err?.status || 500).json(error(err?.message || 'Failed to generate credit note PDF'));
  }
}

export async function emailSaleReturn(req: Request, res: Response) {
  try {
    if (!isMailerConfigured()) return res.status(503).json(error('Email delivery is not configured on this server.'));
    const recipient = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return res.status(400).json(error('Enter a valid email address'));
    const loaded = await loadSaleReturnDocument(req.params.id, req.user!.company_id);
    const pdf = await generateSalesDocumentPDF('credit_note', loaded.creditNote, loaded.company, loaded.party, loaded.items);
    const safeNumber = String(loaded.creditNote.credit_note_number || 'credit-note').replace(/[^A-Za-z0-9._-]+/g, '-');
    const sent = await sendMail({
      to: recipient,
      subject: `Credit Note ${loaded.creditNote.credit_note_number} from ${loaded.company.name}`,
      html: `<p>Please find credit note <strong>${loaded.creditNote.credit_note_number}</strong> attached.</p><p>Thank you,<br>${loaded.company.name}</p>`,
      text: `Please find credit note ${loaded.creditNote.credit_note_number} attached.`,
      attachments: [{ filename: `${safeNumber}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });
    if (!sent.delivered) return res.status(502).json(error(sent.reason || 'Email delivery failed'));
    res.json(success({ delivered: true, recipient }));
  } catch (err: any) {
    res.status(err?.status || 500).json(error(err?.message || 'Failed to email credit note'));
  }
}

async function deactivateSaleReturn(id: string, companyId: string, softDelete: boolean) {
  return withTransaction(async (client) => {
    const current = await client.query(
      `SELECT * FROM sale_returns WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE`,
      [id, companyId],
    );
    if (!current.rows.length) throw Object.assign(new Error('Credit note not found'), { status: 404 });
    const row = current.rows[0];
    if (row.status !== 'cancelled' && row.party_id && Number(row.total_amount || 0) !== 0) {
      await client.query(
        `UPDATE parties SET balance = balance + $1 WHERE id = $2 AND company_id = $3`,
        [Number(row.total_amount), row.party_id, companyId],
      );
      await client.query(
        `DELETE FROM party_ledger WHERE company_id = $1 AND reference_type = 'credit_note' AND reference_id = $2`,
        [companyId, id],
      );
    }
    const updated = await client.query(
      `UPDATE sale_returns SET status = 'cancelled', is_deleted = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3 RETURNING *`,
      [softDelete, id, companyId],
    );
    return updated.rows[0];
  });
}

export async function cancelSaleReturn(req: Request, res: Response) {
  try {
    const row = await deactivateSaleReturn(req.params.id, req.user!.company_id, false);
    res.json(success(row));
  } catch (err: any) {
    res.status(err?.status || 500).json(error(err?.message || 'Failed to cancel credit note'));
  }
}

export async function deleteSaleReturn(req: Request, res: Response) {
  try {
    const row = await deactivateSaleReturn(req.params.id, req.user!.company_id, true);
    res.json(success({ id: row.id }));
  } catch (err: any) {
    res.status(err?.status || 500).json(error(err?.message || 'Failed to delete credit note'));
  }
}
