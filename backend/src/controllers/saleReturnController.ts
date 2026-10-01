import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { generateSalesDocumentPDF } from '../services/pdfService';
import { isMailerConfigured, sendMail } from '../services/mailer';
import { postPaymentAccounting, postSaleReturnAccounting, reverseAccountingForReference } from '../services/accountingService';
import { saleReturnTotal } from '../lib/saleReturnTotal';

async function nextCreditNoteNumber(companyId: string, client: any) {
  const yr = new Date().getFullYear().toString().slice(-2);
  const res = await client.query(
    `SELECT COUNT(*)::int AS cnt FROM sale_returns WHERE company_id = $1 AND is_deleted = false`,
    [companyId],
  );
  const seq = String((res.rows[0].cnt || 0) + 1).padStart(4, '0');
  return `CN/${yr}/${seq}`;
}

async function resolveReturnInvoice(client: any, companyId: string, invoiceId: unknown, requestedPartyId: unknown) {
  const id = String(invoiceId || '').trim();
  if (!id) return { invoiceId: null, partyId: requestedPartyId ? String(requestedPartyId) : null, partyName: null as string | null };
  const result = await client.query(
    `SELECT id, invoice_number, invoice_type, status, party_id, party_name_snapshot
     FROM invoices
     WHERE id = $1 AND company_id = $2 AND is_deleted = false
     FOR SHARE`,
    [id, companyId],
  );
  const invoice = result.rows[0];
  if (!invoice) throw Object.assign(new Error('The selected original sales invoice was not found in this company.'), { status: 400 });
  if (!['sale', 'tax_invoice'].includes(String(invoice.invoice_type || ''))) {
    throw Object.assign(new Error('Only a sales invoice can be linked to a sale return.'), { status: 400 });
  }
  if (invoice.status === 'cancelled') {
    throw Object.assign(new Error('A cancelled sales invoice cannot be linked to a new return.'), { status: 400 });
  }
  if (requestedPartyId && String(requestedPartyId) !== String(invoice.party_id || '')) {
    throw Object.assign(new Error('The return customer must match the customer on the original invoice.'), { status: 400 });
  }
  return {
    invoiceId: invoice.id as string,
    partyId: (invoice.party_id || null) as string | null,
    partyName: (invoice.party_name_snapshot || null) as string | null,
  };
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
      conditions.push(`(r.credit_note_number ILIKE $${idx} OR r.party_name_snapshot ILIKE $${idx} OR i.invoice_number ILIKE $${idx})`);
      values.push(`%${search}%`); idx++;
    }

    const where = conditions.join(' AND ');
    const rows = await query(
      `SELECT r.*, p.name AS party_name, p.phone AS party_phone, p.email AS party_email,
              i.invoice_number, rp.id AS refund_payment_id, rp.amount AS refunded_amount,
              COALESCE((
                SELECT json_agg(ri ORDER BY ri.created_at, ri.id)
                FROM sale_return_items ri
                WHERE ri.return_id = r.id
              ), '[]'::json) AS items
       FROM sale_returns r
       LEFT JOIN parties p ON p.id = r.party_id AND p.company_id = r.company_id
       LEFT JOIN invoices i ON i.id = r.invoice_id AND i.company_id = r.company_id
       LEFT JOIN payments rp ON rp.sale_return_id = r.id AND rp.company_id = r.company_id AND rp.is_deleted = false
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
      const linkedInvoice = await resolveReturnInvoice(client, companyId, d.invoice_id, d.party_id);

      const partySnap = linkedInvoice.partyId
        ? await client.query(`SELECT name FROM parties WHERE id = $1 AND company_id = $2`, [linkedInvoice.partyId, companyId])
        : { rows: [] };

      const totalAmount = saleReturnTotal(d.items as any[]);

      const returnRes = await client.query(
        `INSERT INTO sale_returns
           (company_id, party_id, invoice_id, credit_note_number, return_date, reason,
            total_amount, party_name_snapshot, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          companyId, linkedInvoice.partyId, linkedInvoice.invoiceId, cnNumber,
          d.return_date || new Date().toISOString().split('T')[0],
          d.reason || null, totalAmount,
          partySnap.rows[0]?.name || linkedInvoice.partyName || d.party_name || null,
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
      if (linkedInvoice.partyId) {
        await client.query(
          `UPDATE parties SET balance = balance - $1 WHERE id = $2`,
          [totalAmount, linkedInvoice.partyId],
        );
        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration)
           SELECT $1, $2, 'credit', $3, balance, 'credit_note', $4, 'Sale return / credit note'
           FROM parties WHERE id = $2`,
          [companyId, linkedInvoice.partyId, totalAmount, returnId],
        );
      }

      await postSaleReturnAccounting(client, companyId, returnRes.rows[0], req.user!.id);

      return returnRes.rows[0];
    });

    res.status(201).json(success(result));
  } catch (err: any) { res.status(err?.status || 500).json(error(err.message)); }
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
      const refundRes = await client.query(
        `SELECT id FROM payments WHERE company_id = $1 AND sale_return_id = $2 AND is_deleted = false LIMIT 1`,
        [companyId, id],
      );
      if (refundRes.rows.length) {
        throw Object.assign(new Error('Reverse the linked refund payment before editing this credit note.'), { status: 409 });
      }

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

      const linkedInvoice = await resolveReturnInvoice(client, companyId, d.invoice_id, d.party_id);

      const totalAmount = saleReturnTotal(d.items as any[]);

      const partySnap = linkedInvoice.partyId
        ? await client.query(`SELECT name FROM parties WHERE id = $1 AND company_id = $2`, [linkedInvoice.partyId, companyId])
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
          linkedInvoice.partyId,
          linkedInvoice.invoiceId,
          String(d.credit_note_number || old.credit_note_number).trim(),
          d.return_date || old.return_date,
          d.reason || null,
          totalAmount,
          partySnap.rows[0]?.name || linkedInvoice.partyName || d.party_name || null,
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

      if (linkedInvoice.partyId) {
        await client.query(
          `UPDATE parties SET balance = balance - $1 WHERE id = $2 AND company_id = $3`,
          [totalAmount, linkedInvoice.partyId, companyId],
        );
        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration)
           SELECT $1, $2, 'credit', $3, balance, 'credit_note', $4, 'Sale return / credit note updated'
           FROM parties WHERE id = $2 AND company_id = $1`,
          [companyId, linkedInvoice.partyId, totalAmount, id],
        );
      }

      await postSaleReturnAccounting(client, companyId, updated.rows[0], req.user!.id, true);

      return updated.rows[0];
    });

    res.json(success(result));
  } catch (err: any) {
    const msg = err?.message || 'Failed to update credit note';
    res.status(err?.status || (/not found|required/i.test(msg) ? 400 : 500)).json(error(msg));
  }
}

async function loadSaleReturnDocument(id: string, companyId: string) {
  const [returnRes, itemsRes, companyRes] = await Promise.all([
    query(
      `SELECT r.*, p.name AS party_name, p.phone AS party_phone, p.email AS party_email,
              p.gstin AS party_gstin, p.billing_address AS party_address, i.invoice_number,
              rp.id AS refund_payment_id, rp.amount AS refunded_amount
       FROM sale_returns r
       LEFT JOIN parties p ON p.id = r.party_id AND p.company_id = r.company_id
       LEFT JOIN invoices i ON i.id = r.invoice_id AND i.company_id = r.company_id
       LEFT JOIN payments rp ON rp.sale_return_id = r.id AND rp.company_id = r.company_id AND rp.is_deleted = false
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

export async function refundSaleReturn(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const mode = String(req.body?.payment_mode || 'cash').toLowerCase();
    const allowedModes = ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other'];
    if (!allowedModes.includes(mode)) return res.status(400).json(error('Select a valid refund payment mode'));
    const paymentDate = String(req.body?.payment_date || new Date().toISOString().split('T')[0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || Number.isNaN(Date.parse(paymentDate))) {
      return res.status(400).json(error('Enter a valid refund date'));
    }

    const result = await withTransaction(async (client) => {
      const returnRes = await client.query(
        `SELECT * FROM sale_returns
         WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE`,
        [req.params.id, companyId],
      );
      if (!returnRes.rows.length) throw Object.assign(new Error('Sale return not found'), { status: 404 });
      const saleReturn = returnRes.rows[0];
      if (saleReturn.status === 'cancelled') {
        throw Object.assign(new Error('A cancelled sale return cannot be refunded'), { status: 409 });
      }
      const amount = Number(saleReturn.total_amount);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw Object.assign(new Error('This sale return amount cannot be posted as a refund payment'), { status: 400 });
      }
      const existing = await client.query(
        `SELECT id FROM payments WHERE company_id = $1 AND sale_return_id = $2 AND is_deleted = false LIMIT 1`,
        [companyId, saleReturn.id],
      );
      if (existing.rows.length) {
        throw Object.assign(new Error('A refund payment is already linked to this sale return'), { status: 409 });
      }

      if (saleReturn.invoice_id) {
        const invoiceRes = await client.query(
          `SELECT paid_amount FROM invoices
           WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE`,
          [saleReturn.invoice_id, companyId],
        );
        if (!invoiceRes.rows.length) {
          throw Object.assign(new Error('The linked sales invoice is no longer available'), { status: 409 });
        }
        const previousRefunds = await client.query(
          `SELECT COALESCE(SUM(p.amount), 0) AS amount
           FROM payments p
           JOIN sale_returns r ON r.id = p.sale_return_id AND r.company_id = p.company_id
           WHERE r.invoice_id = $1 AND p.company_id = $2 AND p.is_deleted = false`,
          [saleReturn.invoice_id, companyId],
        );
        const refundable = Number(invoiceRes.rows[0].paid_amount || 0) - Number(previousRefunds.rows[0].amount || 0);
        if (refundable < amount) {
          throw Object.assign(
            new Error(`Only ₹${(Math.max(0, refundable) / 100).toFixed(2)} of received payment remains refundable on the original invoice. Record a payment or adjust the return before paying this refund.`),
            { status: 409 },
          );
        }
      } else if (saleReturn.party_id) {
        const partyRes = await client.query(
          `SELECT balance FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE`,
          [saleReturn.party_id, companyId],
        );
        if (!partyRes.rows.length || Number(partyRes.rows[0].balance || 0) > -amount) {
          throw Object.assign(new Error('The customer does not have enough credit balance for a full refund. Link the original paid invoice or settle the credit first.'), { status: 409 });
        }
      } else {
        throw Object.assign(new Error('Link the original paid invoice or select a customer party before paying a refund.'), { status: 409 });
      }

      // Older credit notes predate sale-return accounting. Post the missing
      // journal once before paying out, so the refund clears the receivable.
      await postSaleReturnAccounting(client, companyId, saleReturn, req.user!.id);

      const paymentRes = await client.query(
        `INSERT INTO payments
           (company_id, payment_type, payment_number, payment_date, party_id,
            amount, payment_mode, reference_number, notes, sale_return_id, created_by)
         VALUES ($1,'outgoing',$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          companyId,
          `PAY-REF-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          paymentDate,
          saleReturn.party_id || null,
          amount,
          mode,
          saleReturn.credit_note_number,
          `Sales return refund ${saleReturn.credit_note_number}`,
          saleReturn.id,
          req.user!.id,
        ],
      );
      const payment = paymentRes.rows[0];
      if (saleReturn.party_id) {
        const party = await client.query(
          `UPDATE parties SET balance = balance + $1
           WHERE id = $2 AND company_id = $3 AND is_deleted = false
           RETURNING balance`,
          [amount, saleReturn.party_id, companyId],
        );
        if (!party.rows.length) throw Object.assign(new Error('Customer party was not found'), { status: 409 });
        await client.query(
          `INSERT INTO party_ledger
             (company_id, party_id, type, amount, balance_after, reference_type,
              reference_id, narration, created_by)
           VALUES ($1,$2,'debit',$3,$4,'payment',$5,$6,$7)`,
          [companyId, saleReturn.party_id, amount, party.rows[0].balance, payment.id,
            `Refund for credit note ${saleReturn.credit_note_number}`, req.user!.id],
        );
      }
      await postPaymentAccounting(client, companyId, payment, req.user!.id);
      return { payment, sale_return_id: saleReturn.id, credit_note_number: saleReturn.credit_note_number };
    });

    res.status(201).json(success(result));
  } catch (err: any) {
    res.status(err?.status || 500).json(error(err?.message || 'Failed to pay sale return refund'));
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
    const refundRes = await client.query(
      `SELECT id FROM payments WHERE company_id = $1 AND sale_return_id = $2 AND is_deleted = false LIMIT 1`,
      [companyId, id],
    );
    if (refundRes.rows.length) {
      throw Object.assign(new Error('Reverse the linked refund payment before cancelling this credit note.'), { status: 409 });
    }
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
    if (row.status !== 'cancelled') {
      await reverseAccountingForReference(client, companyId, 'sale_return', id);
    }
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
    const current = await query(
      `SELECT status FROM sale_returns WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [req.params.id, req.user!.company_id],
    );
    if (!current.rows.length) return res.status(404).json(error('Credit note not found'));
    if (current.rows[0].status !== 'draft') {
      return res.status(400).json(error('Only draft credit notes can be deleted. Cancel an active credit note instead.'));
    }
    const row = await deactivateSaleReturn(req.params.id, req.user!.company_id, true);
    res.json(success({ id: row.id }));
  } catch (err: any) {
    res.status(err?.status || 500).json(error(err?.message || 'Failed to delete credit note'));
  }
}
