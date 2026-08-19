import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { redis } from '../config/redis';
import { determineGSTType } from '../services/gstService';
import { normalizeInvoicePrintTheme } from '../lib/printThemes';
import { postSalesInvoiceAccounting } from '../services/accountingService';

function trimOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

type QuoteDocumentType = 'quotation' | 'proforma';

function normalizeDocumentType(value: unknown): QuoteDocumentType {
  return String(value || '').trim().toLowerCase() === 'proforma' ? 'proforma' : 'quotation';
}

function documentLabel(documentType: QuoteDocumentType): string {
  return documentType === 'proforma' ? 'Proforma Invoice' : 'Quotation';
}

/** Same FY + branch pattern as sales invoices, with an independent sequence per document type. */
async function generateQuotationNumber(companyId: string, godownId: string | null, documentType: QuoteDocumentType): Promise<string> {
  const prefixRes = await query('SELECT quotation_prefix FROM companies WHERE id = $1', [companyId]);
  const raw = prefixRes.rows[0]?.quotation_prefix;
  const prefix = documentType === 'proforma'
    ? 'PI'
    : String(raw != null && String(raw).trim() !== '' ? raw : 'QT').replace(/\/+$/, '');

  const now = new Date();
  const month = now.getMonth();
  const yearStr = now.getFullYear().toString().slice(-2);
  const nextYearStr = (now.getFullYear() + 1).toString().slice(-2);
  const prevYearStr = (now.getFullYear() - 1).toString().slice(-2);
  const fyShort = month >= 3 ? `${yearStr}-${nextYearStr}` : `${prevYearStr}-${yearStr}`;

  const branchCode = godownId ? 'GW' : 'HQ';

  const redisKey = `seq:${documentType}:${companyId}:${fyShort}`;
  let seq = 1;

  if (redis) {
    try {
      seq = await redis.incr(redisKey);
    } catch {
      const dbRes = await query(
        `SELECT COUNT(*)::int as count FROM quotations
         WHERE company_id = $1 AND document_type = $2 AND is_deleted = false AND created_at >= $3`,
        [companyId, documentType, new Date(now.getFullYear(), 0, 1).toISOString()]
      );
      seq = (dbRes.rows[0]?.count || 0) + 1;
    }
  } else {
    const dbRes = await query(
      `SELECT COUNT(*)::int as count FROM quotations
       WHERE company_id = $1 AND document_type = $2 AND is_deleted = false AND created_at >= $3`,
      [companyId, documentType, new Date(now.getFullYear(), 0, 1).toISOString()]
    );
    seq = (dbRes.rows[0]?.count || 0) + 1;
  }

  const paddedSeq = String(seq).padStart(4, '0');
  return `${prefix}/${branchCode}/${fyShort}/${paddedSeq}`;
}

type QuotationItemInput = {
  item_id?: string | null;
  item_name?: string;
  item_description?: string;
  hsn_code?: string;
  unit?: string;
  quantity?: number;
  unit_price?: number;
  discount_amount?: number;
  gst_rate?: number;
};

function normalizeItems(itemsRaw: unknown): QuotationItemInput[] {
  if (!Array.isArray(itemsRaw)) return [];
  return itemsRaw
    .map((it) => (it && typeof it === 'object' ? (it as QuotationItemInput) : {}))
    .filter((it) => (Number(it.quantity) || 0) > 0 && (Number(it.unit_price) || 0) >= 0);
}

function calculateLine(item: QuotationItemInput, isInterstate: boolean) {
  const quantity = Number(item.quantity) || 0;
  const unitPrice = Math.max(0, Math.round(Number(item.unit_price) || 0));
  const gross = Math.max(0, Math.round(quantity * unitPrice));
  const discountAmount = Math.max(0, Math.round(Number(item.discount_amount) || 0));
  const taxable = Math.max(0, gross - discountAmount);
  const gstRate = Math.max(0, Math.round(Number(item.gst_rate) || 0));
  const taxTotal = Math.round((taxable * gstRate) / 100);
  const cgst = isInterstate ? 0 : Math.round(taxTotal / 2);
  const sgst = isInterstate ? 0 : taxTotal - cgst;
  const igst = isInterstate ? taxTotal : 0;
  const total = taxable + taxTotal;
  return {
    quantity,
    unitPrice,
    gross,
    discountAmount,
    taxable,
    gstRate,
    cgstRate: isInterstate ? 0 : gstRate / 2,
    sgstRate: isInterstate ? 0 : gstRate / 2,
    igstRate: isInterstate ? gstRate : 0,
    cgst,
    sgst,
    igst,
    total,
  };
}

async function getQuotationShareRow(id: string, companyId: string) {
  const result = await query(
    `SELECT q.*, p.name AS party_name, p.phone AS party_phone, p.email AS party_email,
            c.name AS company_name, c.phone AS company_phone, c.email AS company_email
     FROM quotations q
     LEFT JOIN parties p ON p.id = q.party_id AND p.company_id = q.company_id AND p.is_deleted = false
     LEFT JOIN companies c ON c.id = q.company_id
     WHERE q.id = $1 AND q.company_id = $2 AND q.is_deleted = false`,
    [id, companyId],
  );
  return result.rows[0] || null;
}

function quotationShareMessage(row: any) {
  const company = row.company_name || 'our company';
  const party = row.party_name_override || row.party_name || 'there';
  const label = documentLabel(normalizeDocumentType(row.document_type));
  return [
    `Hello ${party},`,
    `Please find ${label.toLowerCase()} ${row.quotation_number} from ${company}.`,
    `Amount: Rs ${(Number(row.total_amount || 0) / 100).toFixed(2)}`,
    row.valid_until ? `Valid until: ${new Date(row.valid_until).toLocaleDateString('en-IN')}` : '',
  ].filter(Boolean).join('\n');
}

export async function createQuotation(req: Request, res: Response) {
  try {
    const d = req.body;
    const documentType = normalizeDocumentType(d.document_type);
    if (!d.party_id) return res.status(400).json(error('party_id is required'));
    if (!d.quotation_date) return res.status(400).json(error('quotation_date is required'));
    const items = normalizeItems(d.items);
    if (!items.length) return res.status(400).json(error('At least one line item is required'));

    const created = await withTransaction(async (client) => {
      const companyId = req.user!.company_id;
      const godownId = d.godown_id || null;
      const customNo = trimOrNull(d.quotation_number);
      const qn = customNo || (await generateQuotationNumber(companyId, godownId, documentType));

      const partyRes = await client.query(
        `SELECT id, name, phone, email, billing_state_code
         FROM parties
         WHERE id = $1 AND company_id = $2 AND is_deleted = false
         FOR SHARE`,
        [d.party_id, companyId],
      );
      if (!partyRes.rows.length) throw new Error('Party not found for this company');
      const party = partyRes.rows[0];

      let isInterstate = Boolean(d.is_interstate);
      const isGstQuote = d.is_gst_quote !== false;
      if (d.is_interstate === undefined && d.party_id) {
        const cRes = await client.query('SELECT state_code FROM companies WHERE id = $1', [companyId]);
        const partyState = String(party.billing_state_code || '');
        const companyState = String(cRes.rows[0]?.state_code || '');
        isInterstate = !!(partyState && companyState && partyState !== companyState);
      }

      let subtotal = 0;
      let discount = 0;
      let taxable = 0;
      let cgst = 0;
      let sgst = 0;
      let igst = 0;
      let total = 0;

      const prepared = items.map((it) => {
        const t = calculateLine({ ...it, gst_rate: isGstQuote ? it.gst_rate : 0 }, isInterstate);
        subtotal += t.gross;
        discount += t.discountAmount;
        taxable += t.taxable;
        cgst += t.cgst;
        sgst += t.sgst;
        igst += t.igst;
        total += t.total;
        return { raw: it, t };
      });

      const qRes = await client.query(
        `INSERT INTO quotations (
           company_id, godown_id, quotation_number, quotation_date, valid_until, party_id,
           party_name_override, party_phone_override, party_email_override,
           subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
           customer_notes, internal_notes, terms_and_conditions,
           status, created_by, is_gst_quote, pdf_template, document_theme,
           document_type, payment_terms, delivery_terms
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'draft',$20,$21,$22,$23,$24,$25,$26
         ) RETURNING *`,
        [
          companyId,
          godownId,
          qn,
          d.quotation_date,
          d.valid_until || null,
          d.party_id,
          trimOrNull(d.party_name_override) || trimOrNull(party.name),
          trimOrNull(d.party_phone_override) || trimOrNull(party.phone),
          trimOrNull(d.party_email_override) || trimOrNull(party.email),
          subtotal,
          discount,
          taxable,
          cgst,
          sgst,
          igst,
          total,
          trimOrNull(d.customer_notes),
          trimOrNull(d.internal_notes),
          trimOrNull(d.terms_and_conditions),
          req.user!.id,
          isGstQuote,
          normalizeInvoicePrintTheme(d.pdf_template || d.document_theme),
          normalizeInvoicePrintTheme(d.document_theme || d.pdf_template),
          documentType,
          trimOrNull(d.payment_terms),
          trimOrNull(d.delivery_terms),
        ]
      );
      const quotation = qRes.rows[0];

      for (let i = 0; i < prepared.length; i++) {
        const { raw, t } = prepared[i];
        await client.query(
          `INSERT INTO quotation_items (
             quotation_id, item_id, item_name, item_description, hsn_code, unit,
             quantity, unit_price, discount_type, discount_value, discount_amount, taxable_amount,
             gst_rate, cgst_rate, sgst_rate, igst_rate,
             cgst_amount, sgst_amount, igst_amount, total_amount, sort_order
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,'flat',0,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
           )`,
          [
            quotation.id,
            raw.item_id || null,
            trimOrNull(raw.item_name) || 'Item',
            trimOrNull(raw.item_description),
            trimOrNull(raw.hsn_code),
            trimOrNull(raw.unit) || 'PCS',
            t.quantity,
            t.unitPrice,
            t.discountAmount,
            t.taxable,
            t.gstRate,
            t.cgstRate,
            t.sgstRate,
            t.igstRate,
            t.cgst,
            t.sgst,
            t.igst,
            t.total,
            i + 1,
          ]
        );
      }

      return quotation;
    });

    res.status(201).json(success(created));
  } catch (err: any) {
    const message = err?.message || 'Failed to create quotation';
    res.status(/required|not found|at least|invalid/i.test(message) ? 400 : 500).json(error(message));
  }
}

export async function listQuotations(req: Request, res: Response) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const companyId = req.user!.company_id;
    const documentType = normalizeDocumentType(req.query.document_type);

    const countRes = await query(
      `SELECT COUNT(*)::bigint AS c FROM quotations q
       WHERE q.company_id = $1 AND q.document_type = $2 AND q.is_deleted = false`,
      [companyId, documentType]
    );
    const total = parseInt(countRes.rows[0].c, 10);

    const result = await query(
      `SELECT q.*,
              COALESCE(q.party_name_override, p.name) AS party_name,
              COALESCE(q.party_phone_override, p.phone) AS party_phone,
              COALESCE(q.party_email_override, p.email) AS party_email
       FROM quotations q
       LEFT JOIN parties p ON q.party_id = p.id AND p.company_id = q.company_id AND p.is_deleted = false
       WHERE q.company_id = $1 AND q.document_type = $2 AND q.is_deleted = false
       ORDER BY q.created_at DESC
       LIMIT $3 OFFSET $4`,
      [companyId, documentType, limit, offset]
    );

    res.json(success(buildPaginatedResponse(result.rows, total, page, limit)));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getQuotation(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT q.*,
              COALESCE(q.party_name_override, p.name) AS party_name,
              COALESCE(q.party_phone_override, p.phone) AS party_phone,
              COALESCE(q.party_email_override, p.email) AS party_email,
              p.gstin AS party_gstin,
              p.billing_address AS party_address,
              p.billing_state AS party_state,
              p.billing_state_code AS party_state_code
       FROM quotations q
       LEFT JOIN parties p ON p.id = q.party_id AND p.company_id = q.company_id AND p.is_deleted = false
       WHERE q.id = $1 AND q.company_id = $2 AND q.is_deleted = false`,
      [req.params.id, req.user!.company_id]
    );
    if (!result.rows.length) return res.status(404).json(error('Quotation not found'));
    const itemsRes = await query(
      `SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order ASC, id ASC`,
      [req.params.id]
    );
    res.json(success({ ...result.rows[0], items: itemsRes.rows }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function shareQuotationWhatsApp(req: Request, res: Response) {
  try {
    const row = await getQuotationShareRow(req.params.id, req.user!.company_id);
    if (!row) return res.status(404).json(error('Quotation not found'));
    const phone = String(req.body?.phone || row.party_phone_override || row.party_phone || '').replace(/\D/g, '');
    if (phone.length < 10) return res.status(400).json(error('Enter a mobile number to share this quotation on WhatsApp.'));
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(quotationShareMessage(row))}`;
    res.json(success({ url, phone }));
  } catch (err: any) {
    res.status(500).json(error(err.message || 'Failed to prepare WhatsApp share'));
  }
}

export async function shareQuotationEmail(req: Request, res: Response) {
  try {
    const row = await getQuotationShareRow(req.params.id, req.user!.company_id);
    if (!row) return res.status(404).json(error('Quotation not found'));
    const emailTo = trimOrNull(req.body?.email) || row.party_email_override || row.party_email;
    if (!emailTo) return res.status(400).json(error('Enter an email address to share this quotation.'));
    const subject = `${documentLabel(normalizeDocumentType(row.document_type))} ${row.quotation_number}`;
    const body = quotationShareMessage(row);
    res.json(success({ url: `mailto:${encodeURIComponent(emailTo)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, email: emailTo }));
  } catch (err: any) {
    res.status(500).json(error(err.message || 'Failed to prepare email share'));
  }
}

export async function updateQuotationStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json(error('status is required'));
    if (!['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'].includes(String(status))) {
      return res.status(400).json(error('Invalid status'));
    }

    const r = await query(
      `UPDATE quotations
       SET status = $1, confirmed_at = CASE WHEN $1 = 'accepted' THEN now() ELSE confirmed_at END
       WHERE id = $2 AND company_id = $3 AND is_deleted = false RETURNING id, document_type`,
      [status, id, req.user!.company_id]
    );
    if (!r.rows.length) return res.status(404).json(error('Quotation not found'));

    res.json(success({ message: `Quotation marked as ${status}` }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function convertToInvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const result = await withTransaction(async (client) => {
      const qRes = await client.query(
        `SELECT * FROM quotations WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
        [id, companyId]
      );
      if (!qRes.rows.length) return { err: 'Quotation not found' as const };
      const q = qRes.rows[0];
      const documentType = normalizeDocumentType(q.document_type);

      if (documentType === 'proforma' && q.status !== 'accepted' && !q.converted_to_invoice_id) {
        return { err: 'Customer confirmation is required before converting this Proforma Invoice' as const, status: 400 as const };
      }

      if (q.converted_to_invoice_id) {
        return { ok: true as const, invoiceId: q.converted_to_invoice_id, reused: true as const };
      }

      const prefixRes = await client.query('SELECT invoice_prefix FROM companies WHERE id = $1', [companyId]);
      const prefix = prefixRes.rows[0]?.invoice_prefix || 'INV';
      const yearStr = new Date().getFullYear().toString().slice(-2);
      const countRes = await client.query(
        `SELECT COUNT(*)::int as count FROM invoices WHERE company_id = $1 AND is_deleted = false AND created_at >= $2`,
        [companyId, new Date(new Date().getFullYear(), 0, 1).toISOString()]
      );
      const invoiceNumber = `${prefix}/${yearStr}/${String((countRes.rows[0]?.count || 0) + 1).padStart(4, '0')}`;

      const qItemsRes = await client.query(
        `SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order ASC, id ASC`,
        [q.id]
      );
      const qItems = qItemsRes.rows;
      if (!qItems.length) return { err: 'Quotation has no line items' as const };

      let partySnap: {
        name: string | null;
        gstin: string | null;
        bill: string | null;
        ship: string | null;
      } = {
        name: trimOrNull(q.party_name_override),
        gstin: null,
        bill: null,
        ship: null,
      };
      let isInterstate = false;
      let placeOfSupply: string | null = null;

      if (q.party_id) {
        const pr = await client.query(
          `SELECT name, gstin, billing_address, shipping_address, billing_state_code
           FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
          [q.party_id, companyId],
        );
        if (pr.rows[0]) {
          partySnap = {
            name: trimOrNull(q.party_name_override) || (pr.rows[0].name as string) || null,
            gstin: (pr.rows[0].gstin as string) || null,
            bill: (pr.rows[0].billing_address as string) || null,
            ship: (pr.rows[0].shipping_address as string) || null,
          };
          placeOfSupply = String(pr.rows[0].billing_state_code || '').slice(0, 5) || null;
          const cRes = await client.query('SELECT state_code FROM companies WHERE id = $1', [companyId]);
          isInterstate =
            determineGSTType(cRes.rows[0]?.state_code, pr.rows[0]?.billing_state_code) === 'inter';
        }
      } else if (Number(q.igst_amount) > 0) {
        isInterstate = true;
      }

      const compEinv = await client.query(
        `SELECT einvoice_enabled, einvoice_turnover_above_5cr FROM companies WHERE id = $1`,
        [companyId],
      );
      const einvOn = compEinv.rows[0]?.einvoice_enabled && compEinv.rows[0]?.einvoice_turnover_above_5cr;
      const einvoiceStatus = einvOn ? 'pending' : 'not_applicable';

      const pdfTemplate = normalizeInvoicePrintTheme(q.pdf_template || q.document_theme);
      const documentTheme = normalizeInvoicePrintTheme(q.document_theme || q.pdf_template);

      const invRes = await client.query(
        `INSERT INTO invoices (
          company_id, invoice_number, invoice_type, party_id, godown_id,
          invoice_date, due_date, is_interstate, place_of_supply,
          party_name_snapshot, party_gstin_snapshot, billing_address_snapshot, shipping_address_snapshot,
          subtotal, discount_amount, taxable_amount,
          cgst_amount, sgst_amount, igst_amount, cess_amount, round_off, total_amount,
          paid_amount, payment_status, payment_mode, status, einvoice_status,
          notes, terms_and_conditions, created_by, pdf_template, document_theme, custom_fields
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
          $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33
        ) RETURNING *`,
        [
          companyId,
          invoiceNumber,
          'tax_invoice',
          q.party_id || null,
          q.godown_id || req.user!.godown_id || null,
          documentType === 'proforma' ? new Date().toISOString().split('T')[0] : (q.quotation_date || new Date().toISOString().split('T')[0]),
          q.valid_until || null,
          isInterstate,
          placeOfSupply,
          partySnap.name,
          partySnap.gstin,
          partySnap.bill,
          partySnap.ship,
          Number(q.subtotal) || Number(q.total_amount) || 0,
          Number(q.discount_amount) || 0,
          Number(q.taxable_amount) || Number(q.subtotal) || Number(q.total_amount) || 0,
          Number(q.cgst_amount) || 0,
          Number(q.sgst_amount) || 0,
          Number(q.igst_amount) || 0,
          0,
          0,
          Number(q.total_amount) || 0,
          0,
          'unpaid',
          null,
          'confirmed',
          einvoiceStatus,
          q.customer_notes || `Converted from ${documentLabel(documentType).toLowerCase()} ${q.quotation_number}`,
          q.terms_and_conditions || null,
          req.user!.id,
          pdfTemplate,
          documentTheme,
          JSON.stringify({
            source_document_type: documentType,
            source_document_id: q.id,
            source_document_number: q.quotation_number,
            payment_terms: q.payment_terms || null,
            delivery_terms: q.delivery_terms || null,
          }),
        ],
      );
      const invoice = invRes.rows[0];
      const invoiceId = invoice.id;
      const invoiceGodownId = invoice.godown_id || null;

      for (const it of qItems) {
        await client.query(
          `INSERT INTO invoice_items (
            invoice_id, company_id, item_id, item_name, item_description, hsn_code, unit,
            quantity, unit_price, discount_amount, taxable_amount,
            gst_rate, cgst_rate, sgst_rate, igst_rate,
            cgst_amount, sgst_amount, igst_amount, cess_amount,
            total_amount, sort_order
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,0,$19,$20
          )`,
          [
            invoiceId,
            companyId,
            it.item_id || null,
            it.item_name || 'Item',
            it.item_description || null,
            it.hsn_code || null,
            it.unit || 'PCS',
            Number(it.quantity) || 0,
            Math.round(Number(it.unit_price) || 0),
            Math.round(Number(it.discount_amount) || 0),
            Math.round(Number(it.taxable_amount) || 0),
            Math.round(Number(it.gst_rate) || 0),
            Number(it.cgst_rate) || 0,
            Number(it.sgst_rate) || 0,
            Number(it.igst_rate) || 0,
            Math.round(Number(it.cgst_amount) || 0),
            Math.round(Number(it.sgst_amount) || 0),
            Math.round(Number(it.igst_amount) || 0),
            Math.round(Number(it.total_amount) || 0),
            Number(it.sort_order) || 0,
          ]
        );

        if (it.item_id) {
          const stockItem = await client.query(
            `SELECT track_inventory FROM items
             WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
            [it.item_id, companyId],
          );
          if (stockItem.rows[0]?.track_inventory) {
            if (!invoiceGodownId) throw new Error('Select a godown before converting inventory items to a Sales Invoice');
            await client.query(
              `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
               VALUES ($1, $2, $3, 0, 0)
               ON CONFLICT (item_id, godown_id) DO NOTHING`,
              [companyId, it.item_id, invoiceGodownId],
            );
            const stock = await client.query(
              `UPDATE item_stock
               SET quantity = quantity - $1::numeric, updated_at = now()
               WHERE company_id = $2 AND item_id = $3 AND godown_id = $4
               RETURNING quantity`,
              [Number(it.quantity) || 0, companyId, it.item_id, invoiceGodownId],
            );
            await client.query(
              `INSERT INTO stock_movements (
                 company_id, item_id, godown_id, movement_type, reference_type, reference_id,
                 quantity, balance_after, notes, created_by
               ) VALUES ($1,$2,$3,'sale','invoice',$4,$5,$6,$7,$8)`,
              [
                companyId,
                it.item_id,
                invoiceGodownId,
                invoiceId,
                -(Number(it.quantity) || 0),
                Number(stock.rows[0]?.quantity || 0),
                `Converted from ${documentLabel(documentType).toLowerCase()} ${q.quotation_number}`,
                req.user!.id,
              ],
            );
          }
        }
      }

      if (q.party_id) {
        await client.query(
          `UPDATE parties SET balance = balance + $1 WHERE id = $2 AND company_id = $3`,
          [Number(q.total_amount) || 0, q.party_id, companyId],
        );
        await client.query(
          `INSERT INTO party_ledger (
             company_id, party_id, type, amount, balance_after, reference_type,
             reference_id, narration, created_by
           ) VALUES (
             $1,$2,'sale',$3,(SELECT balance FROM parties WHERE id = $2),'invoice',$4,$5,$6
           )`,
          [companyId, q.party_id, Number(q.total_amount) || 0, invoiceId, `Sales Invoice ${invoiceNumber}`, req.user!.id],
        );
      }

      await postSalesInvoiceAccounting(client, companyId, invoice, req.user!.id);

      await client.query(
        `UPDATE quotations
         SET status = 'converted', converted_to_invoice_id = $1
         WHERE id = $2 AND company_id = $3`,
        [invoiceId, q.id, companyId]
      );

      return { ok: true as const, invoiceId, reused: false as const };
    });

    if ('err' in result && result.err) return res.status(result.status || 404).json(error(result.err));
    const msg = result.reused ? 'Document already converted' : 'Sales invoice created successfully';
    res.json(success({ message: msg, invoice_id: result.invoiceId }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
