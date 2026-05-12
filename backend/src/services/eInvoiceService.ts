import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { env } from '../config/env';
import { decryptSecret } from '../lib/credentialsCrypto';
import { logger } from '../config/logger';
import {
  cancelTaxProEwayBill,
  cancelTaxProIRN,
  generateTaxProEwayBill,
  generateTaxProIRN,
  isTaxProEinvoiceEnabled,
  isTaxProEwayEnabled,
} from './taxProService';

export type NicSupTyp = 'B2B' | 'B2C' | 'SEZWP' | 'SEZWOP' | 'EXPWP' | 'EXPWOP';
export type NicDocTyp = 'INV' | 'CRN' | 'DBN';

export interface EinvoiceCompany {
  id: string;
  name: string;
  legal_name?: string | null;
  gstin: string | null;
  registered_address: string | null;
  city: string | null;
  state?: string | null;
  pincode: string | null;
  state_code: string | null;
  phone?: string | null;
}

export interface EinvoiceParty {
  gstin: string | null;
  name: string;
  billing_address?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_pincode?: string | null;
  billing_state_code?: string | null;
}

export interface EinvoiceItemRow {
  item_name: string;
  item_description?: string | null;
  hsn_code?: string | null;
  unit?: string | null;
  quantity: number | string;
  unit_price: number;
  discount_amount: number;
  taxable_amount: number;
  gst_rate: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount?: number;
  total_amount: number;
  item_type?: string | null;
}

export interface EinvoiceInvoice {
  id: string;
  company_id: string;
  invoice_number: string;
  invoice_date: string | Date;
  is_interstate: boolean;
  place_of_supply?: string | null;
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount?: number;
  round_off: number;
  total_amount: number;
  invoice_type?: string;
}

const UQC_MAP: Record<string, string> = {
  pcs: 'PCS', pc: 'PCS', piece: 'PCS', pieces: 'PCS',
  nos: 'NOS', no: 'NOS', number: 'NOS', numbers: 'NOS',
  unit: 'UNT', units: 'UNT', unt: 'UNT',
  kg: 'KGS', kgs: 'KGS', kilogram: 'KGS', kilograms: 'KGS',
  g: 'GMS', gm: 'GMS', gms: 'GMS', gram: 'GMS', grams: 'GMS',
  qtl: 'QTL', quintal: 'QTL', quintals: 'QTL',
  ton: 'TON', tons: 'TON', tonne: 'TON', tonnes: 'TON',
  l: 'LTR', lt: 'LTR', ltr: 'LTR', litre: 'LTR', litres: 'LTR', liter: 'LTR', liters: 'LTR',
  ml: 'MLT', mlt: 'MLT', millilitre: 'MLT', milliliter: 'MLT',
  m: 'MTR', mtr: 'MTR', meter: 'MTR', meters: 'MTR', metre: 'MTR', metres: 'MTR',
  cm: 'CMS', cms: 'CMS', centimeter: 'CMS', centimetre: 'CMS',
  km: 'KME', kms: 'KME', kilometer: 'KME', kilometre: 'KME',
  sqft: 'SQF', 'sq.ft': 'SQF', 'sq ft': 'SQF', sqf: 'SQF', squarefeet: 'SQF', 'square feet': 'SQF',
  sqm: 'SQM', 'sq.m': 'SQM', 'sq m': 'SQM', squaremeter: 'SQM', 'square meter': 'SQM',
  box: 'BOX', boxes: 'BOX', set: 'SET', bundle: 'BDL', bdl: 'BDL',
  bag: 'BAG', bags: 'BAG', pack: 'PAC', packet: 'PAC', packets: 'PAC', pac: 'PAC',
  roll: 'ROL', rolls: 'ROL', pair: 'PRS', pairs: 'PRS',
  hour: 'HRS', hours: 'HRS', hrs: 'HRS', dz: 'DOZ', dozen: 'DOZ', doz: 'DOZ',
};
const NIC_UQC_CODES = new Set([
  'BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS',
  'CTN', 'DOZ', 'DRM', 'GGR', 'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'MLT', 'MTR',
  'MTS', 'NOS', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS',
  'TGM', 'THD', 'TON', 'TUB', 'UGS', 'UNT', 'YDS', 'OTH',
]);

export function mapUnitToUqc(unit: string | null | undefined): string {
  if (!unit) return 'PCS';
  const raw = unit.trim();
  const k = raw.toLowerCase();
  const compact = k.replace(/[^a-z0-9]/g, '');
  const mapped = UQC_MAP[k] || UQC_MAP[compact];
  if (mapped) return mapped;
  for (const [key, value] of Object.entries(UQC_MAP)) {
    const keyCompact = key.replace(/[^a-z0-9]/g, '');
    if (keyCompact.length >= 3 && compact.includes(keyCompact)) return value;
  }
  const code = raw.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  return NIC_UQC_CODES.has(code) ? code : 'PCS';
}

function formatNicDate(d: string | Date | null | undefined): string {
  if (!d) {
    const now = new Date();
    return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  }
  if (d instanceof Date) {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }
  const iso = String(d).split('T')[0];
  const parts = iso.split('-');
  if (parts.length === 3) {
    const [y, m, day] = parts;
    return `${day.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }
  const dt = new Date(d);
  if (!isNaN(dt.getTime())) {
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  }
  return String(d);
}

function paiseToRupeesStr(paise: number): string {
  return (Math.round(paise) / 100).toFixed(2);
}

function cleanGstin(value: unknown): string {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function nicText(value: unknown, fallback: string, max = 100): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim() || fallback;
  return text.slice(0, max);
}

function nicLocation(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length >= 3) return text.slice(0, 50);
  }
  return 'India';
}

function nicStateCode(value: unknown, fallback = '96'): string {
  const code = String(value || '').replace(/\D/g, '').slice(0, 2);
  return code.length === 2 ? code : fallback;
}

function nicPin(value: unknown): number {
  const pin = String(value || '').replace(/\D/g, '');
  if (/^[1-9][0-9]{5}$/.test(pin)) return Number(pin);
  return 999999;
}

function nicHsn(value: unknown, isService: boolean): string {
  const hsn = String(value || '').replace(/\D/g, '');
  if (isService) {
    if (hsn.length >= 6) return hsn.slice(0, 8);
    return '998599';
  }
  if (hsn.length >= 4) return hsn.slice(0, 8);
  return '9999';
}

function nicQty(value: unknown): number {
  const qty = Number(value);
  return Number.isFinite(qty) && qty > 0 ? Number(qty.toFixed(3)) : 1;
}

export function normalizeEinvoiceDocumentNumber(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase();
  let docNo = raw.replace(/[^A-Z0-9/-]/g, '');
  docNo = docNo.replace(/^[^A-Z1-9]+/, '');
  if (!docNo) return `INV${Date.now().toString().slice(-12)}`;
  if (docNo.length <= 16) return docNo;

  const withoutLastSeparator = docNo.replace(/([/-])([A-Z0-9]+)$/, '$2');
  if (withoutLastSeparator.length <= 16 && /^[A-Z1-9]/.test(withoutLastSeparator)) return withoutLastSeparator;

  const compact = docNo.replace(/[/-]/g, '');
  if (compact.length <= 16 && /^[A-Z1-9]/.test(compact)) return compact;

  const shortened = `${compact.slice(0, 8)}${compact.slice(-8)}`.replace(/^[^A-Z1-9]+/, '');
  return shortened || `INV${Date.now().toString().slice(-12)}`;
}

export function buildEinvoicePayload(
  invoice: EinvoiceInvoice,
  company: EinvoiceCompany,
  party: EinvoiceParty,
  items: EinvoiceItemRow[],
): Record<string, unknown> {
  const sellerGst = cleanGstin(company.gstin);
  const buyerGst = cleanGstin(party.gstin);
  const supTyp: NicSupTyp = buyerGst && buyerGst !== 'URP' ? 'B2B' : 'B2C';
  const sellerStateCode = nicStateCode(company.state_code);
  const pos = nicStateCode(invoice.place_of_supply || party.billing_state_code || company.state_code, sellerStateCode);
  const buyerStateCode = buyerGst.length === 15 ? buyerGst.slice(0, 2) : nicStateCode(party.billing_state_code || pos, pos);

  const itemList = items.map((it, idx) => {
    const isService = it.item_type === 'service' ? 'Y' : 'N';
    const qty = nicQty(it.quantity);
    const gstRt = Number(it.gst_rate) || 0;
    return {
      SlNo: String(idx + 1),
      PrdDesc: nicText(it.item_name || it.item_description, 'Item', 300),
      IsServc: isService,
      HsnCd: nicHsn(it.hsn_code, isService === 'Y'),
      Unit: mapUnitToUqc(it.unit || undefined),
      Qty: qty,
      FreeQty: 0,
      UnitPrice: parseFloat(paiseToRupeesStr(it.unit_price)),
      TotAmt: parseFloat(paiseToRupeesStr(Math.round(qty * it.unit_price))),
      Discount: parseFloat(paiseToRupeesStr(it.discount_amount || 0)),
      PreTaxVal: parseFloat(paiseToRupeesStr(it.taxable_amount)),
      AssAmt: parseFloat(paiseToRupeesStr(it.taxable_amount)),
      GstRt: gstRt,
      IgstAmt: parseFloat(paiseToRupeesStr(it.igst_amount || 0)),
      CgstAmt: parseFloat(paiseToRupeesStr(it.cgst_amount || 0)),
      SgstAmt: parseFloat(paiseToRupeesStr(it.sgst_amount || 0)),
      CesRt: 0,
      CesAmt: parseFloat(paiseToRupeesStr(it.cess_amount || 0)),
      CesNonAdvlAmt: 0,
      StateCesRt: 0,
      StateCesAmt: 0,
      TotItemVal: parseFloat(paiseToRupeesStr(it.total_amount)),
    };
  });

  return {
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: supTyp,
      RegRev: 'N',
      IgstOnIntra: 'N',
    },
    DocDtls: {
      Typ: 'INV' as NicDocTyp,
      No: normalizeEinvoiceDocumentNumber(invoice.invoice_number),
      Dt: formatNicDate(invoice.invoice_date),
    },
    SellerDtls: {
      Gstin: sellerGst,
      LglNm: nicText(company.legal_name || company.name, 'Seller', 100),
      TrdNm: nicText(company.name || company.legal_name, 'Seller', 100),
      Addr1: nicText(company.registered_address || company.city || company.state, 'Registered Address', 100),
      Loc: nicLocation(company.city, company.state, company.registered_address),
      Pin: nicPin(company.pincode),
      Stcd: sellerStateCode,
    },
    BuyerDtls: {
      Gstin: buyerGst && buyerGst.length === 15 ? buyerGst : 'URP',
      LglNm: nicText(party.name, 'Customer', 100),
      TrdNm: nicText(party.name, 'Customer', 100),
      Pos: pos,
      Addr1: nicText(party.billing_address || party.billing_city || party.billing_state, 'Customer Address', 100),
      Loc: nicLocation(party.billing_city, party.billing_state, party.billing_address),
      Pin: nicPin(party.billing_pincode),
      Stcd: buyerStateCode,
    },
    ItemList: itemList,
    ValDtls: {
      AssVal: parseFloat(paiseToRupeesStr(invoice.taxable_amount)),
      CgstVal: parseFloat(paiseToRupeesStr(invoice.cgst_amount)),
      SgstVal: parseFloat(paiseToRupeesStr(invoice.sgst_amount)),
      IgstVal: parseFloat(paiseToRupeesStr(invoice.igst_amount)),
      CesVal: parseFloat(paiseToRupeesStr(invoice.cess_amount || 0)),
      StCesVal: 0,
      Discount: parseFloat(paiseToRupeesStr(invoice.discount_amount || 0)),
      OthChrg: 0,
      RndOffAmt: parseFloat(paiseToRupeesStr(invoice.round_off || 0)),
      TotInvVal: parseFloat(paiseToRupeesStr(invoice.total_amount)),
      TotInvValFc: 0,
    },
  };
}

function fakeIrn(companyId: string, invoiceNo: string, dateStr: string): string {
  const h = crypto.createHash('sha256').update(`${companyId}|${invoiceNo}|${dateStr}`).digest('hex');
  return h.slice(0, 64).toUpperCase();
}

export interface GenerateIrnResult {
  irn: string;
  ack_number: string;
  ack_date: string;
  signed_qr_code?: string;
}

export async function generateIRN(
  payload: Record<string, unknown>,
  company: { id: string; einvoice_gsp_username?: string | null; einvoice_gsp_password_enc?: string | null; einvoice_sandbox?: boolean | null },
): Promise<GenerateIrnResult> {
  const mode = env.EINVOICE_MODE;

  if (mode === 'mock') {
    const doc = payload.DocDtls as { No?: string; Dt?: string };
    const irn = fakeIrn(company.id, String(doc?.No || ''), String(doc?.Dt || ''));
    const ack_number = `ACK${Date.now()}`;
    return { irn, ack_number, ack_date: new Date().toISOString() };
  }

  const baseUrl: string =
    (mode === 'production'
      ? (env.EINVOICE_PRODUCTION_URL || env.EINVOICE_GSP_URL)
      : (env.EINVOICE_SANDBOX_URL || env.EINVOICE_GSP_URL || 'https://einv-apisandbox.nic.in')) || '';

  const sellerGstin = String((payload as any)?.SellerDtls?.Gstin || '').trim().toUpperCase();
  const tryTaxPro = isTaxProEinvoiceEnabled() || Boolean(env.TAXPRO_API_BASE_URL) || /taxpro/i.test(baseUrl);
  let taxProError: Error | null = null;
  if (tryTaxPro && sellerGstin) {
    try {
      return await generateTaxProIRN(payload, sellerGstin);
    } catch (e: any) {
      taxProError = e instanceof Error ? e : new Error(String(e?.message || e || 'TaxPro IRN failed'));
      logger.warn('TaxPro IRN primary flow failed', { err: taxProError.message });
    }
  }

  const username = company.einvoice_gsp_username || env.EINVOICE_USERNAME;
  const password = decryptSecret(company.einvoice_gsp_password_enc || undefined) || env.EINVOICE_PASSWORD;

  if (!username || !password) {
    if (taxProError) throw taxProError;
    throw new Error('GSP credentials not configured. Configure TaxPro variables (TAXPRO_ASPID, TAXPRO_PASSWORD, TAXPRO_EINV_USER_NAME, TAXPRO_EINV_PASSWORD) or set company e-invoice credentials / EINVOICE_USERNAME / EINVOICE_PASSWORD.');
  }

  if (!baseUrl) {
    throw new Error('EINVOICE_GSP_URL or EINVOICE_SANDBOX_URL must be set for sandbox/production modes');
  }

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/eicore/asp/v1.0/GenerateEInvoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        client_id: username,
        client_secret: password,
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`GSP returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
    }

    if (!res.ok) {
      const msg = json?.ErrorDetails || json?.message || json?.error || text.slice(0, 300);
      if (res.status === 429) throw new Error('E-invoice rate limited by NIC/GSP. Retry later.');
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }

    const irn = json?.Irn || json?.Data?.Irn;
    const ack_number = String(json?.AckNo || json?.Data?.AckNo || '');
    const ack_date = json?.AckDt || json?.Data?.AckDt || new Date().toISOString();
    if (!irn) throw new Error('GSP response missing IRN');
    return { irn, ack_number, ack_date, signed_qr_code: json?.SignedQRCode || json?.Data?.SignedQRCode };
  } catch (e: any) {
    logger.error('generateIRN GSP error', e);
    if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED') {
      throw new Error('Unable to reach e-invoice API. Check network and GSP URL.');
    }
    throw e;
  }
}

function normalizeIrnResponse(json: any): GenerateIrnResult | null {
  const irn =
    json?.Irn ||
    json?.irn ||
    json?.Data?.Irn ||
    json?.data?.Irn ||
    json?.result?.irn ||
    json?.result?.Irn;
  if (!irn) return null;
  const ack_number =
    String(
      json?.AckNo ||
      json?.ackNo ||
      json?.Data?.AckNo ||
      json?.data?.AckNo ||
      json?.result?.ackNo ||
      ''
    );
  const ack_date =
    json?.AckDt ||
    json?.ackDate ||
    json?.Data?.AckDt ||
    json?.data?.AckDt ||
    json?.result?.ackDate ||
    new Date().toISOString();
  const signed_qr_code = json?.SignedQRCode || json?.Data?.SignedQRCode || json?.data?.SignedQRCode;
  return { irn: String(irn), ack_number, ack_date: String(ack_date), signed_qr_code };
}

async function generateIRNViaTaxPro(payload: Record<string, unknown>): Promise<GenerateIrnResult | null> {
  const base = (env.TAXPRO_API_BASE_URL || '').trim().replace(/\/$/, '');
  if (!base) return null;

  const apiKey = env.TAXPRO_API_KEY || env.TAXPRO_USERNAME || env.EINVOICE_USERNAME;
  const apiSecret = env.TAXPRO_API_SECRET || env.TAXPRO_PASSWORD || env.EINVOICE_PASSWORD;
  const authHeader = apiKey && apiSecret ? `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}` : '';

  const endpointCandidates = [
    env.TAXPRO_IRN_ENDPOINT,
    '/api/einvoice/irn/generate',
    '/api/v1/einvoice/irn/generate',
    '/einvoice/generate-irn',
  ].filter(Boolean) as string[];

  const bodyCandidates = [
    payload,
    { data: payload },
    { payload },
  ];

  for (const ep of endpointCandidates) {
    const url = `${base}${ep.startsWith('/') ? '' : '/'}${ep}`;
    for (const body of bodyCandidates) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: authHeader } : {}),
            ...(apiKey ? { 'x-api-key': apiKey } : {}),
            ...(apiSecret ? { 'x-api-secret': apiSecret } : {}),
          },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let json: any = {};
        try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
        if (!res.ok) continue;
        const out = normalizeIrnResponse(json);
        if (out) return out;
      } catch (e) {
        logger.warn('TaxPro IRN attempt failed', { endpoint: ep, err: (e as any)?.message });
      }
    }
  }
  return null;
}

export async function cancelIRN(
  irn: string,
  reasonCode: number,
  reasonDescription: string,
  company: { einvoice_gsp_username?: string | null; einvoice_gsp_password_enc?: string | null },
): Promise<{ cancelled: boolean }> {
  const mode = env.EINVOICE_MODE;
  if (mode === 'mock') {
    return { cancelled: true };
  }

  const baseUrl: string =
    (env.EINVOICE_MODE === 'production'
      ? (env.EINVOICE_PRODUCTION_URL || env.EINVOICE_GSP_URL)
      : (env.EINVOICE_SANDBOX_URL || env.EINVOICE_GSP_URL || 'https://einv-apisandbox.nic.in')) || '';

  const body = { Irn: irn, CnlRsn: reasonCode, CnlRem: reasonDescription.slice(0, 100) };
  const tryTaxPro = isTaxProEinvoiceEnabled() || Boolean(env.TAXPRO_API_BASE_URL) || /taxpro/i.test(baseUrl);
  const sellerGstin = String((company as any)?.gstin || '').trim().toUpperCase();
  let taxProError: Error | null = null;
  if (tryTaxPro && sellerGstin) {
    try {
      const out = await cancelTaxProIRN(irn, reasonCode, reasonDescription, sellerGstin);
      if (out.cancelled) return { cancelled: true };
    } catch (e: any) {
      taxProError = e instanceof Error ? e : new Error(String(e?.message || e || 'TaxPro cancel IRN failed'));
      logger.warn('TaxPro cancel IRN primary flow failed', { err: taxProError.message });
    }
  }

  const username = company.einvoice_gsp_username || env.EINVOICE_USERNAME;
  const password = decryptSecret(company.einvoice_gsp_password_enc || undefined) || env.EINVOICE_PASSWORD;
  if (!username || !password) {
    if (taxProError) throw taxProError;
    throw new Error('GSP credentials not configured. Configure TaxPro variables (TAXPRO_ASPID, TAXPRO_PASSWORD, TAXPRO_EINV_USER_NAME, TAXPRO_EINV_PASSWORD) or set company e-invoice credentials / EINVOICE_USERNAME / EINVOICE_PASSWORD.');
  }

  if (!baseUrl) throw new Error('E-invoice base URL not configured');

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/eicore/asp/v1.0/CancelEInvoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      client_id: username,
      client_secret: password,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Cancel IRN failed (${res.status}): ${t.slice(0, 200)}`);
  }
  return { cancelled: true };
}

async function cancelIRNViaTaxPro(irn: string, reasonCode: number, reasonDescription: string): Promise<boolean> {
  const base = (env.TAXPRO_API_BASE_URL || '').trim().replace(/\/$/, '');
  if (!base) return false;
  const apiKey = env.TAXPRO_API_KEY || env.TAXPRO_USERNAME || env.EINVOICE_USERNAME;
  const apiSecret = env.TAXPRO_API_SECRET || env.TAXPRO_PASSWORD || env.EINVOICE_PASSWORD;
  const authHeader = apiKey && apiSecret ? `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}` : '';
  const endpointCandidates = [
    env.TAXPRO_CANCEL_ENDPOINT,
    '/api/einvoice/irn/cancel',
    '/api/v1/einvoice/irn/cancel',
    '/einvoice/cancel-irn',
  ].filter(Boolean) as string[];

  const bodyCandidates = [
    { irn, reasonCode, reasonDescription },
    { Irn: irn, CnlRsn: reasonCode, CnlRem: reasonDescription.slice(0, 100) },
  ];

  for (const ep of endpointCandidates) {
    const url = `${base}${ep.startsWith('/') ? '' : '/'}${ep}`;
    for (const body of bodyCandidates) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: authHeader } : {}),
            ...(apiKey ? { 'x-api-key': apiKey } : {}),
            ...(apiSecret ? { 'x-api-secret': apiSecret } : {}),
          },
          body: JSON.stringify(body),
        });
        if (res.ok) return true;
      } catch (e) {
        logger.warn('TaxPro cancel IRN attempt failed', { endpoint: ep, err: (e as any)?.message });
      }
    }
  }
  return false;
}

export async function generateEinvoiceQR(
  irn: string,
  invoice: Pick<EinvoiceInvoice, 'invoice_number' | 'invoice_date' | 'total_amount'>,
  mode: string,
  payload?: Record<string, unknown>,
  signedQrCode?: string,
): Promise<string> {
  const uploadsDir = path.resolve(env.UPLOAD_DIR, 'einvoice-qr');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const qrPayload = signedQrCode || (mode === 'mock'
    ? JSON.stringify({ irn, inv: invoice.invoice_number, mock: true, payload })
    : irn);

  const fileName = `${invoice.invoice_number.replace(/[^\w.-]+/g, '_')}-${Date.now()}.png`;
  const absPath = path.join(uploadsDir, fileName);
  await QRCode.toFile(absPath, qrPayload, { type: 'png', width: 256, margin: 1 });
  return `/uploads/einvoice-qr/${fileName}`;
}

export async function generateEwayBill(params: {
  sellerGstin: string;
  irn: string;
  transporter_id: string;
  transporter_name?: string;
  transport_mode?: string;
  distance_km?: number;
  trans_doc_no?: string;
  trans_doc_dt?: string;
  vehicle_no: string;
  vehicle_type?: 'R' | 'O';
}): Promise<{ ewb_no: string; ewb_date: string; valid_upto: string }> {
  if (!isTaxProEwayEnabled()) {
    throw new Error('TaxPro E-Way Bill is not configured. Set TAXPRO_ASPID, TAXPRO_PASSWORD, TAXPRO_EWB_USER_NAME, TAXPRO_EWB_PASSWORD');
  }
  return generateTaxProEwayBill(params);
}

export async function cancelEwayBill(params: {
  sellerGstin: string;
  ewb_no: string;
  reason_code: number;
  reason_description: string;
}): Promise<{ cancelled: boolean; cancel_date: string }> {
  if (!isTaxProEwayEnabled()) {
    throw new Error('TaxPro E-Way Bill is not configured. Set TAXPRO_ASPID, TAXPRO_PASSWORD, TAXPRO_EWB_USER_NAME, TAXPRO_EWB_PASSWORD');
  }
  return cancelTaxProEwayBill(params);
}
