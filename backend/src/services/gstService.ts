import { env } from '../config/env';

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHECK_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TAXPRO_SANDBOX_TEST_GSTIN_RE = /^[0-9]{2}AACCC1596Q(?:000|002)$/;

const STATE_NAMES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

function isValidGstinChecksum(gstin: string): boolean {
  const body = gstin.slice(0, 14);
  let factor = 2;
  let sum = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    const codePoint = GSTIN_CHECK_CHARS.indexOf(body[i]);
    if (codePoint < 0) return false;
    const digit = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(digit / 36) + (digit % 36);
  }
  const checkCodePoint = (36 - (sum % 36)) % 36;
  return GSTIN_CHECK_CHARS[checkCodePoint] === gstin[14];
}

function pickProviderField(raw: any, keys: string[]) {
  for (const key of keys) {
    const value = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), raw);
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return null;
}

function getProviderValue(raw: any, key: string) {
  return key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), raw);
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function firstObject(raw: any, keys: string[]) {
  for (const key of keys) {
    const value = getProviderValue(raw, key);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return null;
}

function buildAddressFromObject(addr: any): string | null {
  if (!addr || typeof addr !== 'object') return null;

  const direct = pickProviderField(addr, [
    'address', 'adr', 'addr', 'full_address', 'fullAddress', 'complete_address', 'completeAddress',
  ]);
  if (direct) return direct;

  const parts = [
    addr.bno || addr.building_no || addr.buildingNo || addr.building_number,
    addr.flno || addr.floor_no || addr.floorNo || addr.floor_number,
    addr.bnm || addr.building_name || addr.buildingName,
    addr.st || addr.street || addr.street_name || addr.streetName,
    addr.locality || addr.loc || addr.location,
    addr.dst || addr.district,
    addr.city,
    addr.stcd || addr.state || addr.state_name || addr.stateName,
    addr.pncd || addr.pincode || addr.pin_code || addr.pinCode,
  ]
    .map(normalizeText)
    .filter(Boolean) as string[];

  const deduped = parts.filter((part, idx) => parts.findIndex((p) => p.toLowerCase() === part.toLowerCase()) === idx);
  return deduped.length ? deduped.join(', ') : null;
}

function extractAddress(raw: any): string | null {
  const direct = pickProviderField(raw, [
    'address',
    'data.address',
    'data.principal_place_of_business',
    'data.principalPlaceOfBusiness',
    'data.principal_place_of_business_address',
    'principal_place_of_business',
    'principalPlaceOfBusiness',
    'principal_place_of_business_address',
    'pradr.adr',
    'data.pradr.adr',
    'result.pradr.adr',
    'taxpayer.pradr.adr',
  ]);
  if (direct) return direct;

  const addrObj = firstObject(raw, [
    'pradr.addr',
    'data.pradr.addr',
    'result.pradr.addr',
    'taxpayer.pradr.addr',
    'address',
    'data.address',
    'principal_address',
    'data.principal_address',
  ]);
  return buildAddressFromObject(addrObj);
}

function extractPincode(raw: any, address: string | null): string | null {
  const pin = pickProviderField(raw, [
    'pincode',
    'pin_code',
    'pinCode',
    'data.pincode',
    'data.pin_code',
    'data.pinCode',
    'pradr.addr.pncd',
    'data.pradr.addr.pncd',
    'result.pradr.addr.pncd',
    'taxpayer.pradr.addr.pncd',
  ]);
  if (pin) return pin;
  const match = String(address || '').match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}

function extractCity(raw: any): string | null {
  return pickProviderField(raw, [
    'city',
    'data.city',
    'loc',
    'data.loc',
    'pradr.addr.loc',
    'data.pradr.addr.loc',
    'result.pradr.addr.loc',
    'taxpayer.pradr.addr.loc',
    'pradr.addr.dst',
    'data.pradr.addr.dst',
    'result.pradr.addr.dst',
    'taxpayer.pradr.addr.dst',
  ]);
}

function isTaxProSandboxTestGstin(gstin: string): boolean {
  if (env.TAXPRO_ENV !== 'sandbox') return false;
  const configuredTestGstin = String(env.TAXPRO_SANDBOX_TEST_GSTIN || '')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (configuredTestGstin && gstin === configuredTestGstin) return true;

  // TaxPro/NIC sandbox uses pseudo GSTINs such as 34AACCC1596Q002 and
  // 29AACCC1596Q000 for testing. They are intentionally not checksum-valid
  // production GSTINs, so only allow them while the TaxPro environment is sandbox.
  return TAXPRO_SANDBOX_TEST_GSTIN_RE.test(gstin);
}

export type GstinLookupDetails = {
  gstin: string;
  valid: boolean;
  source: 'provider' | 'local';
  legal_name: string | null;
  trade_name: string | null;
  status: string | null;
  taxpayer_type: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  state_code: string | null;
  state: string | null;
  raw: Record<string, unknown>;
};

export async function lookupGstinDetails(input: string): Promise<GstinLookupDetails> {
  const gstin = String(input || '').replace(/\s+/g, '').toUpperCase();
  const stateCode = stateCodeFromGstin(gstin);
  const state = stateCode ? STATE_NAMES[stateCode] || null : null;
  const isChecksumValidGstin = GSTIN_RE.test(gstin) && isValidGstinChecksum(gstin);
  const isSandboxTestGstin = isTaxProSandboxTestGstin(gstin);
  if (!isChecksumValidGstin && !isSandboxTestGstin) {
    throw new Error('Invalid GSTIN format or checksum');
  }

  if (isSandboxTestGstin) {
    return {
      gstin,
      valid: true,
      source: 'local',
      legal_name: 'TaxPro Sandbox Test Company',
      trade_name: 'TaxPro Sandbox',
      status: 'Active',
      taxpayer_type: 'Regular',
      address: null,
      city: null,
      pincode: null,
      state_code: stateCode,
      state,
      raw: {
        note: 'TaxPro sandbox test GSTIN accepted without production checksum validation.',
        sandbox: true,
      },
    };
  }

  if (env.GSTIN_LOOKUP_API_URL) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (env.GSTIN_LOOKUP_API_KEY) {
      headers[env.GSTIN_LOOKUP_API_KEY_HEADER] =
        env.GSTIN_LOOKUP_API_KEY_HEADER.toLowerCase() === 'authorization'
          ? `Bearer ${env.GSTIN_LOOKUP_API_KEY}`
          : env.GSTIN_LOOKUP_API_KEY;
    }
    const url = env.GSTIN_LOOKUP_API_URL.includes('{gstin}')
      ? env.GSTIN_LOOKUP_API_URL.replace('{gstin}', encodeURIComponent(gstin))
      : `${env.GSTIN_LOOKUP_API_URL.replace(/\/$/, '')}/${encodeURIComponent(gstin)}`;
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`GSTIN lookup failed (${response.status})`);
    const raw = await response.json();
    const address = extractAddress(raw);
    const city = extractCity(raw);
    const pincode = extractPincode(raw, address);
    const providerState = pickProviderField(raw, [
      'state',
      'state_name',
      'stateName',
      'stj',
      'data.state',
      'data.state_name',
      'data.stateName',
      'pradr.addr.stcd',
      'data.pradr.addr.stcd',
      'result.pradr.addr.stcd',
      'taxpayer.pradr.addr.stcd',
    ]);
    return {
      gstin,
      valid: true,
      source: 'provider',
      legal_name: pickProviderField(raw, ['legal_name', 'legalName', 'lgnm', 'data.legal_name', 'data.legalName', 'data.lgnm', 'result.lgnm', 'taxpayer.lgnm']),
      trade_name: pickProviderField(raw, ['trade_name', 'tradeName', 'tradeNam', 'data.trade_name', 'data.tradeName', 'data.tradeNam', 'result.tradeNam', 'taxpayer.tradeNam']),
      status: pickProviderField(raw, ['status', 'sts', 'data.status', 'data.sts', 'result.sts', 'taxpayer.sts']),
      taxpayer_type: pickProviderField(raw, ['taxpayer_type', 'taxpayerType', 'dty', 'ctb', 'data.taxpayer_type', 'data.taxpayerType', 'data.dty', 'data.ctb', 'result.dty', 'taxpayer.dty']),
      address,
      city,
      pincode,
      state_code: stateCode,
      state: providerState || state,
      raw: raw as Record<string, unknown>,
    };
  }

  return {
    gstin,
    valid: true,
    source: 'local',
    legal_name: null,
    trade_name: null,
    status: null,
    taxpayer_type: null,
    address: null,
    city: null,
    pincode: null,
    state_code: stateCode,
    state,
    raw: { note: 'Local GSTIN format, checksum, and state-code validation only. Configure GSTIN_LOOKUP_API_URL for live registry details.' },
  };
}

export function determineGSTType(supplierStateCode: string, buyerStateCode: string): 'intra' | 'inter' {
  if (!supplierStateCode || !buyerStateCode) return 'intra'; // fallback
  return supplierStateCode === buyerStateCode ? 'intra' : 'inter';
}

/** First two characters of GSTIN are the state code (e.g. 27 = Maharashtra). */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  const g = (gstin || '').trim().toUpperCase();
  if (g.length < 2) return null;
  const a = g.charCodeAt(0);
  const b = g.charCodeAt(1);
  if (a >= 48 && a <= 57 && b >= 48 && b <= 57) return g.slice(0, 2);
  return null;
}

export type ExpenseGstBreakdown = {
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  gst_amount: number;
  total_amount: number;
};

/**
 * Expense / purchase voucher: amounts in paise.
 * If `amountIncludesGst`, `inputAmountPaise` is the total paid (tax-inclusive); stored taxable is derived.
 * Otherwise `inputAmountPaise` is taxable value (GST extra), matching sales line-item logic.
 */
export function calculateExpenseGstBreakdown(
  inputAmountPaise: number,
  gstRate: number,
  gstType: 'intra' | 'inter',
  amountIncludesGst: boolean
): ExpenseGstBreakdown {
  const rate = Math.max(0, Math.min(100, Math.round(Number(gstRate) || 0)));
  const input = Math.max(0, Math.round(Number(inputAmountPaise) || 0));

  if (input === 0) {
    return {
      taxable_amount: 0,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: 0,
      gst_amount: 0,
      total_amount: 0,
    };
  }

  if (rate === 0) {
    return {
      taxable_amount: input,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: 0,
      gst_amount: 0,
      total_amount: input,
    };
  }

  if (amountIncludesGst) {
    const total = input;
    const taxable = Math.round((total * 100) / (100 + rate));
    const gstAmount = total - taxable;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (gstType === 'intra') {
      cgst = Math.round(gstAmount / 2);
      sgst = gstAmount - cgst;
    } else {
      igst = gstAmount;
    }
    return {
      taxable_amount: taxable,
      cgst_amount: cgst,
      sgst_amount: sgst,
      igst_amount: igst,
      gst_amount: gstAmount,
      total_amount: total,
    };
  }

  const line = calculateLineItemTax(input, 1, 'none', 0, rate, gstType, 0);
  const gstAmt = line.cgst + line.sgst + line.igst;
  return {
    taxable_amount: line.taxableAmount,
    cgst_amount: line.cgst,
    sgst_amount: line.sgst,
    igst_amount: line.igst,
    gst_amount: gstAmt,
    total_amount: line.totalAmount,
  };
}

export function calculateLineItemTax(
  unitPrice: number,
  quantity: number,
  discountType: 'percent' | 'flat' | 'none',
  discountValue: number,
  gstRate: number,
  gstType: 'intra' | 'inter',
  cessRate: number = 0,
  pricingModeOrInclusive: 'inclusive' | 'exclusive' | boolean = 'exclusive'
) {
  let baseAmount = 0;
  const isInclusive = pricingModeOrInclusive === 'inclusive' || pricingModeOrInclusive === true;
  if (isInclusive) {
    const divisor = 1 + (gstRate + cessRate) / 100;
    const taxableUnitPrice = unitPrice / divisor;
    baseAmount = Math.round(taxableUnitPrice * quantity);
  } else {
    baseAmount = Math.round(unitPrice * quantity);
  }

  let discountAmount = 0;

  if (discountType === 'percent') {
    discountAmount = Math.round((baseAmount * discountValue) / 100);
  } else if (discountType === 'flat') {
    discountAmount = discountValue;
  }

  const taxableAmount = Math.max(0, baseAmount - discountAmount);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  const gstAmount = Math.round((taxableAmount * gstRate) / 100);

  if (gstType === 'intra') {
    cgst = Math.round(gstAmount / 2);
    sgst = gstAmount - cgst; // handle uneven rounding properly
  } else {
    igst = gstAmount;
  }

  const cessAmount = Math.round((taxableAmount * cessRate) / 100);
  const totalAmount = taxableAmount + cgst + sgst + igst + cessAmount;

  return {
    baseAmount,
    discountAmount,
    taxableAmount,
    cgst,
    sgst,
    igst,
    cessAmount,
    totalAmount,
  };
}

export function convertPrice(
  price: number,
  gstRate: number,
  itemIncludesTax: boolean,
  invoiceMode: 'inclusive' | 'exclusive',
  cessRate: number = 0
): number {
  const rate = (gstRate + cessRate) / 100;

  if (invoiceMode === 'inclusive') {
    return itemIncludesTax ? price : price * (1 + rate);
  }

  if (invoiceMode === 'exclusive') {
    return itemIncludesTax ? price / (1 + rate) : price;
  }
  return price;
}

export function getConvertedPrice(
  price: number,
  itemIncludesTax: boolean,
  invoicePricingMode: 'inclusive' | 'exclusive',
  gstRate: number,
  cessRate: number = 0
): number {
  const converted = convertPrice(price, gstRate, itemIncludesTax, invoicePricingMode, cessRate);
  if (invoicePricingMode === 'inclusive') {
    return Number.isFinite(converted) ? Math.round(converted / 100) * 100 : Math.round(price / 100) * 100;
  }
  return Number.isFinite(converted) ? Math.round(converted) : Math.round(price);
}

export type TaxComponent = {
  type: 'CGST' | 'SGST' | 'IGST' | 'CESS' | 'OTHER' | string;
  rate: number;
};

export function resolveTaxComponentRates(
  itemGstRate: number,
  itemCessRate: number,
  components: TaxComponent[] | undefined,
  gstType: 'intra' | 'inter',
) {
  const valid = (Array.isArray(components) ? components : [])
    .map((component) => ({
      type: String(component?.type || '').trim().toUpperCase(),
      rate: Math.max(0, Number(component?.rate) || 0),
    }))
    .filter((component) => component.type && component.rate > 0);

  if (!valid.length) {
    return gstType === 'inter'
      ? { cgstRate: 0, sgstRate: 0, igstRate: itemGstRate, cessRate: itemCessRate }
      : {
          cgstRate: itemGstRate / 2,
          sgstRate: itemGstRate - itemGstRate / 2,
          igstRate: 0,
          cessRate: itemCessRate,
        };
  }

  const sum = (types: string[]) =>
    valid
      .filter((component) => types.includes(component.type))
      .reduce((total, component) => total + component.rate, 0);
  const cgstRate = sum(['CGST']);
  const sgstRate = sum(['SGST']);
  const igstRate = sum(['IGST']);
  const otherTaxRate = sum(['OTHER']);
  const cessRate = itemCessRate + sum(['CESS']) + otherTaxRate;
  const componentGstRate = cgstRate + sgstRate + igstRate;
  const fallbackGstRate = componentGstRate || itemGstRate;

  if (gstType === 'inter') {
    return {
      cgstRate: 0,
      sgstRate: 0,
      igstRate: igstRate > 0 ? igstRate : fallbackGstRate,
      cessRate,
    };
  }

  if (cgstRate > 0 || sgstRate > 0) {
    return { cgstRate, sgstRate, igstRate: 0, cessRate };
  }

  return {
    cgstRate: fallbackGstRate / 2,
    sgstRate: fallbackGstRate - fallbackGstRate / 2,
    igstRate: 0,
    cessRate,
  };
}

export function calculateInvoiceTotals(
  items: Array<{
    unit_price: number;
    quantity: number;
    discount_type?: 'percent' | 'flat' | 'none';
    discount_value?: number;
    gst_rate: number;
    cess_rate?: number;
    price_includes_tax?: boolean;
    tax_components?: TaxComponent[];
  }>,
  gstType: 'intra' | 'inter',
  invoiceDiscountType: 'percent' | 'flat' | 'none' = 'none',
  invoiceDiscountValue: number = 0,
  tcsRate: number = 0,
  roundOffEnabled: boolean = true,
  pricingMode: 'inclusive' | 'exclusive' = 'exclusive',
  roundOffType: 'NEAREST' | 'FLOOR' | 'CEIL' = 'NEAREST',
  roundOffTo: 1 | 10 | 100 = 1,
) {
  let subtotal = 0;
  let totalDiscountLineLevel = 0;

  const processedItems = items.map((item) => {
    const rates = resolveTaxComponentRates(
      Number(item.gst_rate) || 0,
      Number(item.cess_rate) || 0,
      item.tax_components,
      gstType,
    );
    const gstRate = rates.cgstRate + rates.sgstRate + rates.igstRate;
    const cessRate = rates.cessRate;
    const totalRate = gstRate + cessRate;
    const qty = Number(item.quantity) || 0;

    const convertedPrice = convertPrice(
      Number(item.unit_price) || 0,
      gstRate,
      item.price_includes_tax === true,
      pricingMode,
      cessRate
    );

    let rawDiscount = 0;
    if (item.discount_type === 'percent') {
      const storedBase = item.price_includes_tax === true ? (item.unit_price / (1 + totalRate / 100)) : item.unit_price;
      rawDiscount = ((storedBase * qty) * (item.discount_value || 0)) / 100;
    } else if (item.discount_type === 'flat') {
      rawDiscount = item.discount_value || 0;
    }

    const convertedDiscount = convertPrice(
      rawDiscount,
      gstRate,
      item.price_includes_tax === true,
      pricingMode,
      cessRate
    );

    const subtotal_row = convertedPrice * qty;
    const lineDiscount_row = convertedDiscount;

    subtotal += subtotal_row;
    totalDiscountLineLevel += lineDiscount_row;

    return {
      subtotal_row,
      lineDiscount_row,
      gstRate,
      totalRate,
      ...rates,
    };
  });

  const taxableBeforeInvoiceDiscount = Math.max(0, subtotal - totalDiscountLineLevel);
  let globalDiscountAmount = 0;
  if (invoiceDiscountType === 'percent') {
    globalDiscountAmount = (taxableBeforeInvoiceDiscount * (Number(invoiceDiscountValue) || 0)) / 100;
  } else if (invoiceDiscountType === 'flat') {
    globalDiscountAmount = Math.min(Number(invoiceDiscountValue) || 0, taxableBeforeInvoiceDiscount);
  }
  globalDiscountAmount = Math.max(0, Math.min(globalDiscountAmount, taxableBeforeInvoiceDiscount));

  const taxableAfterDiscount = taxableBeforeInvoiceDiscount - globalDiscountAmount;

  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalCess = 0;

  for (const item of processedItems) {
    const invoiceDiscount_row = taxableBeforeInvoiceDiscount > 0
      ? globalDiscountAmount * (item.subtotal_row - item.lineDiscount_row) / taxableBeforeInvoiceDiscount
      : 0;
    const taxableAfterDiscount_row = Math.max(0, item.subtotal_row - item.lineDiscount_row - invoiceDiscount_row);

    let baseTax_row = 0;
    if (pricingMode === 'inclusive') {
      baseTax_row = taxableAfterDiscount_row - taxableAfterDiscount_row / (1 + item.totalRate / 100);
    } else {
      baseTax_row = taxableAfterDiscount_row * (item.totalRate / 100);
    }

    const baseCgst_row = item.totalRate > 0 ? baseTax_row * item.cgstRate / item.totalRate : 0;
    const baseSgst_row = item.totalRate > 0 ? baseTax_row * item.sgstRate / item.totalRate : 0;
    const baseIgst_row = item.totalRate > 0 ? baseTax_row * item.igstRate / item.totalRate : 0;
    const baseCess_row = item.totalRate > 0 ? baseTax_row * item.cessRate / item.totalRate : 0;

    totalCgst += baseCgst_row;
    totalSgst += baseSgst_row;
    totalIgst += baseIgst_row;
    totalCess += baseCess_row;
  }

  let finalTaxable = 0;
  let finalTotal = 0;

  if (pricingMode === 'inclusive') {
    finalTotal = taxableAfterDiscount;
    finalTaxable = taxableAfterDiscount - (totalCgst + totalSgst + totalIgst + totalCess);
  } else {
    finalTaxable = taxableAfterDiscount;
    finalTotal = taxableAfterDiscount + totalCgst + totalSgst + totalIgst + totalCess;
  }

  const tcsAmount = (finalTotal * (Number(tcsRate) || 0)) / 100;
  const finalTotalWithTcs = finalTotal + tcsAmount;

  const roundUnitPaise = Math.max(1, Number(roundOffTo) || 1) * 100;
  const roundOperation = roundOffType === 'FLOOR'
    ? Math.floor
    : roundOffType === 'CEIL'
      ? Math.ceil
      : Math.round;
  const roundedAmountPaise = roundOffEnabled
    ? roundOperation(finalTotalWithTcs / roundUnitPaise) * roundUnitPaise
    : finalTotalWithTcs;
  const roundOff = roundOffEnabled ? roundedAmountPaise - finalTotalWithTcs : 0;

  const safeVal = (v: number) => (Number.isFinite(v) && !Number.isNaN(v) ? Math.round(v) : 0);

  return {
    subtotal: safeVal(subtotal),
    totalDiscountLineLevel: safeVal(totalDiscountLineLevel),
    globalDiscountAmount: safeVal(globalDiscountAmount),
    totalDiscount: safeVal(totalDiscountLineLevel + globalDiscountAmount),
    totalTaxable: safeVal(finalTaxable),
    totalCgst: safeVal(totalCgst),
    totalSgst: safeVal(totalSgst),
    totalIgst: safeVal(totalIgst),
    totalCess: safeVal(totalCess),
    totalTax: safeVal(totalCgst + totalSgst + totalIgst + totalCess),
    tcsAmount: safeVal(tcsAmount),
    roundOff: safeVal(roundOff),
    totalAmount: safeVal(roundedAmountPaise),
  };
}
