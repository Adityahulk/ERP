import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { logAction } from '../lib/auditLog';

// ── Helpers ───────────────────────────────────────────────────
async function generateChallanNumber(companyId: string, type: string): Promise<string> {
  const prefixRes = await query('SELECT job_work_prefix FROM companies WHERE id = $1', [companyId]);
  const prefix = prefixRes.rows[0]?.job_work_prefix || 'JW';
  const suffix = type === 'outward' ? 'OUT' : 'IN';
  const countRes = await query(
    `SELECT COUNT(*) as count FROM job_work_challans WHERE company_id = $1 AND challan_type = $2 AND created_at >= date_trunc('year', now())`,
    [companyId, type]
  );
  const yearStr = new Date().getFullYear().toString().slice(-2);
  return `${prefix}-${suffix}/${yearStr}/${String(parseInt(countRes.rows[0].count) + 1).padStart(4, '0')}`;
}

// ── POST /api/job-work/challans ───────────────────────────────
export async function createChallan(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id; const d = req.body;
    if (!d.party_id) return res.status(400).json(error('Job worker party is required'));
    if (!d.challan_type || !['outward', 'inward'].includes(d.challan_type)) return res.status(400).json(error('Challan type must be outward or inward'));
    if (!Array.isArray(d.items) || !d.items.length) return res.status(400).json(error('Items are required'));

    const result = await withTransaction(async (client) => {
      const challanNumber = await generateChallanNumber(companyId, d.challan_type);

      const pRes = await client.query('SELECT name, gstin FROM parties WHERE id = $1', [d.party_id]);
      if (!pRes.rows.length) throw new Error('Party not found');

      // GST Section 143: auto-calculate return due date
      const isCapitalGoods = d.is_capital_goods || false;
      const challanDate = new Date(d.challan_date || Date.now());
      const returnDueDateObj = new Date(challanDate);
      returnDueDateObj.setFullYear(returnDueDateObj.getFullYear() + (isCapitalGoods ? 3 : 1));
      const returnDueDate = d.challan_type === 'outward' ? returnDueDateObj.toISOString().split('T')[0] : null;

      // Calculate total material value
      let totalMaterialValue = 0;
      for (const item of d.items) {
        const qty = d.challan_type === 'outward' ? Number(item.quantity_sent || item.quantity) : Number(item.quantity_received || item.quantity);
        totalMaterialValue += Math.round((Number(item.unit_price) || 0) * qty);
      }

      const totalCharges = Math.round(Number(d.labour_charges) || 0) + Math.round(Number(d.other_charges) || 0);
      const gstOnCharges = Math.round(Number(d.gst_on_charges) || 0);

      const challanRes = await client.query(
        `INSERT INTO job_work_challans (
          company_id, challan_number, challan_type, challan_date, party_id,
          party_name_snapshot, party_gstin_snapshot, godown_id, related_challan_id,
          return_due_date, is_capital_goods, labour_charges, other_charges, gst_on_charges,
          total_charges, total_material_value, status, transport_details, vehicle_number,
          eway_bill_number, notes, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'draft',$17,$18,$19,$20,$21) RETURNING *`,
        [
          companyId, challanNumber, d.challan_type,
          d.challan_date || new Date().toISOString().split('T')[0],
          d.party_id, pRes.rows[0].name, pRes.rows[0].gstin || null,
          d.godown_id || null, d.related_challan_id || null,
          returnDueDate, isCapitalGoods,
          Math.round(Number(d.labour_charges) || 0), Math.round(Number(d.other_charges) || 0),
          gstOnCharges, totalCharges + gstOnCharges, totalMaterialValue,
          d.transport_details || null, d.vehicle_number || null,
          d.eway_bill_number || null, d.notes || null, req.user!.id
        ]
      );
      const challan = challanRes.rows[0];

      for (let i = 0; i < d.items.length; i++) {
        const item = d.items[i];
        const iRes = await client.query('SELECT name, hsn_code FROM items WHERE id = $1', [item.item_id]);
        await client.query(
          `INSERT INTO job_work_challan_items (
            challan_id, item_id, item_name, hsn_code, unit, quantity_sent, quantity_received,
            quantity_rejected, wastage, unit_price, total_value, notes, sort_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            challan.id, item.item_id,
            item.item_name || iRes.rows[0]?.name || 'Material',
            item.hsn_code || iRes.rows[0]?.hsn_code || null,
            item.unit || 'PCS',
            d.challan_type === 'outward' ? (item.quantity_sent || item.quantity || 0) : 0,
            d.challan_type === 'inward' ? (item.quantity_received || item.quantity || 0) : 0,
            item.quantity_rejected || 0, item.wastage || 0,
            item.unit_price || 0,
            Math.round((item.unit_price || 0) * (d.challan_type === 'outward' ? (item.quantity_sent || item.quantity || 0) : (item.quantity_received || item.quantity || 0))),
            item.notes || null, i + 1
          ]
        );
      }
      return challan;
    });

    await logAction(req.user!.id, companyId, 'create', 'job_work_challan', result.id);
    res.status(201).json(success(result));
  } catch (err: any) { res.status(/not found/i.test(err?.message) ? 404 : 400).json(error(err.message)); }
}

// ── GET /api/job-work/challans ────────────────────────────────
export async function listChallans(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { challan_type, status, search, party_id } = req.query;

    let where = 'jw.company_id = $1 AND jw.is_deleted = false';
    const params: any[] = [companyId]; let idx = 2;
    if (challan_type) { where += ` AND jw.challan_type = $${idx}`; params.push(challan_type); idx++; }
    if (status) { where += ` AND jw.status = $${idx}`; params.push(status); idx++; }
    if (party_id) { where += ` AND jw.party_id = $${idx}`; params.push(party_id); idx++; }
    if (search) { where += ` AND (jw.challan_number ILIKE $${idx} OR jw.party_name_snapshot ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    const countRes = await query(`SELECT COUNT(*) FROM job_work_challans jw WHERE ${where}`, params);
    const result = await query(
      `SELECT jw.*, p.name as party_name,
              (SELECT COUNT(*)::int FROM job_work_challan_items WHERE challan_id = jw.id) as item_count
       FROM job_work_challans jw LEFT JOIN parties p ON jw.party_id = p.id
       WHERE ${where} ORDER BY jw.challan_date DESC, jw.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    // Stats
    const statsRes = await query(
      `SELECT
        COUNT(*) FILTER (WHERE challan_type = 'outward' AND status = 'sent') as active_outward,
        COUNT(*) FILTER (WHERE challan_type = 'outward' AND return_due_date < CURRENT_DATE AND is_returned = false AND status NOT IN ('cancelled','returned')) as overdue_count,
        COUNT(*) FILTER (WHERE challan_type = 'inward') as total_inward,
        COALESCE(SUM(total_material_value) FILTER (WHERE challan_type = 'outward' AND status = 'sent'), 0) as materials_out_value
       FROM job_work_challans WHERE company_id = $1 AND is_deleted = false`, [companyId]
    );
    res.json(success(buildPaginatedResponse(result.rows, parseInt(countRes.rows[0].count), page, limit), statsRes.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/job-work/challans/:id ────────────────────────────
export async function getChallan(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const challanRes = await query(
      `SELECT jw.*, p.name as party_name, p.phone as party_phone, g.name as godown_name,
              rc.challan_number as related_challan_number
       FROM job_work_challans jw LEFT JOIN parties p ON jw.party_id = p.id
       LEFT JOIN godowns g ON jw.godown_id = g.id LEFT JOIN job_work_challans rc ON jw.related_challan_id = rc.id
       WHERE jw.id = $1 AND jw.company_id = $2 AND jw.is_deleted = false`, [req.params.id, companyId]
    );
    if (!challanRes.rows.length) return res.status(404).json(error('Challan not found'));
    const itemsRes = await query('SELECT * FROM job_work_challan_items WHERE challan_id = $1 ORDER BY sort_order', [req.params.id]);
    res.json(success({ ...challanRes.rows[0], items: itemsRes.rows }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/job-work/challans/:id/send ──────────────────────
export async function sendChallan(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const result = await withTransaction(async (client) => {
      const challanRes = await client.query(
        "SELECT * FROM job_work_challans WHERE id = $1 AND company_id = $2 AND challan_type = 'outward' AND status = 'draft' FOR UPDATE",
        [req.params.id, companyId]
      );
      if (!challanRes.rows.length) throw new Error('Outward challan not found or not in draft status');
      const challan = challanRes.rows[0];
      const godownId = challan.godown_id;

      // Reduce stock for materials being sent out
      if (godownId) {
        const itemsRes = await client.query('SELECT * FROM job_work_challan_items WHERE challan_id = $1', [challan.id]);
        for (const item of itemsRes.rows) {
          if (!item.item_id || !item.quantity_sent) continue;
          const stockRes = await client.query(
            'SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2 AND company_id = $3 FOR UPDATE',
            [item.item_id, godownId, companyId]
          );
          const available = stockRes.rows[0]?.quantity || 0;
          if (available < item.quantity_sent) throw new Error(`Insufficient stock for "${item.item_name}": available ${available}, need ${item.quantity_sent}`);
          await client.query('UPDATE item_stock SET quantity = quantity - $1 WHERE item_id = $2 AND godown_id = $3 AND company_id = $4',
            [item.quantity_sent, item.item_id, godownId, companyId]);
          const balRes = await client.query('SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2', [item.item_id, godownId]);
          await client.query(
            `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, notes, created_by)
             VALUES ($1,$2,$3,'job_work_out','job_work_challan',$4,$5,$6,$7,$8)`,
            [companyId, item.item_id, godownId, challan.id, -Number(item.quantity_sent), balRes.rows[0]?.quantity || 0,
             `Sent for job work via ${challan.challan_number}`, req.user!.id]
          );
        }
      }

      await client.query("UPDATE job_work_challans SET status = 'sent' WHERE id = $1", [challan.id]);
      return { message: 'Challan sent — materials deducted from stock' };
    });
    res.json(success(result));
  } catch (err: any) { res.status(400).json(error(err.message)); }
}

// ── POST /api/job-work/challans/:id/receive ───────────────────
export async function receiveChallan(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id; const d = req.body;
    if (!Array.isArray(d.items) || !d.items.length) return res.status(400).json(error('Items with received quantities are required'));

    const result = await withTransaction(async (client) => {
      const challanRes = await client.query(
        "SELECT * FROM job_work_challans WHERE id = $1 AND company_id = $2 AND challan_type = 'outward' AND status IN ('sent','partial_return') FOR UPDATE",
        [req.params.id, companyId]
      );
      if (!challanRes.rows.length) throw new Error('Outward challan not found or not in sent/partial status');
      const challan = challanRes.rows[0];
      const godownId = challan.godown_id;

      let fullyReturned = true;

      for (const recvItem of d.items) {
        const ciRes = await client.query('SELECT * FROM job_work_challan_items WHERE id = $1 AND challan_id = $2', [recvItem.challan_item_id, challan.id]);
        if (!ciRes.rows.length) throw new Error('Challan item not found');
        const ci = ciRes.rows[0];

        const newReceived = Number(ci.quantity_received) + Number(recvItem.quantity_received || 0);
        const newRejected = Number(ci.quantity_rejected) + Number(recvItem.quantity_rejected || 0);
        const newWastage = Number(ci.wastage) + Number(recvItem.wastage || 0);

        if (newReceived + newRejected + newWastage > Number(ci.quantity_sent)) {
          throw new Error(`Total received+rejected+wastage exceeds sent quantity for "${ci.item_name}"`);
        }
        if (newReceived + newRejected + newWastage < Number(ci.quantity_sent)) fullyReturned = false;

        await client.query(
          'UPDATE job_work_challan_items SET quantity_received = $1, quantity_rejected = $2, wastage = $3 WHERE id = $4',
          [newReceived, newRejected, newWastage, recvItem.challan_item_id]
        );

        // Add received quantity back to stock
        if (ci.item_id && godownId && recvItem.quantity_received > 0) {
          await client.query(
            `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price) VALUES ($1,$2,$3,$4,0)
             ON CONFLICT (item_id, godown_id) DO UPDATE SET quantity = item_stock.quantity + EXCLUDED.quantity`,
            [companyId, ci.item_id, godownId, recvItem.quantity_received]
          );
          const balRes = await client.query('SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2', [ci.item_id, godownId]);
          await client.query(
            `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, notes, created_by)
             VALUES ($1,$2,$3,'job_work_in','job_work_challan',$4,$5,$6,$7,$8)`,
            [companyId, ci.item_id, godownId, challan.id, Number(recvItem.quantity_received), balRes.rows[0]?.quantity || 0,
             `Received from job work via ${challan.challan_number}`, req.user!.id]
          );
        }
      }

      // Update charges if provided
      if (d.labour_charges !== undefined || d.other_charges !== undefined) {
        const lc = Math.round(Number(d.labour_charges) || challan.labour_charges || 0);
        const oc = Math.round(Number(d.other_charges) || challan.other_charges || 0);
        const gst = Math.round(Number(d.gst_on_charges) || challan.gst_on_charges || 0);
        await client.query(
          'UPDATE job_work_challans SET labour_charges = $1, other_charges = $2, gst_on_charges = $3, total_charges = $4 WHERE id = $5',
          [lc, oc, gst, lc + oc + gst, challan.id]
        );
      }

      const newStatus = fullyReturned ? 'returned' : 'partial_return';
      await client.query('UPDATE job_work_challans SET status = $1, is_returned = $2 WHERE id = $3',
        [newStatus, fullyReturned, challan.id]);
      return { message: fullyReturned ? 'All materials received back' : 'Partial return recorded', status: newStatus };
    });
    res.json(success(result));
  } catch (err: any) { res.status(400).json(error(err.message)); }
}

// ── POST /api/job-work/challans/:id/cancel ────────────────────
export async function cancelChallan(req: Request, res: Response) {
  try {
    const result = await query(
      "UPDATE job_work_challans SET status = 'cancelled' WHERE id = $1 AND company_id = $2 AND status = 'draft' RETURNING id",
      [req.params.id, req.user!.company_id]
    );
    if (!result.rows.length) return res.status(400).json(error('Only draft challans can be cancelled'));
    res.json(success({ message: 'Challan cancelled' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/job-work/overdue ─────────────────────────────────
export async function listOverdue(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const result = await query(
      `SELECT jw.*, p.name as party_name, p.phone as party_phone,
              (CURRENT_DATE - jw.return_due_date) as days_overdue
       FROM job_work_challans jw LEFT JOIN parties p ON jw.party_id = p.id
       WHERE jw.company_id = $1 AND jw.challan_type = 'outward' AND jw.is_deleted = false
         AND jw.is_returned = false AND jw.status NOT IN ('cancelled','returned')
         AND jw.return_due_date < CURRENT_DATE
       ORDER BY jw.return_due_date ASC`, [companyId]
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/job-work/register ────────────────────────────────
export async function jobWorkRegister(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { from_date, to_date } = req.query;
    let where = "jw.company_id = $1 AND jw.is_deleted = false AND jw.challan_type = 'outward'";
    const params: any[] = [companyId]; let idx = 2;
    if (from_date) { where += ` AND jw.challan_date >= $${idx}::date`; params.push(from_date); idx++; }
    if (to_date) { where += ` AND jw.challan_date <= $${idx}::date`; params.push(to_date); idx++; }

    const result = await query(
      `SELECT jw.challan_number, jw.challan_date, jw.status, jw.return_due_date, jw.is_returned,
              p.name as party_name, p.gstin as party_gstin,
              jw.total_material_value, jw.total_charges,
              (SELECT COUNT(*)::int FROM job_work_challan_items WHERE challan_id = jw.id) as item_count,
              CASE WHEN jw.return_due_date < CURRENT_DATE AND jw.is_returned = false AND jw.status NOT IN ('cancelled','returned')
                   THEN true ELSE false END as is_overdue
       FROM job_work_challans jw LEFT JOIN parties p ON jw.party_id = p.id
       WHERE ${where} ORDER BY jw.challan_date DESC`, params
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
