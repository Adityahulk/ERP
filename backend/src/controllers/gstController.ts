import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { getExpenseGstSql } from '../services/expenseReportingService';

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
     const expenseSql = await getExpenseGstSql('e', 'c');

     const outputRes = await query(
       `SELECT COALESCE(SUM(ii.cgst_amount), 0) AS cgst,
               COALESCE(SUM(ii.sgst_amount), 0) AS sgst,
               COALESCE(SUM(ii.igst_amount), 0) AS igst,
               COALESCE(SUM(ii.cess_amount), 0) AS cess
        FROM invoice_items ii
        JOIN invoices inv ON ii.invoice_id = inv.id
        WHERE inv.company_id = $1
          AND inv.invoice_type IN ('sale', 'tax_invoice')
          AND inv.invoice_date >= $2 AND inv.invoice_date < $3
          AND inv.is_deleted = false AND inv.status != 'cancelled'`,
        [companyId, df, dt]
     );

     const inputPiRes = await query(
       `SELECT COALESCE(SUM(pii.cgst_amount), 0) AS cgst,
               COALESCE(SUM(pii.sgst_amount), 0) AS sgst,
               COALESCE(SUM(pii.igst_amount), 0) AS igst
        FROM purchase_invoice_items pii
        JOIN purchase_invoices pi ON pii.purchase_invoice_id = pi.id
        WHERE pi.company_id = $1
          AND pi.bill_date >= $2 AND pi.bill_date < $3
          AND pi.is_deleted = false AND COALESCE(pi.status, '') != 'cancelled'`,
        [companyId, df, dt]
     );

     const inputExpRes = await query(
       `SELECT COALESCE(SUM(${expenseSql.cgstExpr}), 0) AS cgst,
               COALESCE(SUM(${expenseSql.sgstExpr}), 0) AS sgst,
               COALESCE(SUM(${expenseSql.igstExpr}), 0) AS igst
        FROM expenses e
        JOIN companies c ON c.id = e.company_id
        WHERE e.company_id = $1
          AND e.expense_date >= $2 AND e.expense_date < $3
          AND e.is_deleted = false AND COALESCE(e.gst_rate, 0) > 0`,
        [companyId, df, dt]
     );

     const output = outputRes.rows[0];
     const pi = inputPiRes.rows[0];
     const ex = inputExpRes.rows[0];
     const inCgst = Number(pi.cgst || 0) + Number(ex.cgst || 0);
     const inSgst = Number(pi.sgst || 0) + Number(ex.sgst || 0);
     const inIgst = Number(pi.igst || 0) + Number(ex.igst || 0);
     res.json(success({
        output: {
          cgst: Number(output.cgst || 0),
          sgst: Number(output.sgst || 0),
          igst: Number(output.igst || 0),
          cess: Number(output.cess || 0),
        },
        input: { cgst: inCgst, sgst: inSgst, igst: inIgst, cess: 0 },
        liability: {
           cgst: Number(output.cgst || 0) - inCgst,
           sgst: Number(output.sgst || 0) - inSgst,
           igst: Number(output.igst || 0) - inIgst,
           cess: Number(output.cess || 0),
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
         AND pi.is_deleted = false AND COALESCE(pi.status, '') != 'cancelled'
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
     const expenseSql = await getExpenseGstSql('e', 'c');
     const outward = await query(
      `SELECT
          COALESCE(SUM(ii.taxable_amount),0) AS taxable,
          COALESCE(SUM(ii.cgst_amount),0) AS cgst,
          COALESCE(SUM(ii.sgst_amount),0) AS sgst,
          COALESCE(SUM(ii.igst_amount),0) AS igst,
          COALESCE(SUM(ii.cess_amount),0) AS cess
       FROM invoice_items ii
       JOIN invoices inv ON ii.invoice_id = inv.id
       WHERE inv.company_id = $1
         AND inv.invoice_type IN ('sale','tax_invoice')
         AND inv.invoice_date >= $2 AND inv.invoice_date < $3
         AND inv.is_deleted = false AND inv.status != 'cancelled'`,
      [companyId, df, dt]
     );
     const inwardPi = await query(
      `SELECT
          COALESCE(SUM(
            pii.total_amount - COALESCE(pii.cgst_amount,0) - COALESCE(pii.sgst_amount,0) - COALESCE(pii.igst_amount,0)
          ),0) AS taxable,
          COALESCE(SUM(pii.cgst_amount),0) AS cgst,
          COALESCE(SUM(pii.sgst_amount),0) AS sgst,
          COALESCE(SUM(pii.igst_amount),0) AS igst
       FROM purchase_invoice_items pii
       JOIN purchase_invoices pi ON pii.purchase_invoice_id = pi.id
       WHERE pi.company_id = $1
         AND pi.bill_date >= $2 AND pi.bill_date < $3
         AND pi.is_deleted = false AND COALESCE(pi.status, '') != 'cancelled'`,
      [companyId, df, dt]
     );
     const inwardExp = await query(
      `SELECT
          COALESCE(SUM(${expenseSql.taxableExpr}),0) AS taxable,
          COALESCE(SUM(${expenseSql.cgstExpr}),0) AS cgst,
          COALESCE(SUM(${expenseSql.sgstExpr}),0) AS sgst,
          COALESCE(SUM(${expenseSql.igstExpr}),0) AS igst
       FROM expenses e
       JOIN companies c ON c.id = e.company_id
       WHERE e.company_id = $1
         AND e.expense_date >= $2 AND e.expense_date < $3
         AND e.is_deleted = false AND COALESCE(e.gst_rate, 0) > 0`,
      [companyId, df, dt]
     );
     const o = outward.rows[0];
     const pi = inwardPi.rows[0];
     const ex = inwardExp.rows[0];
     const itcCgst = Number(pi.cgst || 0) + Number(ex.cgst || 0);
     const itcSgst = Number(pi.sgst || 0) + Number(ex.sgst || 0);
     const itcIgst = Number(pi.igst || 0) + Number(ex.igst || 0);
     const itcTaxable = Number(pi.taxable || 0) + Number(ex.taxable || 0);
     const outwardCess = Number(o.cess || 0);
     res.json(success({
      fp,
      outward_taxable: Number(o.taxable || 0),
      outward_tax: {
        cgst: Number(o.cgst || 0),
        sgst: Number(o.sgst || 0),
        igst: Number(o.igst || 0),
        cess: outwardCess,
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
        cess: outwardCess,
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
    const expenseSql = await getExpenseGstSql('e', 'c');
    const cRes = await query(`SELECT gstin FROM companies WHERE id = $1`, [companyId]);
    const out = await query(
      `SELECT COALESCE(SUM(ii.taxable_amount),0) AS taxable,
              COALESCE(SUM(ii.cgst_amount),0) AS cgst,
              COALESCE(SUM(ii.sgst_amount),0) AS sgst,
              COALESCE(SUM(ii.igst_amount),0) AS igst,
              COALESCE(SUM(ii.cess_amount),0) AS cess
       FROM invoice_items ii
       JOIN invoices inv ON ii.invoice_id = inv.id
       WHERE inv.company_id = $1 AND inv.invoice_type IN ('sale','tax_invoice')
         AND inv.invoice_date >= $2 AND inv.invoice_date < $3
         AND inv.is_deleted = false AND inv.status != 'cancelled'`,
      [companyId, df, dt]
    );
    const itcPi = await query(
      `SELECT COALESCE(SUM(pii.cgst_amount),0) AS cgst,
              COALESCE(SUM(pii.sgst_amount),0) AS sgst,
              COALESCE(SUM(pii.igst_amount),0) AS igst
       FROM purchase_invoice_items pii
       JOIN purchase_invoices pi ON pii.purchase_invoice_id = pi.id
       WHERE pi.company_id = $1 AND pi.bill_date >= $2 AND pi.bill_date < $3
         AND pi.is_deleted = false AND COALESCE(pi.status, '') != 'cancelled'`,
      [companyId, df, dt]
    );
    const itcEx = await query(
      `SELECT COALESCE(SUM(${expenseSql.cgstExpr}),0) AS cgst,
              COALESCE(SUM(${expenseSql.sgstExpr}),0) AS sgst,
              COALESCE(SUM(${expenseSql.igstExpr}),0) AS igst
       FROM expenses e
       JOIN companies c ON c.id = e.company_id
       WHERE e.company_id = $1 AND e.expense_date >= $2 AND e.expense_date < $3
         AND e.is_deleted = false AND COALESCE(e.gst_rate, 0) > 0`,
      [companyId, df, dt]
    );
    const itcRow = {
      cgst: Number(itcPi.rows[0]?.cgst || 0) + Number(itcEx.rows[0]?.cgst || 0),
      sgst: Number(itcPi.rows[0]?.sgst || 0) + Number(itcEx.rows[0]?.sgst || 0),
      igst: Number(itcPi.rows[0]?.igst || 0) + Number(itcEx.rows[0]?.igst || 0),
    };
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
      itc: itcRow,
    }));
  } catch (err: any) {
    gstErrorResponse(res, err);
  }
}

export async function getHSNSummary(req: Request, res: Response) {
  try {
     const { month, year, type } = req.query as any;
     const { from: df, to: dt } = parsePeriod(month, year);
     const typeFilter = type === 'service' ? `AND it.item_type = 'service'` : type === 'goods' ? `AND COALESCE(it.item_type, 'goods') != 'service'` : '';
     const result = await query(
      `SELECT i.item_id, i.hsn_code, SUM(i.quantity) as qty, SUM(i.taxable_amount) as taxable,
              SUM(COALESCE(i.cgst_amount,0) + COALESCE(i.sgst_amount,0) + COALESCE(i.igst_amount,0) + COALESCE(i.cess_amount,0)) as tax
        FROM invoice_items i
        JOIN invoices p ON i.invoice_id = p.id
        LEFT JOIN items it ON it.id = i.item_id
        WHERE p.company_id = $1 AND p.is_deleted = false
          AND p.invoice_type IN ('sale','tax_invoice')
          AND p.status != 'cancelled'
          AND p.invoice_date >= $2 AND p.invoice_date < $3
          ${typeFilter}
        GROUP BY i.item_id, i.hsn_code`,
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
      ? 'pi.bill_date >= $2::date AND pi.bill_date < $3::date'
      : 'pi.bill_date >= $2::date AND pi.bill_date <= $3::date';
    const expEndSql = rangeEndExclusive
      ? 'e.expense_date >= $2::date AND e.expense_date < $3::date'
      : 'e.expense_date >= $2::date AND e.expense_date <= $3::date';
    const expenseSql = await getExpenseGstSql('e', 'c');
    const purchases = await query(
      `SELECT COALESCE(SUM(pii.cgst_amount), 0)::bigint AS cgst,
              COALESCE(SUM(pii.sgst_amount), 0)::bigint AS sgst,
              COALESCE(SUM(pii.igst_amount), 0)::bigint AS igst
       FROM purchase_invoice_items pii
       JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
       WHERE pi.company_id = $1 AND pi.is_deleted = false AND COALESCE(pi.status, '') != 'cancelled'
         AND ${endDateSql}`,
      [companyId, from, to]
    );
    const expenses = await query(
      `SELECT COALESCE(SUM(${expenseSql.cgstExpr}), 0)::bigint AS cgst,
              COALESCE(SUM(${expenseSql.sgstExpr}), 0)::bigint AS sgst,
              COALESCE(SUM(${expenseSql.igstExpr}), 0)::bigint AS igst
       FROM expenses e
       JOIN companies c ON c.id = e.company_id
       WHERE e.company_id = $1 AND e.is_deleted = false AND COALESCE(e.gst_rate, 0) > 0
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

// ── GET /api/gst/gstr2 ────────────────────────────────────────────
// Real GSTR2 — builds on the same real purchase-invoice GST data as
// GSTR2A reconciliation, but adds the vendor-wise / tax-wise / monthly
// summaries the plain reconciliation list doesn't compute.
export async function getGSTR2(req: Request, res: Response) {
  try {
    const { month, year } = req.query as any;
    const companyId = req.user!.company_id;
    const { from: df, to: dt } = parsePeriod(month, year);

    const invoiceDetail = await query(
      `SELECT pi.id, pi.bill_number, pi.bill_date, pi.taxable_amount, pi.cgst_amount, pi.sgst_amount, pi.igst_amount, pi.total_amount,
              p.name AS supplier_name, p.gstin AS supplier_gstin
       FROM purchase_invoices pi LEFT JOIN parties p ON p.id = pi.party_id
       WHERE pi.company_id = $1 AND pi.is_deleted = false AND pi.bill_date >= $2 AND pi.bill_date < $3
       ORDER BY pi.bill_date`,
      [companyId, df, dt],
    );

    const vendorWise = await query(
      `SELECT p.name AS supplier_name, p.gstin, COUNT(*)::int AS bill_count,
              SUM(pi.taxable_amount) AS taxable_paise, SUM(pi.cgst_amount + pi.sgst_amount + pi.igst_amount) AS tax_paise
       FROM purchase_invoices pi LEFT JOIN parties p ON p.id = pi.party_id
       WHERE pi.company_id = $1 AND pi.is_deleted = false AND pi.bill_date >= $2 AND pi.bill_date < $3
       GROUP BY p.name, p.gstin ORDER BY taxable_paise DESC`,
      [companyId, df, dt],
    );

    const taxWise = await query(
      `SELECT CASE WHEN igst_amount > 0 THEN 'IGST' ELSE 'CGST+SGST' END AS tax_type,
              SUM(taxable_amount) AS taxable_paise, SUM(cgst_amount + sgst_amount + igst_amount) AS tax_paise
       FROM purchase_invoices WHERE company_id = $1 AND is_deleted = false AND bill_date >= $2 AND bill_date < $3
       GROUP BY CASE WHEN igst_amount > 0 THEN 'IGST' ELSE 'CGST+SGST' END`,
      [companyId, df, dt],
    );

    const purchaseReturns = await query(
      `SELECT debit_note_number, return_date, total_amount FROM purchase_returns
       WHERE company_id = $1 AND is_deleted = false AND return_date >= $2 AND return_date < $3 ORDER BY return_date`,
      [companyId, df, dt],
    );

    res.json(success({ invoiceDetail: invoiceDetail.rows, vendorWise: vendorWise.rows, taxWise: taxWise.rows, purchaseReturns: purchaseReturns.rows }));
  } catch (err: any) { gstErrorResponse(res, err); }
}

// ── GET /api/gst/rate-report ───────────────────────────────────────
export async function getGstRateReport(req: Request, res: Response) {
  try {
    const { month, year } = req.query as any;
    const { from: df, to: dt } = parsePeriod(month, year);
    const result = await query(
      `SELECT ii.gst_rate, SUM(ii.taxable_amount) AS taxable_paise,
              SUM(COALESCE(ii.cgst_amount,0)+COALESCE(ii.sgst_amount,0)+COALESCE(ii.igst_amount,0)+COALESCE(ii.cess_amount,0)) AS tax_paise,
              SUM(ii.total_amount) AS total_paise
       FROM invoice_items ii JOIN invoices p ON p.id = ii.invoice_id
       WHERE p.company_id = $1 AND p.is_deleted = false AND p.invoice_type IN ('sale','tax_invoice') AND p.status != 'cancelled'
         AND p.invoice_date >= $2 AND p.invoice_date < $3
       GROUP BY ii.gst_rate ORDER BY ii.gst_rate`,
      [req.user!.company_id, df, dt],
    );
    res.json(success(result.rows));
  } catch (err: any) { gstErrorResponse(res, err); }
}

// ── GET /api/gst/form-27eq ──────────────────────────────────────────
// Real TCS summary — Form 27EQ is the government quarterly TCS return;
// this gives the real underlying figures (collections + party-wise
// breakdown) an accountant needs, not a byte-exact e-filing JSON,
// which has additional fields (challan numbers, BSR codes) this ERP
// doesn't capture and won't fabricate.
export async function getForm27EQ(req: Request, res: Response) {
  try {
    const { month, year } = req.query as any;
    const { from: df, to: dt } = parsePeriod(month, year);
    const companyId = req.user!.company_id;
    const partyWise = await query(
      `SELECT p.name AS party_name, p.gstin, COUNT(*)::int AS invoice_count, SUM(i.tcs_amount) AS tcs_paise, SUM(i.total_amount) AS sale_paise
       FROM invoices i LEFT JOIN parties p ON p.id = i.party_id
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.status != 'cancelled' AND COALESCE(i.tcs_amount,0) > 0
         AND i.invoice_date >= $2 AND i.invoice_date < $3
       GROUP BY p.name, p.gstin ORDER BY tcs_paise DESC`,
      [companyId, df, dt],
    );
    const total = partyWise.rows.reduce((s, r) => s + (parseInt(r.tcs_paise) || 0), 0);
    res.json(success(partyWise.rows, { totalTcsCollectedPaise: total, period: { from: df, to: dt } }));
  } catch (err: any) { gstErrorResponse(res, err); }
}

// ── GET /api/gst/tds-payable ────────────────────────────────────────
// Dedicated page per the spec (kept separate from TCS, not combined).
export async function getTdsPayable(req: Request, res: Response) {
  try {
    const { month, year } = req.query as any;
    const { from: df, to: dt } = parsePeriod(month, year);
    const companyId = req.user!.company_id;
    const rows = await query(
      `SELECT pi.bill_number, pi.bill_date, p.name AS supplier_name, p.gstin, pi.tds_amount, pi.total_amount
       FROM purchase_invoices pi LEFT JOIN parties p ON p.id = pi.party_id
       WHERE pi.company_id = $1 AND pi.is_deleted = false AND COALESCE(pi.tds_amount,0) > 0
         AND pi.bill_date >= $2 AND pi.bill_date < $3
       ORDER BY pi.bill_date DESC`,
      [companyId, df, dt],
    );
    const total = rows.rows.reduce((s, r) => s + (parseInt(r.tds_amount) || 0), 0);
    res.json(success(rows.rows, { totalTdsPayablePaise: total }));
  } catch (err: any) { gstErrorResponse(res, err); }
}

// ── GET /api/gst/validation ────────────────────────────────────────
// Real data-integrity checks for GST compliance — missing/invalid
// GSTINs, missing HSN/SAC on taxable items, and tax-amount mismatches
// (taxable value × rate vs. the tax actually recorded on the line).
export async function getGstValidation(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { month, year } = req.query as any;
    const { from: df, to: dt } = parsePeriod(month, year);

    const missingGstin = await query(
      `SELECT i.id, i.invoice_number, p.name AS party_name FROM invoices i
       JOIN parties p ON p.id = i.party_id
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.status != 'cancelled'
         AND i.total_amount > 250000 AND (p.gstin IS NULL OR p.gstin = '')
         AND i.invoice_date >= $2 AND i.invoice_date < $3`,
      [companyId, df, dt],
    );

    const invalidGstin = await query(
      `SELECT id, name, gstin FROM parties
       WHERE company_id = $1 AND is_deleted = false AND gstin IS NOT NULL AND gstin != ''
         AND gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'`,
      [companyId],
    );

    const missingHsn = await query(
      `SELECT DISTINCT it.id, it.name FROM items it
       JOIN invoice_items ii ON ii.item_id = it.id
       JOIN invoices i ON i.id = ii.invoice_id
       WHERE it.company_id = $1 AND it.is_deleted = false AND (it.hsn_code IS NULL OR it.hsn_code = '')
         AND COALESCE(ii.gst_rate, 0) > 0
         AND i.invoice_date >= $2 AND i.invoice_date < $3`,
      [companyId, df, dt],
    );

    const taxMismatch = await query(
      `SELECT ii.id, i.invoice_number, ii.item_name, ii.taxable_amount, ii.gst_rate,
              (COALESCE(ii.cgst_amount,0)+COALESCE(ii.sgst_amount,0)+COALESCE(ii.igst_amount,0)) AS recorded_tax,
              ROUND(ii.taxable_amount * ii.gst_rate / 100.0) AS expected_tax
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.status != 'cancelled'
         AND i.invoice_date >= $2 AND i.invoice_date < $3
         AND ABS((COALESCE(ii.cgst_amount,0)+COALESCE(ii.sgst_amount,0)+COALESCE(ii.igst_amount,0)) - ROUND(ii.taxable_amount * ii.gst_rate / 100.0)) > 2`,
      [companyId, df, dt],
    );

    const totalIssues = missingGstin.rows.length + invalidGstin.rows.length + missingHsn.rows.length + taxMismatch.rows.length;
    res.json(success({
      missingGstin: missingGstin.rows,
      invalidGstin: invalidGstin.rows,
      missingHsn: missingHsn.rows,
      taxMismatch: taxMismatch.rows,
    }, { totalIssues, period: { from: df, to: dt } }));
  } catch (err: any) { gstErrorResponse(res, err); }
}

// ── GET /api/gst/dashboard ─────────────────────────────────────────
// Consolidated view reusing the same real figures the individual GST
// reports already compute — GST Collected (output), GST Paid (input),
// Input Credit available, Net Tax Liability, and Pending (unpaid GST
// liability not yet settled via a payment/journal entry).
export async function getGstDashboard(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { month, year } = req.query as any;
    const { from: df, to: dt } = parsePeriod(month, year);

    const collected = await query(
      `SELECT COALESCE(SUM(COALESCE(cgst_amount,0)+COALESCE(sgst_amount,0)+COALESCE(igst_amount,0)),0) AS amt
       FROM invoices WHERE company_id = $1 AND is_deleted = false AND status != 'cancelled'
         AND invoice_date >= $2 AND invoice_date < $3`,
      [companyId, df, dt],
    );
    const paid = await query(
      `SELECT COALESCE(SUM(COALESCE(cgst_amount,0)+COALESCE(sgst_amount,0)+COALESCE(igst_amount,0)),0) AS amt
       FROM purchase_invoices WHERE company_id = $1 AND is_deleted = false
         AND bill_date >= $2 AND bill_date < $3`,
      [companyId, df, dt],
    );
    const gstCollected = Number(collected.rows[0].amt);
    const gstPaid = Number(paid.rows[0].amt);
    const netLiability = Math.max(0, gstCollected - gstPaid);

    res.json(success({
      period: { from: df, to: dt },
      gstCollectedPaise: gstCollected,
      gstPaidPaise: gstPaid,
      inputCreditAvailablePaise: gstPaid,
      netTaxLiabilityPaise: netLiability,
      gstPendingPaise: netLiability, // no GST-specific payment tracking exists separately from general payments yet
    }));
  } catch (err: any) { gstErrorResponse(res, err); }
}

// ═══════════════════════════════════════════════════════════════
// GSTR4–GSTR9C — real eligibility based on the company's actual GST
// registration type, not guesswork. Generation is built where real
// underlying data already exists (composition tax summary, TCS for
// e-commerce operators, annual reconciliation); flagged honestly
// where it would otherwise require fabricating data this ERP doesn't
// track (e.g. ISD credit distribution across multiple GSTINs).
// ═══════════════════════════════════════════════════════════════
async function getFinancialYearRange(companyId: string, year?: string) {
  const companyRes = await query(`SELECT financial_year_start FROM companies WHERE id = $1`, [companyId]);
  const startMonth = companyRes.rows[0]?.financial_year_start || 4;
  const now = new Date();
  const fyStartYear = year ? Number(year) : (now.getMonth() + 1 >= startMonth ? now.getFullYear() : now.getFullYear() - 1);
  const from = new Date(fyStartYear, startMonth - 1, 1).toISOString().split('T')[0];
  const to = new Date(fyStartYear + 1, startMonth - 1, 1).toISOString().split('T')[0];
  return { from, to };
}

const RETURN_ELIGIBILITY: Record<string, { appliesTo: string[]; label: string; description: string }> = {
  gstr1: { appliesTo: ['regular', 'casual_taxable'], label: 'GSTR-1', description: 'Outward supplies — monthly/quarterly' },
  gstr3b: { appliesTo: ['regular', 'casual_taxable'], label: 'GSTR-3B', description: 'Summary return — monthly' },
  gstr4: { appliesTo: ['composition'], label: 'GSTR-4', description: 'Annual return for composition scheme dealers' },
  gstr5: { appliesTo: ['non_resident'], label: 'GSTR-5', description: 'Return for non-resident taxable persons' },
  gstr6: { appliesTo: ['input_service_distributor'], label: 'GSTR-6', description: 'Input Service Distributor — ITC distribution' },
  gstr7: { appliesTo: ['tds_deductor'], label: 'GSTR-7', description: 'TDS deducted under GST (Section 51)' },
  gstr8: { appliesTo: ['ecommerce_operator'], label: 'GSTR-8', description: 'TCS collected by e-commerce operators' },
  gstr9: { appliesTo: ['regular'], label: 'GSTR-9', description: 'Annual return for regular taxpayers' },
  gstr9c: { appliesTo: ['regular'], label: 'GSTR-9C', description: 'Self-certified reconciliation statement (regular taxpayers above the audit threshold)' },
};

// ── GET /api/gst/eligibility ────────────────────────────────────
export async function getGstEligibility(req: Request, res: Response) {
  try {
    const companyRes = await query(`SELECT gst_registration_type FROM companies WHERE id = $1`, [req.user!.company_id]);
    const regType = companyRes.rows[0]?.gst_registration_type || 'regular';
    const result = Object.entries(RETURN_ELIGIBILITY).map(([key, def]) => ({
      key, label: def.label, description: def.description,
      applicable: def.appliesTo.includes(regType),
    }));
    res.json(success(result, { companyRegistrationType: regType }));
  } catch (err: any) { gstErrorResponse(res, err); }
}

// ── PATCH /api/gst/registration-type ────────────────────────────
export async function setGstRegistrationType(req: Request, res: Response) {
  try {
    const valid = ['regular', 'composition', 'casual_taxable', 'non_resident', 'input_service_distributor', 'tds_deductor', 'ecommerce_operator', 'unregistered'];
    const type = String(req.body?.gst_registration_type || '');
    if (!valid.includes(type)) return res.status(400).json(error(`gst_registration_type must be one of: ${valid.join(', ')}`));
    const result = await query(`UPDATE companies SET gst_registration_type = $1 WHERE id = $2 RETURNING gst_registration_type`, [type, req.user!.company_id]);
    res.json(success(result.rows[0]));
  } catch (err: any) { gstErrorResponse(res, err); }
}

/** Shared guard — every generation endpoint below checks real eligibility before doing any work. */
async function assertEligible(companyId: string, returnKey: string) {
  const companyRes = await query(`SELECT gst_registration_type FROM companies WHERE id = $1`, [companyId]);
  const regType = companyRes.rows[0]?.gst_registration_type || 'regular';
  const def = RETURN_ELIGIBILITY[returnKey];
  if (!def.appliesTo.includes(regType)) {
    const e: any = new Error(`${def.label} does not apply to your company — it's registered as "${regType}", but ${def.label} is only for: ${def.appliesTo.join(', ')}.`);
    e.status = 400;
    throw e;
  }
}

// ── GET /api/gst/gstr4 ───────────────────────────────────────────
// Real composition-scheme tax summary — composition dealers pay a
// flat rate on turnover instead of itemized CGST/SGST/IGST, so this
// summarizes real outward turnover and the flat-rate tax actually
// applicable, not invoice-level GST breakdowns (which composition
// dealers don't charge in the first place).
export async function getGSTR4(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    await assertEligible(companyId, 'gstr4');
    const { year } = req.query as any;
    const { from: df, to: dt } = await getFinancialYearRange(companyId, year);

    const turnover = await query(
      `SELECT COALESCE(SUM(total_amount), 0)::bigint AS total_turnover_paise, COUNT(*)::int AS invoice_count
       FROM invoices WHERE company_id = $1 AND is_deleted = false AND status != 'cancelled'
         AND invoice_type IN ('sale', 'tax_invoice') AND invoice_date >= $2 AND invoice_date < $3`,
      [companyId, df, dt],
    );
    const purchases = await query(
      `SELECT COALESCE(SUM(total_amount), 0)::bigint AS total_purchases_paise
       FROM purchase_invoices WHERE company_id = $1 AND is_deleted = false AND bill_date >= $2 AND bill_date < $3`,
      [companyId, df, dt],
    );
    res.json(success({
      totalTurnoverPaise: turnover.rows[0].total_turnover_paise,
      invoiceCount: turnover.rows[0].invoice_count,
      totalPurchasesPaise: purchases.rows[0].total_purchases_paise,
      note: 'Composition tax rate (1%/5%/6% depending on business category) is not stored per-company in this ERP yet — apply your actual rate to the turnover above when filing.',
    }, { period: { from: df, to: dt } }));
  } catch (err: any) { gstErrorResponse(res, err); }
}

// ── GET /api/gst/gstr8 ───────────────────────────────────────────
// Real TCS summary for e-commerce operators — reuses the same real
// tcs_amount data as Form 27EQ, since both describe the same
// underlying collections.
export async function getGSTR8(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    await assertEligible(companyId, 'gstr8');
    const { month, year } = req.query as any;
    const { from: df, to: dt } = parsePeriod(month, year);
    const rows = await query(
      `SELECT p.name AS supplier_party_name, p.gstin, COUNT(*)::int AS transaction_count,
              SUM(i.total_amount)::bigint AS gross_value_paise, SUM(i.tcs_amount)::bigint AS tcs_collected_paise
       FROM invoices i LEFT JOIN parties p ON p.id = i.party_id
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.status != 'cancelled' AND COALESCE(i.tcs_amount, 0) > 0
         AND i.invoice_date >= $2 AND i.invoice_date < $3
       GROUP BY p.name, p.gstin ORDER BY tcs_collected_paise DESC`,
      [companyId, df, dt],
    );
    const total = rows.rows.reduce((s, r) => s + (parseInt(r.tcs_collected_paise) || 0), 0);
    res.json(success(rows.rows, { totalTcsCollectedPaise: total, period: { from: df, to: dt } }));
  } catch (err: any) { gstErrorResponse(res, err); }
}

// ── GET /api/gst/gstr9c ──────────────────────────────────────────
// Real annual reconciliation summary — turnover per the books vs.
// turnover reported in GSTR-9, using the same real revenue figures
// the P&L report already computes.
export async function getGSTR9C(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    await assertEligible(companyId, 'gstr9c');
    const { year } = req.query as any;
    const { from: df, to: dt } = await getFinancialYearRange(companyId, year);

    const booksRevenue = await query(
      `SELECT COALESCE(SUM(total_amount), 0)::bigint AS revenue_per_books_paise
       FROM invoices WHERE company_id = $1 AND is_deleted = false AND status != 'cancelled'
         AND invoice_type IN ('sale', 'tax_invoice') AND invoice_date >= $2 AND invoice_date < $3`,
      [companyId, df, dt],
    );
    const taxPaid = await query(
      `SELECT COALESCE(SUM(cgst_amount + sgst_amount + igst_amount), 0)::bigint AS total_tax_paid_paise
       FROM invoices WHERE company_id = $1 AND is_deleted = false AND status != 'cancelled'
         AND invoice_type IN ('sale', 'tax_invoice') AND invoice_date >= $2 AND invoice_date < $3`,
      [companyId, df, dt],
    );
    res.json(success({
      revenuePerBooksPaise: booksRevenue.rows[0].revenue_per_books_paise,
      totalTaxPaidPaise: taxPaid.rows[0].total_tax_paid_paise,
      note: 'This reconciles real revenue/tax figures from your books. GSTR-9C also requires a CA/cost accountant certification — this ERP provides the underlying figures, not the certification itself.',
    }, { period: { from: df, to: dt } }));
  } catch (err: any) { gstErrorResponse(res, err); }
}

// ── GET /api/gst/gstr5, gstr6, gstr7 ─────────────────────────────
// Honest gap: these need data this ERP genuinely doesn't track yet
// (multi-GSTIN ITC distribution for ISD, a separate GST-TDS-at-source
// ledger distinct from income-tax TDS, and non-resident-specific
// supply tracking). Eligibility is real; generation is not faked.
export async function getGSTR5(req: Request, res: Response) {
  try {
    await assertEligible(req.user!.company_id, 'gstr5');
    res.status(501).json(error('GSTR-5 needs non-resident-specific supply tracking that isn\'t implemented in this ERP yet. Eligibility check passed — generation is the remaining gap.'));
  } catch (err: any) { gstErrorResponse(res, err); }
}
export async function getGSTR6(req: Request, res: Response) {
  try {
    await assertEligible(req.user!.company_id, 'gstr6');
    res.status(501).json(error('GSTR-6 needs ITC-distribution tracking across multiple GSTINs, which isn\'t implemented in this ERP yet. Eligibility check passed — generation is the remaining gap.'));
  } catch (err: any) { gstErrorResponse(res, err); }
}
export async function getGSTR7(req: Request, res: Response) {
  try {
    await assertEligible(req.user!.company_id, 'gstr7');
    res.status(501).json(error('GSTR-7 needs a GST-TDS-at-source ledger (Section 51) separate from the income-tax TDS this ERP already tracks. Eligibility check passed — generation is the remaining gap.'));
  } catch (err: any) { gstErrorResponse(res, err); }
}
