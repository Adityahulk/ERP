import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { logAction } from '../lib/auditLog';

// ── POST /api/invoices ────────────────────────────────────────
export async function createInvoice(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body;

    const result = await withTransaction(async (client) => {
      // Auto-generate invoice number
      const prefix = d.invoice_type === 'purchase' ? 'PUR-' : 'INV-';
      const numRes = await client.query(
        `SELECT COUNT(*) + 1 as num FROM invoices WHERE company_id = $1 AND invoice_type = $2`, [companyId, d.invoice_type || 'sale']
      );
      const invoiceNumber = d.invoice_number || `${prefix}${String(numRes.rows[0].num).padStart(5, '0')}`;

      // Calculate totals from items
      let subtotal = 0;
      let totalTax = 0;
      let totalCgst = 0;
      let totalSgst = 0;
      let totalIgst = 0;
      let totalCess = 0;

      for (const item of d.items) {
        const lineTotal = item.quantity * item.unit_price;
        const discount = item.discount_amount || (lineTotal * (item.discount_percent || 0) / 100);
        const taxable = lineTotal - discount;
        const gstAmount = Math.round(taxable * (item.gst_rate || 0) / 100);

        subtotal += taxable;
        totalTax += gstAmount;

        if (d.is_interstate) {
          totalIgst += gstAmount;
        } else {
          totalCgst += Math.round(gstAmount / 2);
          totalSgst += Math.round(gstAmount / 2);
        }
        totalCess += Math.round(taxable * (item.cess_rate || 0) / 100);
      }

      const roundOff = d.round_off || 0;
      const totalAmount = subtotal + totalTax + totalCess + roundOff;
      const balanceDue = totalAmount - (d.amount_paid || 0);

      // Determine status
      let status = 'unpaid';
      if (d.amount_paid && d.amount_paid >= totalAmount) status = 'paid';
      else if (d.amount_paid && d.amount_paid > 0) status = 'partial';

      // Create invoice
      const invRes = await client.query(
        `INSERT INTO invoices (
          company_id, invoice_number, invoice_type, party_id, godown_id,
          invoice_date, due_date, is_interstate,
          subtotal, total_cgst, total_sgst, total_igst, total_cess,
          discount_amount, round_off, total_amount, amount_paid, balance_due,
          status, notes, terms_and_conditions, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
        [
          companyId, invoiceNumber, d.invoice_type || 'sale',
          d.party_id, d.godown_id || req.user!.godown_id,
          d.invoice_date || new Date().toISOString().split('T')[0],
          d.due_date, d.is_interstate || false,
          subtotal, totalCgst, totalSgst, totalIgst, totalCess,
          d.discount_amount || 0, roundOff, totalAmount, d.amount_paid || 0, balanceDue,
          status, d.notes, d.terms_and_conditions, req.user!.id,
        ]
      );

      const invoice = invRes.rows[0];

      // Insert line items + stock movements for sales
      for (let i = 0; i < d.items.length; i++) {
        const item = d.items[i];
        const lineTotal = item.quantity * item.unit_price;
        const discount = item.discount_amount || (lineTotal * (item.discount_percent || 0) / 100);
        const taxable = lineTotal - discount;
        const gstAmount = Math.round(taxable * (item.gst_rate || 0) / 100);

        await client.query(
          `INSERT INTO invoice_items (
            invoice_id, item_id, description, hsn_code, quantity, unit_price,
            discount_percent, discount_amount, taxable_amount,
            gst_rate, cgst_amount, sgst_amount, igst_amount, cess_rate, cess_amount,
            total_amount, sort_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            invoice.id, item.item_id, item.description, item.hsn_code,
            item.quantity, item.unit_price,
            item.discount_percent || 0, discount, taxable,
            item.gst_rate || 0,
            d.is_interstate ? 0 : Math.round(gstAmount / 2),
            d.is_interstate ? 0 : Math.round(gstAmount / 2),
            d.is_interstate ? gstAmount : 0,
            item.cess_rate || 0,
            Math.round(taxable * (item.cess_rate || 0) / 100),
            taxable + gstAmount + Math.round(taxable * (item.cess_rate || 0) / 100),
            i + 1,
          ]
        );

        // Stock deduction for sale invoices
        if ((d.invoice_type || 'sale') === 'sale' && item.item_id) {
          const godownId = d.godown_id || req.user!.godown_id;
          if (godownId) {
            // Deduct stock
            await client.query(
              `UPDATE item_stock SET quantity = quantity - $1 WHERE item_id = $2 AND godown_id = $3`,
              [item.quantity, item.item_id, godownId]
            );

            // Stock movement
            const balRes = await client.query(
              'SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2', [item.item_id, godownId]
            );
            await client.query(
              `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, unit_cost, balance_after, created_by)
               VALUES ($1, $2, $3, 'sale', 'invoice', $4, $5, $6, $7, $8)`,
              [companyId, item.item_id, godownId, invoice.id, -item.quantity, item.unit_price, balRes.rows[0]?.quantity || 0, req.user!.id]
            );
          }
        }

        // Stock addition for purchase invoices
        if (d.invoice_type === 'purchase' && item.item_id) {
          const godownId = d.godown_id || req.user!.godown_id;
          if (godownId) {
            await client.query(
              `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (item_id, godown_id) DO UPDATE SET
                 quantity = item_stock.quantity + $4,
                 avg_cost_price = CASE 
                   WHEN item_stock.quantity + $4 > 0 
                   THEN ((item_stock.quantity * item_stock.avg_cost_price) + ($4 * $5)) / (item_stock.quantity + $4)
                   ELSE $5 END`,
              [companyId, item.item_id, godownId, item.quantity, item.unit_price]
            );

            const balRes = await client.query(
              'SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2', [item.item_id, godownId]
            );
            await client.query(
              `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, unit_cost, balance_after, created_by)
               VALUES ($1, $2, $3, 'purchase', 'invoice', $4, $5, $6, $7, $8)`,
              [companyId, item.item_id, godownId, invoice.id, item.quantity, item.unit_price, balRes.rows[0]?.quantity || 0, req.user!.id]
            );
          }
        }
      }

      // Update party balance (debit for sale, credit for purchase)
      if (d.party_id) {
        const balanceChange = d.invoice_type === 'purchase' ? -totalAmount : totalAmount;
        await client.query(
          'UPDATE parties SET balance = balance + $1 WHERE id = $2', [balanceChange, d.party_id]
        );

        // Create ledger entry
        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
           VALUES ($1, $2, $3, $4, (SELECT balance FROM parties WHERE id = $2), 'invoice', $5, $6, $7)`,
          [
            companyId, d.party_id,
            d.invoice_type === 'purchase' ? 'credit' : 'debit',
            totalAmount, invoice.id,
            `${invoiceNumber} - ${d.invoice_type === 'purchase' ? 'Purchase' : 'Sale'}`,
            req.user!.id,
          ]
        );

        // If amount_paid > 0, also create payment entry
        if (d.amount_paid && d.amount_paid > 0) {
          const paidChange = d.invoice_type === 'purchase' ? d.amount_paid : -d.amount_paid;
          await client.query(
            'UPDATE parties SET balance = balance + $1 WHERE id = $2', [paidChange, d.party_id]
          );

          await client.query(
            `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
             VALUES ($1, $2, $3, $4, (SELECT balance FROM parties WHERE id = $2), 'payment', $5, $6, $7)`,
            [
              companyId, d.party_id,
              d.invoice_type === 'purchase' ? 'debit' : 'credit',
              d.amount_paid, invoice.id,
              `Payment against ${invoiceNumber}`,
              req.user!.id,
            ]
          );
        }
      }

      return invoice;
    });

    await logAction(req.user!.id, companyId, 'create', 'invoice', result.id, null, { number: result.invoice_number, type: d.invoice_type }, req.ip);
    res.status(201).json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/invoices ─────────────────────────────────────────
export async function listInvoices(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { search, invoice_type, status, party_id, from_date, to_date, overdue } = req.query;

    let where = 'i.company_id = $1 AND i.is_deleted = false';
    const params: any[] = [companyId];
    let idx = 2;

    if (search) { where += ` AND (i.invoice_number ILIKE $${idx} OR p.name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (invoice_type) { where += ` AND i.invoice_type = $${idx}`; params.push(invoice_type); idx++; }
    if (status) { where += ` AND i.status = $${idx}`; params.push(status); idx++; }
    if (party_id) { where += ` AND i.party_id = $${idx}`; params.push(party_id); idx++; }
    if (from_date) { where += ` AND i.invoice_date >= $${idx}`; params.push(from_date); idx++; }
    if (to_date) { where += ` AND i.invoice_date <= $${idx}`; params.push(to_date); idx++; }
    if (overdue === 'true') { where += ` AND i.due_date < CURRENT_DATE AND i.balance_due > 0 AND i.status != 'paid' AND i.status != 'cancelled'`; }

    const countRes = await query(`SELECT COUNT(*) FROM invoices i LEFT JOIN parties p ON i.party_id = p.id WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await query(
      `SELECT i.*, p.name as party_name, p.phone as party_phone, p.gstin as party_gstin,
              u.name as created_by_name
       FROM invoices i
       LEFT JOIN parties p ON i.party_id = p.id
       LEFT JOIN users u ON i.created_by = u.id
       WHERE ${where}
       ORDER BY i.invoice_date DESC, i.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    // Summary stats
    const statsRes = await query(
      `SELECT 
         COUNT(*) FILTER (WHERE status = 'unpaid' AND invoice_type = 'sale') as unpaid_count,
         COALESCE(SUM(balance_due) FILTER (WHERE status != 'paid' AND status != 'cancelled' AND invoice_type = 'sale'), 0) as total_receivable,
         COALESCE(SUM(total_amount) FILTER (WHERE invoice_type = 'sale' AND status != 'cancelled'), 0) as total_sales,
         COALESCE(SUM(total_amount) FILTER (WHERE invoice_type = 'purchase' AND status != 'cancelled'), 0) as total_purchases,
         COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND balance_due > 0 AND status != 'paid' AND status != 'cancelled') as overdue_count
       FROM invoices WHERE company_id = $1 AND is_deleted = false`,
      [companyId]
    );

    res.json(success(buildPaginatedResponse(result.rows, total, page, limit), statsRes.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/invoices/:id ─────────────────────────────────────
export async function getInvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const invRes = await query(
      `SELECT i.*, p.name as party_name, p.phone as party_phone, p.email as party_email,
              p.gstin as party_gstin, p.billing_address as party_billing_address,
              p.shipping_address as party_shipping_address,
              p.city as party_city, p.state as party_state, p.pincode as party_pincode,
              p.state_code as party_state_code,
              c.name as company_name, c.legal_name as company_legal_name, c.gstin as company_gstin,
              c.registered_address as company_address, c.city as company_city, c.state as company_state,
              c.pincode as company_pincode, c.state_code as company_state_code,
              c.phone as company_phone, c.email as company_email, c.logo_url as company_logo,
              c.signature_url as company_signature,
              c.bank_name, c.bank_account_number, c.bank_ifsc, c.bank_branch, c.upi_id,
              u.name as created_by_name
       FROM invoices i
       LEFT JOIN parties p ON i.party_id = p.id
       LEFT JOIN companies c ON i.company_id = c.id
       LEFT JOIN users u ON i.created_by = u.id
       WHERE i.id = $1 AND i.company_id = $2 AND i.is_deleted = false`,
      [id, companyId]
    );
    if (!invRes.rows.length) return res.status(404).json(error('Invoice not found'));

    // Line items
    const itemsRes = await query(
      `SELECT ii.*, it.name as item_name, it.sku as item_sku, iu.abbreviation as unit_abbr
       FROM invoice_items ii
       LEFT JOIN items it ON ii.item_id = it.id
       LEFT JOIN item_units iu ON it.unit_id = iu.id
       WHERE ii.invoice_id = $1
       ORDER BY ii.sort_order`,
      [id]
    );

    // Payment history
    const payRes = await query(
      `SELECT id, payment_number, payment_date, amount, payment_mode, status, notes
       FROM payments WHERE invoice_id = $1 AND company_id = $2 AND is_deleted = false
       ORDER BY payment_date DESC`,
      [id, companyId]
    );

    res.json(success({
      ...invRes.rows[0],
      items: itemsRes.rows,
      payments: payRes.rows,
    }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── PATCH /api/invoices/:id/cancel ────────────────────────────
export async function cancelInvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const invRes = await query('SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false', [id, companyId]);
    if (!invRes.rows.length) return res.status(404).json(error('Invoice not found'));

    const invoice = invRes.rows[0];
    if (invoice.status === 'cancelled') return res.status(400).json(error('Invoice is already cancelled'));

    await withTransaction(async (client) => {
      // If there were payments, reject cancellation
      const paidAmount = invoice.amount_paid || 0;
      if (paidAmount > 0) {
        throw new Error('Cannot cancel invoice with recorded payments. Delete payments first.');
      }

      // Reverse stock movements
      const itemsRes = await client.query(
        'SELECT * FROM invoice_items WHERE invoice_id = $1', [id]
      );

      const godownId = invoice.godown_id;
      for (const item of itemsRes.rows) {
        if (item.item_id && godownId) {
          if (invoice.invoice_type === 'sale') {
            // Add stock back
            await client.query(
              'UPDATE item_stock SET quantity = quantity + $1 WHERE item_id = $2 AND godown_id = $3',
              [item.quantity, item.item_id, godownId]
            );
          } else {
            // Deduct stock back
            await client.query(
              'UPDATE item_stock SET quantity = quantity - $1 WHERE item_id = $2 AND godown_id = $3',
              [item.quantity, item.item_id, godownId]
            );
          }

          const balRes = await client.query(
            'SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2', [item.item_id, godownId]
          );
          await client.query(
            `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, notes, created_by)
             VALUES ($1, $2, $3, 'cancellation', 'invoice', $4, $5, $6, $7, $8)`,
            [companyId, item.item_id, godownId, id,
             invoice.invoice_type === 'sale' ? item.quantity : -item.quantity,
             balRes.rows[0]?.quantity || 0,
             `Cancelled invoice ${invoice.invoice_number}`,
             req.user!.id]
          );
        }
      }

      // Reverse party balance
      if (invoice.party_id) {
        const reverseAmount = invoice.invoice_type === 'purchase' ? invoice.total_amount : -invoice.total_amount;
        await client.query('UPDATE parties SET balance = balance + $1 WHERE id = $2', [reverseAmount, invoice.party_id]);

        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
           VALUES ($1, $2, $3, $4, (SELECT balance FROM parties WHERE id = $2), 'invoice', $5, $6, $7)`,
          [companyId, invoice.party_id,
           invoice.invoice_type === 'purchase' ? 'debit' : 'credit',
           invoice.total_amount, id,
           `Cancelled: ${invoice.invoice_number}`,
           req.user!.id]
        );
      }

      // Mark as cancelled
      await client.query(
        "UPDATE invoices SET status = 'cancelled', balance_due = 0 WHERE id = $1", [id]
      );
    });

    await logAction(req.user!.id, companyId, 'cancel', 'invoice', id, { status: invoice.status }, { status: 'cancelled' }, req.ip);
    res.json(success({ message: 'Invoice cancelled and stock reversed' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── DELETE /api/invoices/:id ──────────────────────────────────
export async function deleteInvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const invRes = await query('SELECT status FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false', [id, companyId]);
    if (!invRes.rows.length) return res.status(404).json(error('Invoice not found'));
    if (invRes.rows[0].status !== 'cancelled') {
      return res.status(400).json(error('Only cancelled invoices can be deleted. Cancel the invoice first.'));
    }

    await query('UPDATE invoices SET is_deleted = true WHERE id = $1', [id]);
    await logAction(req.user!.id, companyId, 'delete', 'invoice', id);
    res.json(success({ message: 'Invoice deleted' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
