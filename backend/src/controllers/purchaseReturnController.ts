import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { resolveDefaultGodownId } from './invoiceController';
import { postPurchaseReturnAccounting } from '../services/accountingService';

async function nextDebitNoteNumber(companyId: string, client: any) {
  const yr = new Date().getFullYear().toString().slice(-2);
  const res = await client.query(
    `SELECT COUNT(*)::int AS cnt FROM purchase_returns WHERE company_id = $1 AND is_deleted = false`,
    [companyId],
  );
  const seq = String((res.rows[0].cnt || 0) + 1).padStart(4, '0');
  return `DN/${yr}/${seq}`;
}

// ── GET /api/purchases/returns ───────────────────────────────────
export async function listPurchaseReturns(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { search, party_id, from_date, to_date, limit = 50, page = 1 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const conditions: string[] = ['r.company_id = $1', 'r.is_deleted = false'];
    const values: any[] = [companyId];
    let idx = 2;

    if (search) {
      conditions.push(`(r.debit_note_number ILIKE $${idx} OR r.party_name_snapshot ILIKE $${idx})`);
      values.push(`%${search}%`); idx++;
    }
    if (party_id) { conditions.push(`r.party_id = $${idx++}`); values.push(party_id); }
    if (from_date) { conditions.push(`r.return_date >= $${idx++}`); values.push(from_date); }
    if (to_date) { conditions.push(`r.return_date <= $${idx++}`); values.push(to_date); }

    const where = conditions.join(' AND ');
    const [rows, countRes, statsRes] = await Promise.all([
      query(
        `SELECT r.*, p.name AS party_name, pi.bill_number AS purchase_bill_number,
                COALESCE((SELECT COUNT(*) FROM purchase_return_items ri WHERE ri.return_id = r.id), 0) AS item_count,
                COALESCE((SELECT SUM(ri.quantity) FROM purchase_return_items ri WHERE ri.return_id = r.id), 0) AS total_quantity
         FROM purchase_returns r
         LEFT JOIN parties p ON p.id = r.party_id
         LEFT JOIN purchase_invoices pi ON pi.id = r.purchase_invoice_id
         WHERE ${where} ORDER BY r.return_date DESC, r.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset],
      ),
      query(`SELECT COUNT(*)::int AS total FROM purchase_returns r WHERE ${where}`, values),
      query(
        `SELECT COALESCE(SUM(total_amount),0) AS total_amount, COALESCE(SUM(refund_received),0) AS total_refunded
         FROM purchase_returns r WHERE ${where}`,
        values,
      ),
    ]);

    res.json(success(
      { data: rows.rows, pagination: { page: Number(page), limit: Number(limit), total: countRes.rows[0].total } },
      statsRes.rows[0],
    ));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function getPurchaseReturn(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const ret = await query(
      `SELECT r.*, p.name AS party_name, pi.bill_number AS purchase_bill_number
       FROM purchase_returns r
       LEFT JOIN parties p ON p.id = r.party_id
       LEFT JOIN purchase_invoices pi ON pi.id = r.purchase_invoice_id
       WHERE r.id = $1 AND r.company_id = $2 AND r.is_deleted = false`,
      [req.params.id, companyId],
    );
    if (!ret.rows.length) return res.status(404).json(error('Debit note not found'));
    const items = await query(`SELECT * FROM purchase_return_items WHERE return_id = $1 ORDER BY created_at`, [req.params.id]);
    res.json(success({ ...ret.rows[0], items: items.rows }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/purchases/returns ───────────────────────────────────
export async function createPurchaseReturn(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body;
    if (!d.items?.length) return res.status(400).json(error('At least one item required'));

    const result = await withTransaction(async (client) => {
      const dnNumber = d.debit_note_number?.trim() || await nextDebitNoteNumber(companyId, client);

      const partySnap = d.party_id
        ? await client.query(`SELECT name FROM parties WHERE id = $1 AND company_id = $2`, [d.party_id, companyId])
        : { rows: [] };

      const totalAmount = (d.items as any[]).reduce(
        (s: number, it: any) => s + Math.round(it.quantity * it.unit_price), 0,
      );

      const returnRes = await client.query(
        `INSERT INTO purchase_returns
           (company_id, party_id, purchase_invoice_id, godown_id, debit_note_number, return_date, reason,
            total_amount, party_name_snapshot, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          companyId, d.party_id || null, d.purchase_invoice_id || null, d.godown_id || null, dnNumber,
          d.return_date || new Date().toISOString().split('T')[0],
          d.reason || null, totalAmount,
          partySnap.rows[0]?.name || d.party_name || null,
          req.user!.id,
        ],
      );
      const returnId = returnRes.rows[0].id;

      // Goods are going back to the supplier — stock decreases. Resolve a
      // real godown (request > company default), same helper invoices use.
      const godownId = await resolveDefaultGodownId(client, companyId, d.godown_id, null);

      for (const it of d.items as any[]) {
        await client.query(
          `INSERT INTO purchase_return_items (return_id, item_id, item_name, hsn_code, unit, quantity, unit_price, gst_rate)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [returnId, it.item_id || null, it.item_name || it.name,
           it.hsn_code || null, it.unit || null, it.quantity, it.unit_price, it.gst_rate || 0],
        );

        if (it.item_id && godownId) {
          const trackRes = await client.query(`SELECT name, track_inventory FROM items WHERE id = $1 AND company_id = $2`, [it.item_id, companyId]);
          if (trackRes.rows[0]?.track_inventory) {
            const stockRes = await client.query(
              `SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2 AND company_id = $3 FOR UPDATE`,
              [it.item_id, godownId, companyId],
            );
            const currentQty = stockRes.rows.length ? Number(stockRes.rows[0].quantity) : 0;
            if (currentQty < Number(it.quantity)) {
              throw new Error(`Insufficient stock for "${trackRes.rows[0].name}" to return — available: ${currentQty}, returning: ${it.quantity}`);
            }
            // Atomic conditional decrement — same race-safe pattern used by
            // the barcode-scan stock deduction endpoint.
            const deduct = await client.query(
              `UPDATE item_stock SET quantity = quantity - $1, updated_at = now()
               WHERE company_id = $2 AND item_id = $3 AND godown_id = $4 AND quantity >= $1`,
              [it.quantity, companyId, it.item_id, godownId],
            );
            if (deduct.rowCount !== 1) {
              throw new Error(`Failed to deduct stock for "${trackRes.rows[0].name}" (concurrent change?) — please retry`);
            }
            const balRes = await client.query(`SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2 AND company_id = $3`, [it.item_id, godownId, companyId]);
            await client.query(
              `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, notes, created_by)
               VALUES ($1,$2,$3,'purchase_return_out','purchase_return',$4,$5,$6,$7,$8)`,
              [companyId, it.item_id, godownId, returnId, -Number(it.quantity), balRes.rows[0]?.quantity ?? 0, `Debit note ${dnNumber}`, req.user!.id],
            );
          }
        }
      }

      // Increase party balance — reduces what we owe the supplier (mirrors
      // the same direction as recording an outgoing payment).
      if (d.party_id) {
        await client.query(
          `UPDATE parties SET balance = balance + $1 WHERE id = $2 AND company_id = $3`,
          [totalAmount, d.party_id, companyId],
        );
        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration)
           SELECT $1, $2, 'debit', $3, balance, 'debit_note', $4, 'Purchase return / debit note'
           FROM parties WHERE id = $2 AND company_id = $1`,
          [companyId, d.party_id, totalAmount, returnId],
        );
      }

      // If linked to a purchase bill, reduce that bill's recorded paid
      // amount isn't right (a return isn't a payment) — instead we leave
      // the bill's own total/paid untouched; the supplier balance entry
      // above is what actually reflects the reduced amount owed. The link
      // is kept purely for traceability ("Reference Bill" column).

      await postPurchaseReturnAccounting(client, companyId, returnRes.rows[0], req.user!.id);

      return returnRes.rows[0];
    });

    res.status(201).json(success(result));
  } catch (err: any) {
    const msg = err?.message || 'Failed to create debit note';
    res.status(/required|insufficient|failed to deduct/i.test(msg) ? 400 : 500).json(error(msg));
  }
}

// ── POST /api/purchases/returns/:id/refund ────────────────────────
// Records cash/bank refund actually received from the supplier against
// this debit note (separate from the party-balance credit, which already
// happened at creation time).
export async function recordPurchaseReturnRefund(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { id } = req.params;
    const amount = Math.round(Number(req.body.amount) || 0);
    if (amount <= 0) return res.status(400).json(error('Refund amount must be positive'));

    const result = await withTransaction(async (client) => {
      const retRes = await client.query(
        `SELECT * FROM purchase_returns WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE`,
        [id, companyId],
      );
      if (!retRes.rows.length) throw new Error('Debit note not found');
      const ret = retRes.rows[0];
      const newRefund = Number(ret.refund_received || 0) + amount;
      if (newRefund > Number(ret.total_amount || 0)) {
        throw new Error(`Refund exceeds debit note value. Already received: ${ret.refund_received}, note total: ${ret.total_amount}`);
      }
      const updated = await client.query(
        `UPDATE purchase_returns SET refund_received = $1, updated_at = now() WHERE id = $2 RETURNING *`,
        [newRefund, id],
      );
      return updated.rows[0];
    });

    res.json(success(result));
  } catch (err: any) {
    const msg = err?.message || 'Failed to record refund';
    res.status(/not found|exceeds|positive/i.test(msg) ? 400 : 500).json(error(msg));
  }
}
