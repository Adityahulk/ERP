import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';

export async function getGSTSummary(req: Request, res: Response) {
  try {
     const { month, year } = req.query;
     const companyId = req.user!.company_id;

     // Calculate Start and End of specific month
     // Or general aggregation if not provided
     let df = `1970-01-01`;
     let dt = `2099-12-31`;
     if (month && year) {
         df = `${year}-${String(month).padStart(2,'0')}-01`;
         // rough end of month
         dt = `${year}-${String(Number(month)+1).padStart(2,'0')}-01`;
     }

     const outputRes = await query(
       `SELECT SUM(cgst_amount) as cgst, SUM(sgst_amount) as sgst, SUM(igst_amount) as igst
        FROM invoices WHERE company_id = $1 AND invoice_date >= $2 AND invoice_date < $3 AND is_deleted = false AND status != 'cancelled'`,
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
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function getGSTR1(req: Request, res: Response) {
  try {
     const { month, year } = req.query;
     const companyId = req.user!.company_id;

     let df = `1970-01-01`, dt = `2099-12-31`;
     if (month && year) {
         df = `${year}-${String(month).padStart(2,'0')}-01`;
         dt = `${year}-${String(Number(month)+1).padStart(2,'0')}-01`; // exclusive
     }

     // B2B: registered party, meaning gstin length >= 15
     const b2b = await query(
       `SELECT p.gstin, i.invoice_number, i.invoice_date, i.taxable_amount, i.cgst_amount, i.sgst_amount, i.igst_amount
        FROM invoices i
        JOIN parties p ON i.party_id = p.id
        WHERE i.company_id = $1 AND i.invoice_date >= $2 AND i.invoice_date < $3 AND i.is_deleted = false AND length(p.gstin) >= 15`,
       [companyId, df, dt]
     );

     // B2CS: Unregistered party (gstin null/short)
     const b2cs = await query(
       `SELECT i.invoice_number, i.invoice_date, i.taxable_amount, i.cgst_amount, i.sgst_amount, i.igst_amount
        FROM invoices i
        LEFT JOIN parties p ON i.party_id = p.id
        WHERE i.company_id = $1 AND i.invoice_date >= $2 AND i.invoice_date < $3 AND i.is_deleted = false AND (p.gstin IS NULL OR length(p.gstin) < 15)`,
       [companyId, df, dt]
     );

     res.json(success({ b2b: b2b.rows, b2cs: b2cs.rows }));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function exportGSTR1(req: Request, res: Response) {
   // Generates JSON format as required by GST offline tool. Mock implementation.
   try {
     res.json(success({ 
       gstin: "27XXXXX0000X1Z5", 
       fp: "042023",
       b2b: [],
       b2cs: []
     }));
   } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function getGSTR2AReconciliation(req: Request, res: Response) {
   // Placeholder. Mock implementation comparing our DB against NIC records.
   res.json(success({ message: "GSTR-2A endpoint responding. Vendor API needed for strict comparison." }));
}

export async function getGSTR3B(req: Request, res: Response) {
  try {
     res.json(success({ message: "GSTR-3B structures require heavy aggregating across out/in flows similar to GSTR-1 logic. Responding." }));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function exportGSTR3B(req: Request, res: Response) {
   res.json(success({ message: "GSTR-3B JSON Output Builder." }));
}

export async function getHSNSummary(req: Request, res: Response) {
  try {
     const result = await query(
       `SELECT item_id, hsn_code, SUM(quantity) as qty, SUM(taxable_amount) as taxable, SUM(cgst_amount+sgst_amount+igst_amount) as tax
        FROM invoice_items i
        JOIN invoices p ON i.invoice_id = p.id
        WHERE p.company_id = $1 AND p.is_deleted = false
        GROUP BY item_id, hsn_code`, [req.user!.company_id]
     );
     res.json(success(result.rows));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function getInputCredit(req: Request, res: Response) {
  try {
     const result = await query(
        `SELECT SUM(cgst_amount) as cgst, SUM(sgst_amount) as sgst, SUM(igst_amount) as igst 
         FROM purchase_invoices WHERE company_id = $1 AND is_deleted = false AND status != 'cancelled'`,
        [req.user!.company_id]
     );
     res.json(success(result.rows[0]));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}
