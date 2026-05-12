import { redis } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../config/logger';

const SANDBOX_HOST = 'https://gstsandbox.charteredinfo.com';
const PRODUCTION_HOST = 'https://einvapi.charteredinfo.com';
const SANDBOX_EWB_AUTH_PATH = '/ewaybillapi/dec/v1.03/auth';
const SANDBOX_EWB_API_PATH = '/ewaybillapi/dec/v1.03/ewayapi';
const PRODUCTION_EWB_AUTH_PATH = '/v1.03/dec/auth';
const PRODUCTION_EWB_API_PATH = '/v1.03/dec/ewayapi';
const EINV_AUTH_PATH = '/eivital/dec/v1.04/auth';
const EINV_INVOICE_PATH = '/eicore/dec/v1.03/Invoice';
const EINV_CANCEL_PATH = '/eicore/dec/v1.03/Invoice/Cancel';
const EWB_BY_IRN_PATH = '/eiewb/dec/v1.03/ewaybill';

const REDIS_EINV_PREFIX = 'taxpro:einv:auth:';
const REDIS_EWB_PREFIX = 'taxpro:ewb:auth:';
const TOKEN_TTL_SEC = 5 * 60 * 60;

const memoryEinv = new Map<string, { token: string; expiry: number }>();
const memoryEwb = new Map<string, { token: string; expiry: number }>();

function getConfig() {
  const isProduction = env.TAXPRO_ENV === 'production';
  return {
    host: (env.TAXPRO_API_HOST || '').trim() || (isProduction ? PRODUCTION_HOST : SANDBOX_HOST),
    aspid: (env.TAXPRO_ASPID || '').trim(),
    password: (env.TAXPRO_PASSWORD || '').trim(),
    einvUser: (env.TAXPRO_EINV_USER_NAME || env.TAXPRO_USERNAME || '').trim(),
    einvPwd: (env.TAXPRO_EINV_PASSWORD || '').trim(),
    ewbUser: (env.TAXPRO_EWB_USER_NAME || env.TAXPRO_USERNAME || '').trim(),
    ewbPwd: (env.TAXPRO_EWB_PASSWORD || '').trim(),
    qrCodeSize: (env.TAXPRO_QR_CODE_SIZE || '250').trim(),
    ewbGenAction: (env.TAXPRO_EWB_GEN_ACTION || 'GENEWAYBILL').trim(),
    ewbCancelAction: (env.TAXPRO_EWB_CANCEL_ACTION || 'CANEWB').trim(),
    einvAuthPath: (env.TAXPRO_EINV_AUTH_PATH || EINV_AUTH_PATH).trim(),
    einvInvoicePath: (env.TAXPRO_EINV_INVOICE_PATH || EINV_INVOICE_PATH).trim(),
    einvCancelPath: (env.TAXPRO_EINV_CANCEL_PATH || EINV_CANCEL_PATH).trim(),
    ewbByIrnPath: (env.TAXPRO_EWB_BY_IRN_PATH || EWB_BY_IRN_PATH).trim(),
    irp: (env.TAXPRO_IRP || 'NIC1').trim(),
    irpUrl: (env.TAXPRO_IRP_URL || '1').trim(),
    ewbAuthPath: (env.TAXPRO_EWB_AUTH_PATH || (isProduction ? PRODUCTION_EWB_AUTH_PATH : SANDBOX_EWB_AUTH_PATH)).trim(),
    ewbApiPath: (env.TAXPRO_EWB_API_PATH || (isProduction ? PRODUCTION_EWB_API_PATH : SANDBOX_EWB_API_PATH)).trim(),
  };
}

export function isTaxProEinvoiceEnabled(): boolean {
  const c = getConfig();
  return !!(c.aspid && c.password && c.einvUser && c.einvPwd);
}

export function isTaxProEwayEnabled(): boolean {
  const c = getConfig();
  return !!(c.aspid && c.password && c.ewbUser && c.ewbPwd);
}

function joinHostAndPath(host: string, endpointPath: string): string {
  const h = String(host || '').trim().replace(/\/+$/, '');
  const p = `/${String(endpointPath || '').trim().replace(/^\/+/, '')}`;
  return `${h}${p}`;
}

function normalizeGstin(v: unknown): string {
  return String(v || '').trim().toUpperCase();
}

function unwrapData(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj.Data != null) return typeof obj.Data === 'string' ? safeJson(obj.Data) ?? obj.Data : obj.Data;
  if (obj.data != null) return typeof obj.data === 'string' ? safeJson(obj.data) ?? obj.data : obj.data;
  return obj;
}

function safeJson(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}

function parseTaxProError(data: any): string {
  if (data == null) return 'empty response';
  if (typeof data === 'string') return data.slice(0, 2000);
  if (typeof data?._rawBody === 'string') return `non-JSON response: ${data._rawBody.slice(0, 1500)}`;
  const u = unwrapData(data);
  const err = u?.ErrorDetails || u?.errorDetails || data?.ErrorDetails || data?.errorDetails;
  if (Array.isArray(err) && err.length) {
    return err.map((e: any) => e?.ErrorMessage || e?.errorMessage || e?.message || JSON.stringify(e)).join('; ');
  }
  if (typeof u?.message === 'string' && u.message) return u.message;
  if (typeof data?.message === 'string' && data.message) return data.message;
  if (typeof u?.Status === 'string' && u.Status !== '1' && u?.ErrorMessage) return String(u.ErrorMessage);
  return JSON.stringify(data).slice(0, 2000);
}

function configuredSandboxGstin(): string {
  return String(env.TAXPRO_SANDBOX_TEST_GSTIN || '').trim().toUpperCase();
}

function isKnownTaxProSandboxGstin(gstin: string): boolean {
  const configured = configuredSandboxGstin();
  if (configured && gstin === configured) return true;
  return /^[0-9]{2}AACCC1596Q(?:000|002)$/.test(gstin);
}

function explainTaxProAuthFailure(message: string, sellerGstin: string): string {
  const msg = String(message || '').trim();
  if (env.TAXPRO_ENV === 'sandbox' && !isKnownTaxProSandboxGstin(sellerGstin) && /invalid\s+gstin|gstin.*user|user.*gstin/i.test(msg)) {
    const configured = configuredSandboxGstin();
    const expected = configured || 'one of TaxPro sandbox test GSTINs such as 34AACCC1596Q002 / 29AACCC1596Q000';
    return `TaxPro sandbox rejected seller GSTIN ${sellerGstin}. Sandbox e-invoice credentials are mapped only to test GSTINs, not arbitrary real GSTINs. Use ${expected} in sandbox, or switch TAXPRO_ENV=production and use production TaxPro credentials for real GSTIN e-invoice generation. Original TaxPro message: ${msg}`;
  }
  return msg;
}

function extractAuthToken(body: any): string | null {
  const u = unwrapData(body);
  const t = u?.AuthToken || u?.authToken || body?.AuthToken || body?.authtoken || body?.auth_token || body?.access_token;
  return typeof t === 'string' && t.trim() ? t.trim() : null;
}

function isAuthTokenExpiredError(data: any): boolean {
  const raw = parseTaxProError(data).toLowerCase();
  if (raw.includes('gsp752')) return true;
  const hasAuth = raw.includes('authtoken') || raw.includes('auth token');
  const expired = raw.includes('expired') || raw.includes('not found') || raw.includes('invalid');
  return hasAuth && expired;
}

function parseIndianDateTimeLoose(str: unknown): string | null {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString();
  const m = s.match(/(\d{2})[/.](\d{2})[/.](\d{4})(?:\s+(\d{1,2})[:.](\d{2})[:.](\d{2})\s*(AM|PM)?)?/i);
  if (!m) return null;
  let hh = Number(m[4] || 12);
  const mm = Number(m[5] || 0);
  const ss = Number(m[6] || 0);
  const ap = (m[7] || '').toUpperCase();
  if (ap === 'PM' && hh < 12) hh += 12;
  if (ap === 'AM' && hh === 12) hh = 0;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), hh, mm, ss);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function cacheTokenGet(mem: Map<string, { token: string; expiry: number }>, redisKey: string): Promise<string | null> {
  const now = Date.now();
  const cachedMem = mem.get(redisKey);
  if (cachedMem && cachedMem.expiry > now + 120000) return cachedMem.token;
  try {
    const token = await redis.get(redisKey);
    const expRaw = await redis.get(`${redisKey}:exp`);
    const exp = Number(expRaw || 0);
    if (token && exp > now + 120000) {
      mem.set(redisKey, { token, expiry: exp });
      return token;
    }
  } catch {
    // ignore redis read errors
  }
  return null;
}

async function cacheTokenSet(mem: Map<string, { token: string; expiry: number }>, redisKey: string, token: string): Promise<void> {
  const expiry = Date.now() + TOKEN_TTL_SEC * 1000;
  mem.set(redisKey, { token, expiry });
  try {
    await redis.set(redisKey, token, 'EX', TOKEN_TTL_SEC);
    await redis.set(`${redisKey}:exp`, String(expiry), 'EX', TOKEN_TTL_SEC);
  } catch {
    // ignore redis write errors
  }
}

async function cacheTokenDelete(mem: Map<string, { token: string; expiry: number }>, redisKey: string): Promise<void> {
  mem.delete(redisKey);
  try {
    await redis.del(redisKey, `${redisKey}:exp`);
  } catch {
    // ignore redis delete errors
  }
}

async function parseResponse(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { _rawBody: text }; }
}

async function getEinvoiceAuthToken(sellerGstin: string): Promise<string> {
  const c = getConfig();
  const gstin = normalizeGstin(sellerGstin);
  if (!gstin) throw new Error('Seller GSTIN required for TaxPro e-invoice auth');
  if (!isTaxProEinvoiceEnabled()) throw new Error('TaxPro e-invoice credentials are not configured');

  const redisKey = `${REDIS_EINV_PREFIX}${gstin}`;
  const cached = await cacheTokenGet(memoryEinv, redisKey);
  if (cached) return cached;

  const q = new URLSearchParams({
    aspid: c.aspid,
    password: c.password,
    Gstin: gstin,
    User_name: c.einvUser,
    eInvPwd: c.einvPwd,
  });
  const url = `${joinHostAndPath(c.host, c.einvAuthPath)}?${q.toString()}`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const body = await parseResponse(res);
  if (!res.ok) {
    const parsed = parseTaxProError(body);
    throw new Error(`TaxPro e-invoice auth failed: ${explainTaxProAuthFailure(parsed, gstin)} (HTTP ${res.status})`);
  }
  const token = extractAuthToken(body);
  if (!token) {
    const parsed = parseTaxProError(body);
    throw new Error(`TaxPro e-invoice auth missing AuthToken: ${explainTaxProAuthFailure(parsed, gstin)}`);
  }
  await cacheTokenSet(memoryEinv, redisKey, token);
  return token;
}

async function getEwayAuthToken(gstinArg: string): Promise<string> {
  const c = getConfig();
  const gstin = normalizeGstin(gstinArg);
  if (!gstin) throw new Error('GSTIN required for TaxPro e-way auth');
  if (!isTaxProEwayEnabled()) throw new Error('TaxPro e-way credentials are not configured');

  const redisKey = `${REDIS_EWB_PREFIX}${gstin}`;
  const cached = await cacheTokenGet(memoryEwb, redisKey);
  if (cached) return cached;

  const q = new URLSearchParams({
    action: 'ACCESSTOKEN',
    aspid: c.aspid,
    password: c.password,
    gstin,
    username: c.ewbUser,
    ewbpwd: c.ewbPwd,
  });
  const url = `${joinHostAndPath(c.host, c.ewbAuthPath)}?${q.toString()}`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const body = await parseResponse(res);
  if (!res.ok) throw new Error(`TaxPro e-way auth failed: ${parseTaxProError(body)} (HTTP ${res.status})`);
  const token = extractAuthToken(body);
  if (!token) throw new Error(`TaxPro e-way auth missing AuthToken: ${parseTaxProError(body)}`);
  await cacheTokenSet(memoryEwb, redisKey, token);
  return token;
}

function pickIrnSuccessFields(u: any) {
  return {
    irn: u?.Irn || u?.irn,
    ackNumber: u?.AckNo != null ? String(u.AckNo) : (u?.ackNo != null ? String(u.ackNo) : ''),
    ackDate: u?.AckDt || u?.ackDt || '',
    signedQr: u?.SignedQRCode || u?.signedQRCode || '',
  };
}

export async function generateTaxProIRN(nicPayload: Record<string, unknown>, sellerGstin: string): Promise<{ irn: string; ack_number: string; ack_date: string; signed_qr_code?: string }> {
  const c = getConfig();
  const gstin = normalizeGstin(sellerGstin);
  const redisKey = `${REDIS_EINV_PREFIX}${gstin}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const authToken = await getEinvoiceAuthToken(gstin);
    const q = new URLSearchParams({
      aspid: c.aspid,
      password: c.password,
      Gstin: gstin,
      AuthToken: authToken,
      QrCodeSize: c.qrCodeSize,
      User_name: c.einvUser,
    });
    const url = `${joinHostAndPath(c.host, c.einvInvoicePath)}?${q.toString()}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(nicPayload),
    });
    const body = await parseResponse(res);
    const u = unwrapData(body);
    const fields = pickIrnSuccessFields(u);
    if (!res.ok || !fields.irn) {
      if (attempt === 0 && isAuthTokenExpiredError(body)) {
        await cacheTokenDelete(memoryEinv, redisKey);
        continue;
      }
      throw new Error(`TaxPro IRN generation failed: ${parseTaxProError(body)} (HTTP ${res.status})`);
    }
    return {
      irn: String(fields.irn),
      ack_number: fields.ackNumber || '',
      ack_date: parseIndianDateTimeLoose(fields.ackDate) || new Date().toISOString(),
      signed_qr_code: fields.signedQr || undefined,
    };
  }
  throw new Error('TaxPro IRN generation failed: unable to refresh auth token');
}

function mapCancelReasonToCnlRsn(reason: number): string {
  if ([1, 2, 3, 4].includes(reason)) return String(reason);
  return '4';
}

export async function cancelTaxProIRN(irn: string, reasonCode: number, reasonDescription: string, sellerGstin: string): Promise<{ cancelled: boolean; cancel_date: string }> {
  const c = getConfig();
  const gstin = normalizeGstin(sellerGstin);
  const redisKey = `${REDIS_EINV_PREFIX}${gstin}`;
  const payload = { Irn: irn, CnlRsn: mapCancelReasonToCnlRsn(reasonCode), CnlRem: String(reasonDescription || 'Other').slice(0, 100) };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const authToken = await getEinvoiceAuthToken(gstin);
    const q = new URLSearchParams({
      aspid: c.aspid,
      password: c.password,
      Gstin: gstin,
      AuthToken: authToken,
      User_name: c.einvUser,
    });
    const url = `${joinHostAndPath(c.host, c.einvCancelPath)}?${q.toString()}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await parseResponse(res);
    if (!res.ok) {
      if (attempt === 0 && isAuthTokenExpiredError(body)) {
        await cacheTokenDelete(memoryEinv, redisKey);
        continue;
      }
      throw new Error(`TaxPro IRN cancellation failed: ${parseTaxProError(body)} (HTTP ${res.status})`);
    }
    const u = unwrapData(body);
    const cancelDate = u?.CancelDate || u?.cancelDate || u?.CnlDt;
    return { cancelled: true, cancel_date: parseIndianDateTimeLoose(cancelDate) || new Date().toISOString() };
  }
  throw new Error('TaxPro IRN cancellation failed: unable to refresh auth token');
}

function normalizeTransportDocDate(raw?: string): string {
  if (raw && /^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  const d = raw ? new Date(raw) : new Date();
  if (Number.isNaN(d.getTime())) return normalizeTransportDocDate(undefined);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function paiseToRupees(value: unknown): number {
  return Math.round((Number(value) || 0)) / 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function extractPincode(address: unknown, fallback = 0): number {
  const match = String(address || '').match(/\b([1-9][0-9]{5})\b/);
  return match ? Number(match[1]) : fallback;
}

function safePlace(address: unknown, fallback = 'City', max = 50): string {
  const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean);
  const candidates = [
    parts[parts.length - 1],
    parts[parts.length - 2],
    String(address || ''),
    fallback,
  ];
  for (const candidate of candidates) {
    const loc = String(candidate || '').replace(/\b[1-9][0-9]{5}\b/g, '').replace(/\s+/g, ' ').trim();
    if (loc.length >= 3) return loc.slice(0, max);
  }
  return fallback;
}

function ewbDocNo(value: unknown): string {
  let docNo = String(value || '').trim().replace(/[^A-Za-z0-9/-]/g, '');
  docNo = docNo.replace(/^[^A-Za-z1-9]+/, '');
  if (!docNo) docNo = `INV${Date.now().toString().slice(-12)}`;
  return docNo.slice(0, 16);
}

function ewbText(value: unknown, fallback: string, max = 100): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim() || fallback;
  return text.slice(0, max);
}

function ewbQtyUnit(unit: unknown): string {
  const raw = String(unit || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(raw)) return raw;
  const compact = raw.replace(/[^A-Z]/g, '');
  const map: Record<string, string> = {
    PCS: 'PCS', PIECE: 'PCS', PIECES: 'PCS',
    NOS: 'NOS', NO: 'NOS', NUMBER: 'NOS',
    KG: 'KGS', KGS: 'KGS', KILOGRAM: 'KGS',
    G: 'GMS', GM: 'GMS', GMS: 'GMS',
    L: 'LTR', LT: 'LTR', LTR: 'LTR', LITRE: 'LTR', LITER: 'LTR',
    M: 'MTR', MTR: 'MTR', METER: 'MTR',
    SQFT: 'SQF', SQF: 'SQF', SQM: 'SQM',
    BOX: 'BOX', BAG: 'BAG', PACK: 'PAC', PAC: 'PAC',
  };
  return map[compact] || 'NOS';
}

function stateCodeFrom(value: unknown): number {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 2);
  return digits.length === 2 ? Number(digits) : 0;
}

function isLikelyValidTransporterId(value: unknown): boolean {
  const id = String(value || '').trim().toUpperCase();
  if (!id) return false;
  if (!/^[0-9A-Z]{15}$/.test(id)) return false;
  if (/^(0{15}|NIL|NONE|NULL)$/i.test(id)) return false;
  return true;
}

function normalizeEwayTransportMode(value: unknown): string {
  const mode = String(value || '1').trim();
  return ['1', '2', '3', '4'].includes(mode) ? mode : '1';
}

function normalizeEwayDistance(value: unknown): number {
  const distance = Math.round(Number(value) || 0);
  if (distance < 0) return 0;
  if (distance > 4000) return 4000;
  return distance;
}

function normalizeEwayDocNo(value: unknown): string {
  const docNo = String(value || '').trim().replace(/[^A-Za-z0-9/-]/g, '').slice(0, 15);
  return docNo || `DOC${Date.now().toString().slice(-12)}`.slice(0, 15);
}

function normalizeEwayVehicleNo(value: unknown): string {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 20);
}

function extractEwbFields(u: any): { ewbNo: string; ewbDt: string; validUpto: string } | null {
  const queue = [u, unwrapData(u)];
  const seen = new Set<any>();
  while (queue.length) {
    const cur = queue.shift();
    if (!cur) continue;
    if (typeof cur === 'string') {
      const s = cur.trim();
      if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
        const parsed = safeJson(s);
        if (parsed) queue.push(parsed);
      }
      continue;
    }
    if (typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    const no = cur.ewbNo ?? cur.EwbNo ?? cur.ewayBillNo ?? cur.ewaybillNo ?? cur.EWayBillNo;
    if (no) {
      const dtRaw = cur.EwbDt ?? cur.ewbDt ?? cur.ewayBillDate ?? cur.ewaybillDate;
      const vuRaw = cur.EwbValidTill ?? cur.ewbValidTill ?? cur.validUpto ?? cur.validUptoDate;
      const ewbDt = parseIndianDateTimeLoose(dtRaw) || new Date().toISOString();
      const validUpto = parseIndianDateTimeLoose(vuRaw) || ewbDt;
      return { ewbNo: String(no), ewbDt, validUpto };
    }
    for (const v of Object.values(cur)) queue.push(v);
  }
  return null;
}

function buildFullEwayPayload(args: NonNullable<Parameters<typeof generateTaxProEwayBill>[0]['fullInvoice']>, transport: {
  transporter_id?: string;
  transporter_name?: string;
  transport_mode?: string;
  distance_km?: number;
  trans_doc_no?: string;
  trans_doc_dt?: string;
  vehicle_no?: string;
  vehicle_type?: 'R' | 'O';
}) {
  const invoice = args.invoice || {};
  const items = Array.isArray(args.items) ? args.items : [];
  const sellerGstin = normalizeGstin(invoice.company_gstin);
  const buyerGstin = normalizeGstin(invoice.customer_gstin) || 'URP';
  const sellerStateCode = Number(sellerGstin.slice(0, 2)) || 0;
  const buyerStateFromGstin = buyerGstin !== 'URP' && buyerGstin.length >= 2 ? Number(buyerGstin.slice(0, 2)) || 0 : 0;
  const buyerStateFromInvoice = stateCodeFrom(invoice.place_of_supply || invoice.billing_state_code || invoice.customer_state_code);
  const buyerStateCode = buyerStateFromGstin || buyerStateFromInvoice || sellerStateCode;
  const isInterstate = sellerStateCode > 0 && buyerStateCode > 0 && sellerStateCode !== buyerStateCode;
  const sellerAddress = invoice.company_address || 'Address';
  const buyerAddress = invoice.customer_address || 'Address';
  const fromPincode = extractPincode(sellerAddress);
  const toPincode = extractPincode(buyerAddress);
  if (!fromPincode) throw new Error("A valid 6-digit Pincode must be present in the user's Company Address.");
  if (!toPincode) throw new Error('A valid 6-digit Pincode must be present in the Customer Address.');

  const itemList = items.map((item: any) => {
    const unitPrice = paiseToRupees(item.unit_price);
    const qty = Number(item.quantity) || 1;
    const taxableAmount = round2(paiseToRupees(item.taxable_amount) || unitPrice * qty);
    const gstRate = Number(item.gst_rate || 0);
    const storedCgst = Number(item.cgst_rate || 0);
    const storedSgst = Number(item.sgst_rate || 0);
    const storedIgst = Number(item.igst_rate || 0);
    const cgstRate = isInterstate ? 0 : (storedCgst || (storedIgst ? 0 : round2(gstRate / 2)));
    const sgstRate = isInterstate ? 0 : (storedSgst || (storedIgst ? 0 : round2(gstRate / 2)));
    const igstRate = isInterstate ? (storedIgst || gstRate || round2(storedCgst + storedSgst)) : 0;
    return {
      productName: ewbText(item.item_name || item.item_description || item.description, 'Item', 100),
      productDesc: ewbText(item.item_description || item.item_name || item.description, 'Item', 100),
      hsnCode: Number(String(item.hsn_code || '').replace(/\D/g, '').slice(0, 8) || '9999'),
      quantity: qty,
      qtyUnit: ewbQtyUnit(item.unit),
      cgstRate,
      sgstRate,
      igstRate,
      cessRate: 0,
      cessNonadvol: 0,
      taxableAmount,
    };
  });

  const totalValue = round2(itemList.reduce((sum: number, item: any) => sum + Number(item.taxableAmount || 0), 0));
  const sourceCgstValue = paiseToRupees(invoice.cgst_amount);
  const sourceSgstValue = paiseToRupees(invoice.sgst_amount);
  const sourceIgstValue = paiseToRupees(invoice.igst_amount);
  const cgstValue = isInterstate ? 0 : round2(sourceCgstValue || ((sourceIgstValue || 0) / 2));
  const sgstValue = isInterstate ? 0 : round2(sourceSgstValue || ((sourceIgstValue || 0) / 2));
  const igstValue = isInterstate ? round2(sourceIgstValue || sourceCgstValue + sourceSgstValue) : 0;
  const cessValue = round2(paiseToRupees(invoice.cess_amount));
  const discount = round2(paiseToRupees(invoice.discount_amount || invoice.discount));
  const payload: any = {
    supplyType: 'O',
    subSupplyType: '1',
    docType: 'INV',
    docNo: ewbDocNo(invoice.invoice_number),
    docDate: normalizeTransportDocDate(String(invoice.invoice_date || transport.trans_doc_dt || '')),
    fromGstin: sellerGstin,
    fromTrdName: ewbText(invoice.company_name, 'Seller', 100),
    fromAddr1: ewbText(sellerAddress, 'Address', 100),
    fromPlace: safePlace(sellerAddress, 'City', 50),
    fromPincode,
    actFromStateCode: sellerStateCode,
    fromStateCode: sellerStateCode,
    toGstin: buyerGstin,
    toTrdName: ewbText(invoice.customer_name, 'Buyer', 100),
    toAddr1: ewbText(buyerAddress, 'Address', 100),
    toPlace: safePlace(buyerAddress, 'City', 50),
    toPincode,
    actToStateCode: buyerStateCode,
    toStateCode: buyerStateCode,
    transactionType: 1,
    totalValue,
    cgstValue,
    sgstValue,
    igstValue,
    cessValue,
    cessNonAdvolValue: 0,
    totInvValue: round2(totalValue + cgstValue + sgstValue + igstValue + cessValue - discount),
    transMode: normalizeEwayTransportMode(transport.transport_mode),
    transDistance: String(normalizeEwayDistance(transport.distance_km)),
    vehicleNo: normalizeEwayVehicleNo(transport.vehicle_no),
    vehicleType: String(transport.vehicle_type || 'R').toUpperCase() === 'O' ? 'O' : 'R',
    itemList,
  };

  const transId = String(transport.transporter_id || '').trim().toUpperCase();
  if (isLikelyValidTransporterId(transId)) payload.transporterId = transId;
  const transName = String(transport.transporter_name || '').trim();
  if (transName) payload.transporterName = transName.slice(0, 100);
  const transDocNo = String(transport.trans_doc_no || '').trim();
  if (transDocNo) payload.transDocNo = normalizeEwayDocNo(transDocNo);
  const transDocDt = transport.trans_doc_dt ? normalizeTransportDocDate(transport.trans_doc_dt) : '';
  if (transDocDt) payload.transDocDate = transDocDt;

  return payload;
}

export async function generateTaxProEwayBill(args: {
  sellerGstin: string;
  irn?: string;
  transporter_id: string;
  transporter_name?: string;
  transport_mode?: string;
  distance_km?: number;
  trans_doc_no?: string;
  trans_doc_dt?: string;
  vehicle_no: string;
  vehicle_type?: 'R' | 'O';
  fullInvoice?: {
    invoice: Record<string, any>;
    items: Record<string, any>[];
  };
}): Promise<{ ewb_no: string; ewb_date: string; valid_upto: string }> {
  const c = getConfig();
  const gstin = normalizeGstin(args.sellerGstin);
  const byIrnPayload = {
    Irn: String(args.irn || '').trim(),
    TransId: String(args.transporter_id || '').trim().toUpperCase(),
    TransName: String(args.transporter_name || 'Transport').replace(/\s+/g, ' ').trim().slice(0, 100),
    TransMode: normalizeEwayTransportMode(args.transport_mode),
    Distance: normalizeEwayDistance(args.distance_km),
    TransDocNo: normalizeEwayDocNo(args.trans_doc_no),
    TransDocDt: normalizeTransportDocDate(args.trans_doc_dt),
    VehNo: normalizeEwayVehicleNo(args.vehicle_no),
    VehType: String(args.vehicle_type || 'R').toUpperCase() === 'O' ? 'O' : 'R',
  };

  const fullPayload = args.fullInvoice?.items?.length ? buildFullEwayPayload(args.fullInvoice, args) : null;
  const redisKey = `${REDIS_EWB_PREFIX}${gstin}`;

  if (fullPayload) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const authtoken = await getEwayAuthToken(gstin);
      const q = new URLSearchParams({
        action: c.ewbGenAction,
        aspid: c.aspid,
        password: c.password,
        gstin,
        authtoken,
      });
      const url = `${joinHostAndPath(c.host, c.ewbApiPath)}?${q.toString()}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(fullPayload),
      });
      const body = await parseResponse(res);
      const fields = extractEwbFields(body);
      if (fields?.ewbNo) return { ewb_no: fields.ewbNo, ewb_date: fields.ewbDt, valid_upto: fields.validUpto };
      if (attempt === 0 && isAuthTokenExpiredError(body)) {
        await cacheTokenDelete(memoryEwb, redisKey);
        continue;
      }
      logger.warn('TaxPro EWB full payload failed', {
        status: res.status,
        err: parseTaxProError(body),
        payload: {
          docNo: fullPayload.docNo,
          docDate: fullPayload.docDate,
          fromGstin: fullPayload.fromGstin,
          toGstin: fullPayload.toGstin,
          transMode: fullPayload.transMode,
          transDistance: fullPayload.transDistance,
          vehicleNo: fullPayload.vehicleNo,
          itemCount: fullPayload.itemList?.length || 0,
        },
      });
      throw new Error(`TaxPro E-Way Bill generation failed: ${parseTaxProError(body)} (HTTP ${res.status})`);
    }
  }

  if (byIrnPayload.Irn) {
    const authToken = await getEinvoiceAuthToken(gstin);
    const res = await fetch(joinHostAndPath(c.host, c.ewbByIrnPath), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json',
        aspid: c.aspid,
        password: c.password,
        Gstin: gstin,
        user_name: c.einvUser,
        AuthToken: authToken,
        irp: c.irp,
        irpurl: c.irpUrl,
      },
      body: JSON.stringify(byIrnPayload),
    });
    const body = await parseResponse(res);
    const fields = extractEwbFields(body);
    if (!res.ok || !fields?.ewbNo) {
      throw new Error(`TaxPro E-Way Bill generation failed: ${parseTaxProError(body)} (HTTP ${res.status})`);
    }
    return { ewb_no: fields.ewbNo, ewb_date: fields.ewbDt, valid_upto: fields.validUpto };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const authtoken = await getEwayAuthToken(gstin);
    const q = new URLSearchParams({
      action: c.ewbGenAction,
      aspid: c.aspid,
      password: c.password,
      gstin,
      authtoken,
    });
    const url = `${joinHostAndPath(c.host, c.ewbApiPath)}?${q.toString()}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(byIrnPayload),
    });
    const body = await parseResponse(res);
    const fields = extractEwbFields(body);
    if (!res.ok || !fields?.ewbNo) {
      if (attempt === 0 && isAuthTokenExpiredError(body)) {
        await cacheTokenDelete(memoryEwb, redisKey);
        continue;
      }
      throw new Error(`TaxPro E-Way Bill generation failed: ${parseTaxProError(body)} (HTTP ${res.status})`);
    }
    return { ewb_no: fields.ewbNo, ewb_date: fields.ewbDt, valid_upto: fields.validUpto };
  }
  throw new Error('TaxPro E-Way Bill generation failed: unable to refresh auth token');
}

function mapEwbCancelReason(reason: number): number {
  if ([1, 2, 3, 4].includes(reason)) return reason;
  return 4;
}

export async function cancelTaxProEwayBill(args: {
  sellerGstin: string;
  ewb_no: string;
  reason_code: number;
  reason_description: string;
}): Promise<{ cancelled: boolean; cancel_date: string }> {
  const c = getConfig();
  const gstin = normalizeGstin(args.sellerGstin);
  const redisKey = `${REDIS_EWB_PREFIX}${gstin}`;
  const payload = {
    ewbNo: Number(String(args.ewb_no).trim()),
    cancelRsnCode: mapEwbCancelReason(args.reason_code),
    cancelRmrk: String(args.reason_description || 'Cancelled').slice(0, 100),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const authtoken = await getEwayAuthToken(gstin);
    const q = new URLSearchParams({
      action: c.ewbCancelAction,
      aspid: c.aspid,
      password: c.password,
      gstin,
      authtoken,
    });
    const url = `${joinHostAndPath(c.host, c.ewbApiPath)}?${q.toString()}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await parseResponse(res);
    if (!res.ok) {
      if (attempt === 0 && isAuthTokenExpiredError(body)) {
        await cacheTokenDelete(memoryEwb, redisKey);
        continue;
      }
      throw new Error(`TaxPro E-Way Bill cancellation failed: ${parseTaxProError(body)} (HTTP ${res.status})`);
    }
    const u = unwrapData(body);
    const cancelDateRaw = u?.cancelDate || u?.CancelDate;
    return { cancelled: true, cancel_date: parseIndianDateTimeLoose(cancelDateRaw) || new Date().toISOString() };
  }
  throw new Error('TaxPro E-Way Bill cancellation failed: unable to refresh auth token');
}
