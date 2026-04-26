import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';

function gstErrorResponse(res: Response, err: any) {
  if (err?.message === 'Invalid month/year') {
    return res.status(400).json(error('Invalid or missing month/year (use month 1–12 and a four-digit year).'));
  }
  return res.status(500).json(error(err.message));
}

function parsePeriod(month?: string | string[], year?: string | string[]) {
  if (!month || !year) return { from: '1970-01-01', to: '2100-01-01', fp: '' };
  const m = Number(Array.isArray(month) ? month[0] : month);
  const y = Number(Array.isArray(year) ? year[0] : year);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 2000 || y > 2100) {
    throw new Error('Invalid month/year');
  }
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const from = start.toISOString().slice(0, 10);
  const to = end.toISOString().slice(0, 10);
  return { from, to, fp: `${String(m).padStart(2, '0')}${y}` };
}

export async function getGSTSummary(req: Request, res: Response) {
  try {
     const { month, year } = req.query as any;
     const companyId = req.user!.company_id;
     const { from: df, to: dt } = parsePeriod(month, year);

     const outputRes = await query(
       `SELECT SUM(cgst_amount) as cgst, SUM(sgst_amount) as sgst, SUM(igst_amount) as igst
        FROM invoices
        WHERE company_id = $1
          AND invoice_type IN ('sale','tax_invoice')
          AND invoice_date >= $2 AND invoice_date < $3
          AND is_deleted = false AND status != 'cancelled'`,
        [companyId, df, dt]
     );

     const inputRes = await query(
       `SELECT SUM(cgst_amount) as cgst, SUM(sgst_amount) as sgst, SUM(igst_amount) as igst
        FROM purchase_invoices WHERE company_id = $1 AND bill_date >= $2 AND bill_date < $3 AND is_deleted = false AND status != 'cancelled'`,
        [companyId, df, dt]
     );

     const output = outputRes.rows[0];
     const input = inputRes.rows[0];
     res.json(success({
        output: { cgst: output.cgst || 0, sgst: output.sgst || 0, igst: output.igst || 0 },
        input: { cgst: input.cgst || 0, sgst: input.sgst || 0, igst: input.igst || 0 },
        liability: {
           cgst: (output.cgst || 0) - (input.cgst || 0),
           sgst: (output.sgst || 0) - (input.sgst || 0),
           igst: (output.igst || 0) - (input.igst || 0)
        }
     }));
  } catch (err: any) {
    gstErrorResponse(res, err);
  }
}

export async function getGSTR1(req: Request, res: Response) {
  try {
     const { month, year } = req.query as any;
     const companyId = req.user!.company_id;
     const { from: df, to: dt } = parsePeriod(month, year);

     // B2B: registered party, meaning gstin length >= 15
     const b2b = await query(
       `SELECT p.gstin, i.invoice_number, i.invoice_date, i.taxable_amount, i.cgst_amount, i.sgst_amount, i.igst_amount, i.total_amount
        FROM invoices i
        JOIN parties p ON i.party_id = p.id
        WHERE i.company_id = $1
          AND i.invoice_type IN ('sale','tax_invoice')
          AND i.invoice_date >= $2 AND i.invoice_date < $3
          AND i.is_deleted = false AND i.status != 'cancelled'
          AND length(COALESCE(p.gstin,'')) >= 15`,
       [companyId, df, dt]
     );

     // B2CS: Unregistered party (gstin null/short)
     const b2cs = await query(
       `SELECT i.invoice_number, i.invoice_date, i.taxable_amount, i.cgst_amount, i.sgst_amount, i.igst_amount, i.total_amount
        FROM invoices i
        LEFT JOIN parties p ON i.party_id = p.id
        WHERE i.company_id = $1
          AND i.invoice_type IN ('sale','tax_invoice')
          AND i.invoice_date >= $2 AND i.invoice_date < $3
          AND i.is_deleted = false AND i.status != 'cancelled'
          AND (p.gstin IS NULL OR length(p.gstin) < 15)`,
       [companyId, df, dt]
     );

     res.json(success({ b2b: b2b.rows, b2cs: b2cs.rows }));
  } catch (err: any) {
    gstErrorResponse(res, err);
  }
}

export async function exportGSTR1(req: Request, res: Response) {
   try {
     const { month, year } = req.query as any;
     const companyId = req.user!.company_id;
     const { from: df, to: dt, fp } = parsePeriod(month, year);
     const cRes = await query(`SELECT gstin FROM companies WHERE id = $1`, [companyId]);
     const gstr1 = await query(
      `SELECT i.invoice_number, i.invoice_date, i.taxable_amount, i.cgst_amount, i.sgst_amount, i.igst_amount, i.total_amount,
              COALESCE(p.gstin,'') as gstin
       FROM invoices i
       LEFT JOIN parties p ON p.id = i.party_id
       WHERE i.company_id = $1
         AND i.invoice_type IN ('sale','tax_invoice')
         AND i.invoice_date >= $2 AND i.invoice_date < $3
         AND i.is_deleted = false AND i.status != 'cancelled'
       ORDER BY i.invoice_date, i.invoice_number`,
      [companyId, df, dt]
     );
     const b2b = gstr1.rows.filter((r: any) => String(r.gstin).length >= 15);
     const b2cs = gstr1.rows.filter((r: any) => String(r.gstin).length < 15);
     const retPeriod = fp;
     res.json(success({
       meta: {
         schema: 'bizflow.gstr1.export',
         version: '1.0',
         generated_at: new Date().toISOString(),
         ret_period: retPeriod,
         disclaimer:
           'Ledger-derived B2B/B2CS-style rows for reconciliation. This is not NIC offline-tool JSON; your CA should map it to the GST portal format.',
       },
       gstin: cRes.rows[0]?.gstin || null,
       fp,
       ret_period: retPeriod,
       b2b,
       b2cs,
     }));
   } catch (err: any) {
     gstErrorResponse(res, err);
   }
}

export async function getGSTR2AReconciliation(req: Request, res: Response) {
  try {
    const { month, year } = req.query as any;
    const companyId = req.user!.company_id;
    const { from: df, to: dt } = parsePeriod(month, year);
    const rows = await query(
      `SELECT pi.id, pi.bill_number, pi.bill_date, pi.taxable_amount, pi.cgst_amount, pi.sgst_amount, pi.igst_amount, pi.total_amount,
              p.name AS supplier_name, p.gstin AS supplier_gstin
       FROM purchase_invoices pi
       LEFT JOIN parties p ON p.id = pi.party_id
       WHERE pi.company_id = $1
         AND pi.bill_date >= $2 AND pi.bill_date < $3
         AND pi.is_deleted = false AND pi.status != 'cancelled'
       ORDER BY pi.bill_date DESC`,
      [companyId, df, dt]
    );
    const withGstin = rows.rows.filter((r: any) => (r.supplier_gstin || '').length >= 15);
    const missingGstin = rows.rows.filter((r: any) => (r.supplier_gstin || '').length < 15);
    res.json(success({
      total_bills: rows.rows.length,
      matched_candidates: withGstin.length,
      missing_supplier_gstin: missingGstin.length,
      missing_rows: missingGstin,
    }));
  } catch (err: any) {
    gstErrorResponse(res, err);
  }
}

export async function getGSTR3B(req: Request, res: Response) {
  try {
     const { month, year } = req.query as any;
     const companyId = req.user!.company_id;
     const { from: df, to: dt, fp } = parsePeriod(month, year);
     const outward = await query(
      `SELECT
          COALESCE(SUM(taxable_amount),0) AS taxable,
          COALESCE(SUM(cgst_amount),0) AS cgst,
          COALESCE(SUM(sgst_amount),0) AS sgst,
          COALESCE(SUM(igst_amount),0) AS igst
       FROM invoices
       WHERE company_id = $1
         AND invoice_type IN ('sale','tax_invoice')
         AND invoice_date >= $2 AND invoice_date < $3
         AND is_deleted = false AND status != 'cancelled'`,
      [companyId, df, dt]
     );
     const inwardPi = await query(
      `SELECT
          COALESCE(SUM(taxable_amount),0) AS taxable,
          COALESCE(SUM(cgst_amount),0) AS cgst,
          COALESCE(SUM(sgst_amount),0) AS sgst,
          COALESCE(SUM(igst_amount),0) AS igst
       FROM purchase_invoices
       WHERE company_id = $1
         AND bill_date >= $2 AND bill_date < $3
         AND is_deleted = false AND COALESCE(status, '') != 'cancelled'`,
      [companyId, df, dt]
     );
     const inwardExp = await query(
      `SELECT
          COALESCE(SUM(amount),0) AS taxable,
          COALESCE(SUM(cgst_amount),0) AS cgst,
          COALESCE(SUM(sgst_amount),0) AS sgst,
          COALESCE(SUM(igst_amount),0) AS igst
       FROM expenses
       WHERE company_id = $1
         AND expense_date >= $2 AND expense_date < $3
         AND is_deleted = false AND COALESCE(gst_rate, 0) > 0`,
      [companyId, df, dt]
     );
     const o = outward.rows[0];
     const pi = inwardPi.rows[0];
     const ex = inwardExp.rows[0];
     const itcCgst = Number(pi.cgst || 0) + Number(ex.cgst || 0);
     const itcSgst = Number(pi.sgst || 0) + Number(ex.sgst || 0);
     const itcIgst = Number(pi.igst || 0) + Number(ex.igst || 0);
     const itcTaxable = Number(pi.taxable || 0) + Number(ex.taxable || 0);
     res.json(success({
      fp,
      outward_taxable: Number(o.taxable || 0),
      outward_tax: {
        cgst: Number(o.cgst || 0),
        sgst: Number(o.sgst || 0),
        igst: Number(o.igst || 0),
      },
      itc_available: {
        taxable: itcTaxable,
        from_purchase_bills: { cgst: Number(pi.cgst || 0), sgst: Number(pi.sgst || 0), igst: Number(pi.igst || 0) },
        from_expenses: { cgst: Number(ex.cgst || 0), sgst: Number(ex.sgst || 0), igst: Number(ex.igst || 0) },
        cgst: itcCgst,
        sgst: itcSgst,
        igst: itcIgst,
      },
      net_liability: {
        cgst: Number(o.cgst || 0) - itcCgst,
        sgst: Number(o.sgst || 0) - itcSgst,
        igst: Number(o.igst || 0) - itcIgst,
      },
     }));
  } catch (err: any) {
    gstErrorResponse(res, err);
  }
}

export async function exportGSTR3B(req: Request, res: Response) {
  try {
    const { month, year } = req.query as any;
    const companyId = req.user!.company_id;
    const { from: df, to: dt, fp } = parsePeriod(month, year);
    const cRes = await query(`SELECT gstin FROM companies WHERE id = $1`, [companyId]);
    const out = await query(
      `SELECT COALESCE(SUM(taxable_amount),0) AS taxable, COALESCE(SUM(cgst_amount),0) AS cgst, COALESCE(SUM(sgst_amount),0) AS sgst, COALESCE(SUM(igst_amount),0) AS igst
       FROM invoices
       WHERE company_id = $1 AND invoice_type IN ('sale','tax_invoice') AND invoice_date >= $2 AND invoice_date < $3 AND is_deleted = false AND status != 'cancelled'`,
      [companyId, df, dt]
    );
    const itc = await query(
      `SELECT COALESCE(SUM(cgst_amount),0) AS cgst, COALESCE(SUM(sgst_amount),0) AS sgst, COALESCE(SUM(igst_amount),0) AS igst
       FROM purchase_invoices
       WHERE company_id = $1 AND bill_date >= $2 AND bill_date < $3 AND is_deleted = false AND status != 'cancelled'`,
      [companyId, df, dt]
    );
    const retPeriod = fp;
    res.json(success({
      meta: {
        schema: 'bizflow.gstr3b.export',
        version: '1.0',
        generated_at: new Date().toISOString(),
        ret_period: retPeriod,
        disclaimer:
          'Aggregated outward supplies and ITC from BizFlow purchase bills. Use with your CA for GSTR-3B preparation; not a NIC portal upload file.',
      },
      gstin: cRes.rows[0]?.gstin || null,
      fp,
      ret_period: retPeriod,
      outward: out.rows[0],
      itc: itc.rows[0],
    }));
  } catch (err: any) {
    gstErrorResponse(res, err);
  }
}

export async function getHSNSummary(req: Request, res: Response) {
  try {
     const { month, year } = req.query as any;
     const { from: df, to: dt } = parsePeriod(month, year);
     const result = await query(
       `SELECT item_id, hsn_code, SUM(quantity) as qty, SUM(taxable_amount) as taxable, SUM(cgst_amount+sgst_amount+igst_amount) as tax
        FROM invoice_items i
        JOIN invoices p ON i.invoice_id = p.id
        WHERE p.company_id = $1 AND p.is_deleted = false
          AND p.invoice_type IN ('sale','tax_invoice')
          AND p.status != 'cancelled'
          AND p.invoice_date >= $2 AND p.invoice_date < $3
        GROUP BY item_id, hsn_code`,
        [req.user!.company_id, df, dt]
     );
     res.json(success(result.rows));
  } catch (err: any) {
    gstErrorResponse(res, err);
  }
}

export async function getInputCredit(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { from_date, to_date, month, year } = req.query as Record<string, string | undefined>;
    let from = '1970-01-01';
    let to = '2100-01-01';
    let rangeEndExclusive = false;
    if (month && year) {
      const p = parsePeriod(month, year);
      from = p.from;
      to = p.to;
      rangeEndExclusive = true;
    } else if (from_date && to_date) {
      from = String(from_date);
      to = String(to_date);
      rangeEndExclusive = false;
    }
    const endDateSql = rangeEndExclusive
      ? 'bill_date >= $2::date AND bill_date < $3::date'
      : 'bill_date >= $2::date AND bill_date <= $3::date';
    const expEndSql = rangeEndExclusive
      ? 'expense_date >= $2::date AND expense_date < $3::date'
      : 'expense_date >= $2::date AND expense_date <= $3::date';
    const purchases = await query(
      `SELECT COALESCE(SUM(cgst_amount), 0)::bigint AS cgst,
              COALESCE(SUM(sgst_amount), 0)::bigint AS sgst,
              COALESCE(SUM(igst_amount), 0)::bigint AS igst
       FROM purchase_invoices
       WHERE company_id = $1 AND is_deleted = false AND COALESCE(status, '') != 'cancelled'
         AND ${endDateSql}`,
      [companyId, from, to]
    );
    const expenses = await query(
      `SELECT COALESCE(SUM(cgst_amount), 0)::bigint AS cgst,
              COALESCE(SUM(sgst_amount), 0)::bigint AS sgst,
              COALESCE(SUM(igst_amount), 0)::bigint AS igst
       FROM expenses
       WHERE company_id = $1 AND is_deleted = false AND COALESCE(gst_rate, 0) > 0
         AND ${expEndSql}`,
      [companyId, from, to]
    );
    const pc = purchases.rows[0] || {};
    const ex = expenses.rows[0] || {};
    const cgst = Number(pc.cgst || 0) + Number(ex.cgst || 0);
    const sgst = Number(pc.sgst || 0) + Number(ex.sgst || 0);
    const igst = Number(pc.igst || 0) + Number(ex.igst || 0);
    res.json(
      success({
        period: { from, to },
        from_purchase_bills: { cgst: Number(pc.cgst || 0), sgst: Number(pc.sgst || 0), igst: Number(pc.igst || 0) },
        from_expenses: { cgst: Number(ex.cgst || 0), sgst: Number(ex.sgst || 0), igst: Number(ex.igst || 0) },
        total_itc: { cgst, sgst, igst, combined: cgst + sgst + igst },
      })
    );
  } catch (err: any) {
    gstErrorResponse(res, err);
  }
}
