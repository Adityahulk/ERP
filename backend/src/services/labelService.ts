import puppeteer from 'puppeteer';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bwipjs = require('bwip-js');

async function getBarcodeDataUri(barcodeText: string): Promise<string> {
  try {
    const options: any = {
      bcid: 'code128',
      text: barcodeText || 'N/A',
      scale: 2,
      height: 12,
      includetext: false,
    };
    // Barcode is ALWAYS generated horizontally — never rotated.
    // Vertical label mode only changes the text layout, not the barcode.
    const png = await bwipjs.toBuffer(options);
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return '';
  }
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Returns CSS font-size for a line based on character count. */
function lineFontSize(text: string, baseSize = 11): string {
  const len = (text || '').length;
  if (len <= 20) return `${baseSize}px`;
  if (len <= 35) return `${Math.max(7, baseSize - 2)}px`;
  return `${Math.max(6, baseSize - 4)}px`;
}

type LabelItem = {
  name: string;
  sku: string;
  selling_price: string | number;
  gst_rate: number;
  company_name: string;
  barcodeUri: string;
  // Overrides from Label Editor
  label_brand?: string;
  label_line1?: any;
  label_line2?: any;
  label_line3?: any;
  label_line4?: any;
  label_line5?: any;
  label_line6?: any;
  price?: any;
  currency?: string;
  showBarcode?: boolean;
  showBarcodeText?: boolean;
};

function renderFieldBackend(
  field: any,
  currency: string = 'INR',
  isPreview: boolean = false
): { text: string; css: string; styleType: string } | null {
  if (!field) return null;

  let val = '';
  let type = 'plain';
  let style = 'normal';
  let format = { bold: false, italic: false, underline: false };
  let placeholder = '';
  let align = 'center';

  if (typeof field === 'string') {
    val = field;
  } else if (typeof field === 'object' && field !== null) {
    val = field.value ?? '';
    type = field.type || 'plain';
    style = field.style || 'normal';
    format = field.format || { bold: false, italic: false, underline: false };
    placeholder = field.placeholder || '';
    align = field.align || 'center';
  }

  if (style === 'empty') return null;

  // Placeholder system (never shown during PDF renders unless isPreview is true)
  if (!val) {
    if (isPreview && placeholder) {
      return {
        text: placeholder,
        css: `color: #aaa; font-style: italic; text-align: ${align}`,
        styleType: style,
      };
    }
    return null;
  }

  let displayText = val;
  if (type === 'currency') {
    const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₹';
    displayText = `${symbol}${val}`;
  }

  const cssStyles: string[] = [`text-align: ${align}`];
  if (style === 'cross') {
    cssStyles.push('color: gray');
  }

  const decorations: string[] = [];
  if (style === 'cross') {
    decorations.push('line-through');
  }
  if (format.underline) {
    decorations.push('underline');
  }
  if (decorations.length > 0) {
    cssStyles.push(`text-decoration: ${decorations.join(' ')}`);
  }

  if (format.bold) {
    cssStyles.push('font-weight: bold');
  }
  if (format.italic) {
    cssStyles.push('font-style: italic');
  }

  return {
    text: displayText,
    css: cssStyles.join('; '),
    styleType: style,
  };
}

const PRINTER_PROFILES = {
  THERMAL_58: { width: 58, height: 40 },
  THERMAL_80: { width: 80, height: 50 },
  LABEL_100x50: { width: 100, height: 50 },
  LABEL_116x40: { width: 116, height: 40 },
  LABEL_100x100: { width: 100, height: 100 },
  LABEL_50x25: { width: 50, height: 25 },
};

function getPriceFontSize(priceText: string): string {
  const len = (priceText || '').length;
  if (len <= 8) return '4.5mm';
  if (len <= 10) return '4mm';
  if (len <= 12) return '3.5mm';
  if (len <= 14) return '3mm';
  return '2.5mm';
}

/** Render a single label. `density` controls how aggressively we shrink/hide content for tight grids. */
function labelCard(
  i: LabelItem,
  widthPx: string,
  heightPx: string,
  density: 'roomy' | 'compact' | 'tight' = 'roomy',
  orientation?: 'horizontal' | 'vertical'
) {
  const showCompany = density !== 'tight';
  const currency = i.currency || 'INR';

  // Use label_brand when explicitly provided (even empty string overrides DB company name).
  // Fall back to company_name only when label_brand is null/undefined.
  const brandLine = (i.label_brand != null ? i.label_brand : i.company_name) || '';
  const barcodeValue = i.sku || 'N/A';

  const r1 = renderFieldBackend(i.label_line1 ?? i.name, currency);
  const r2 = renderFieldBackend(i.label_line2, currency);
  const r3 = renderFieldBackend(i.label_line3, currency);
  const r4 = renderFieldBackend(i.label_line4, currency);
  const r5 = renderFieldBackend(i.label_line5, currency);
  const r6 = renderFieldBackend(i.label_line6, currency);

  let priceField = i.price;
  if (!priceField && i.selling_price !== undefined) {
    priceField = {
      value: (Number(i.selling_price) / 100).toFixed(2),
      type: 'currency',
      style: 'normal',
      format: { bold: true, italic: false, underline: false },
      align: 'center',
      placeholder: 'Price'
    };
  }
  const rPrice = renderFieldBackend(priceField, currency);

  const isBarcodeOnly =
    (!r1 || r1.styleType === 'empty') &&
    (!r2 || r2.styleType === 'empty') &&
    (!r3 || r3.styleType === 'empty') &&
    (!r4 || r4.styleType === 'empty') &&
    (!r5 || r5.styleType === 'empty') &&
    (!r6 || r6.styleType === 'empty') &&
    (!rPrice || rPrice.styleType === 'empty');

  const showBc = i.showBarcode !== false || isBarcodeOnly;

  const gridCells = [
    { key: 'line1', res: r1 },
    { key: 'line2', res: r2 },
    { key: 'line3', res: r3 },
    { key: 'line4', res: r4 },
    { key: 'line5', res: r5 },
    { key: 'line6', res: r6 }
  ].map((item) => {
    if (!item.res) {
      return '<div style="min-width: 0;"></div>';
    }
    return `<div class="label-grid-cell" style="${item.res.css}">${esc(item.res.text)}</div>`;
  }).join('\n');

  const gridHtml = !isBarcodeOnly ? `
    <div class="label-grid">
      ${gridCells}
    </div>` : '';

  const priceHtml = (!isBarcodeOnly && rPrice) ? `
    <div class="label-price" style="${rPrice.css}; font-size: ${getPriceFontSize(rPrice.text)}">
      ${esc(rPrice.text)}
    </div>` : '';

  const brandHtml = !isBarcodeOnly && showCompany && brandLine ? `
    <div style="width: 100%; font-size: 2.8mm; font-weight: bold; color: #555; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 0.6mm;">
      ${esc(brandLine)}
    </div>` : '';

  const barcodeHtml = showBc ? `
    <div class="barcode-wrapper">
      ${i.barcodeUri ? `<img src="${i.barcodeUri}" style="display: block; width: 100%; max-width: 100%; height: 8mm; margin: 0 auto; object-fit: contain;" />` : ''}
      ${i.showBarcodeText !== false ? `<div style="font-size: 2.5mm; color: #555; margin-top: 0.3mm; text-align: center;">${esc(barcodeValue)}</div>` : ''}
    </div>` : '';

  const topSectionHtml = `<div class="top-section">${brandHtml}${gridHtml}</div>`;
  const middleSectionHtml = priceHtml ? `<div class="middle-section">${priceHtml}</div>` : '';
  const bottomSectionHtml = barcodeHtml ? `<div class="bottom-section">${barcodeHtml}</div>` : '';

  return `
    <div class="label-card density-${density}" style="position: relative; width: ${widthPx}; height: ${heightPx};">
      ${topSectionHtml}
      ${middleSectionHtml}
      ${bottomSectionHtml}
    </div>`;
}

function fontFor(text: string, base: number): number {
  const l = (text || '').length;
  if (l <= 20) return base;
  if (l <= 35) return Math.max(7, base - 2);
  return Math.max(6, base - 4);
}

function renderDynamicTemplateCard(
  template: any,
  item: any,
  barcodeUri: string,
  widthPx: string,
  heightPx: string,
  orientation?: 'horizontal' | 'vertical'
): string {
  const currency = item.currency || 'INR';

  const data = {
    // Use label_brand when explicitly provided; fall back to company_name only when null/undefined.
    brandName: (item.label_brand != null ? item.label_brand : item.company_name) ?? '',
    line1: item.label_line1 ?? item.name ?? '',
    line2: item.label_line2 ?? '',
    line3: item.label_line3 ?? '',
    line4: item.label_line4 ?? '',
    line5: item.label_line5 ?? '',
    line6: item.label_line6 ?? '',
    barcodeValue: item.barcodeValue ?? item._smart_barcode_str ?? item.barcode ?? item.sku ?? '',
  };

  const r1 = renderFieldBackend(data.line1, currency) ?? renderFieldBackend(item.name, currency);
  const r2 = renderFieldBackend(data.line2, currency);
  const r3 = renderFieldBackend(data.line3, currency);
  const r4 = renderFieldBackend(data.line4, currency);
  const r5 = renderFieldBackend(data.line5, currency);
  const r6 = renderFieldBackend(data.line6, currency);

  let priceField = item.price;
  if (!priceField && item.selling_price !== undefined) {
    priceField = {
      value: (Number(item.selling_price) / 100).toFixed(2),
      type: 'currency',
      style: 'normal',
      format: { bold: true, italic: false, underline: false },
      align: 'center',
      placeholder: 'Price'
    };
  }
  const rPrice = renderFieldBackend(priceField, currency);

  // Check barcode-only mode
  const isBarcodeOnly =
    (!r1 || r1.styleType === 'empty') &&
    (!r2 || r2.styleType === 'empty') &&
    (!r3 || r3.styleType === 'empty') &&
    (!r4 || r4.styleType === 'empty') &&
    (!r5 || r5.styleType === 'empty') &&
    (!r6 || r6.styleType === 'empty') &&
    (!rPrice || rPrice.styleType === 'empty');

  const showBc = item.showBarcode !== false || isBarcodeOnly;

  const gridCells = [
    { key: 'line1', res: r1 },
    { key: 'line2', res: r2 },
    { key: 'line3', res: r3 },
    { key: 'line4', res: r4 },
    { key: 'line5', res: r5 },
    { key: 'line6', res: r6 }
  ].map((item) => {
    if (!item.res) {
      return '<div style="min-width: 0;"></div>';
    }
    return `<div class="label-grid-cell" style="${item.res.css}">${esc(item.res.text)}</div>`;
  }).join('\n');

  const gridHtml = !isBarcodeOnly ? `
    <div class="label-grid">
      ${gridCells}
    </div>` : '';

  const priceHtml = (!isBarcodeOnly && rPrice) ? `
    <div class="label-price" style="${rPrice.css}; font-size: ${getPriceFontSize(rPrice.text)}">
      ${esc(rPrice.text)}
    </div>` : '';

  const brandHtml = !isBarcodeOnly && data.brandName ? `
    <div style="width: 100%; font-size: 2.8mm; font-weight: bold; color: #555; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 0.6mm;">
      ${esc(data.brandName)}
    </div>` : '';

  const barcodeHtml = showBc ? `
    <div class="barcode-wrapper">
      ${barcodeUri ? `<img src="${barcodeUri}" style="display: block; width: 100%; max-width: 100%; height: 8mm; margin: 0 auto; object-fit: contain;" />` : ''}
      ${item.showBarcodeText !== false ? `<div style="font-size: 2.5mm; color: #555; margin-top: 0.3mm; text-align: center;">${esc(data.barcodeValue || 'N/A')}</div>` : ''}
    </div>` : '';

  const topSectionHtml = `<div class="top-section">${brandHtml}${gridHtml}</div>`;
  const middleSectionHtml = priceHtml ? `<div class="middle-section">${priceHtml}</div>` : '';
  const bottomSectionHtml = barcodeHtml ? `<div class="bottom-section">${barcodeHtml}</div>` : '';

  return `
    <div class="label-card dynamic-template" style="position: relative; width: ${widthPx}; height: ${heightPx};">
      ${topSectionHtml}
      ${middleSectionHtml}
      ${bottomSectionHtml}
    </div>
  `;
}

const generateHtml = (
  items: Array<LabelItem>,
  type: '58x40' | '80x50' | '100x50' | '116x40' | '100x100' | '50x25' | 'a4',
  labelsPerPage?: number,
  mode: 'general_printer' | 'label_printer' = 'general_printer',
  templateObj?: any,
  orientation?: 'horizontal' | 'vertical',
) => {
  let body = '';

  // Resolve dimensions (only needed for A4 grid cells where explicit sizing is needed)
  let widthPx = '200px';
  let heightPx = '120px';

  if (type === 'a4') {
    const requested = Number(labelsPerPage || 24);
    if (requested === 24) {
      widthPx = '175px';
      heightPx = '168px';
    } else if (requested === 40) {
      widthPx = '145px';
      heightPx = '130px';
    } else if (requested === 65) {
      widthPx = '148px';
      heightPx = '80px';
    } else {
      widthPx = '175px';
      heightPx = '168px';
    }
  }

  const renderCard = (i: LabelItem, w: string, h: string, density: 'roomy' | 'compact' | 'tight' = 'roomy') => {
    if (templateObj) {
      return renderDynamicTemplateCard(templateObj, i, i.barcodeUri, w, h, orientation);
    }
    return labelCard(i, w, h, density, orientation);
  };

  if (type === '58x40') {
    body = items.map(i =>
      `<div class="roll-page single-58">${renderCard(i, '100%', '100%', 'roomy')}</div>`
    ).join('');
  } else if (type === '80x50') {
    body = items.map(i =>
      `<div class="roll-page single-80">${renderCard(i, '100%', '100%', 'roomy')}</div>`
    ).join('');
  } else if (type === '100x50') {
    body = items.map(i =>
      `<div class="roll-page single-100">${renderCard(i, '100%', '100%', 'roomy')}</div>`
    ).join('');
  } else if (type === '50x25') {
    body = items.map(i =>
      `<div class="roll-page single-50x25">${renderCard(i, '100%', '100%', 'compact')}</div>`
    ).join('');
  } else if (type === '116x40') {
    const pages: string[] = [];
    for (let idx = 0; idx < items.length; idx += 2) {
      const pair = items.slice(idx, idx + 2);
      const firstCard = renderCard(pair[0], '100%', '100%', 'roomy');
      const secondCard = pair[1]
        ? renderCard(pair[1], '100%', '100%', 'roomy')
        : '<div style="width: 100%; height: 100%;"></div>';
      pages.push(`
        <div class="roll-page double-116">
          <div class="two-up">
            ${firstCard}
            ${secondCard}
          </div>
        </div>
      `);
    }
    body = pages.join('');
  } else if (type === '100x100') {
    // 2-up stacked: two 100×50 labels on a 100×100mm page
    const pages: string[] = [];
    for (let idx = 0; idx < items.length; idx += 2) {
      const pair = items.slice(idx, idx + 2);
      const firstCard = renderCard(pair[0], '100%', '100%', 'roomy');
      const secondCard = pair[1]
        ? renderCard(pair[1], '100%', '100%', 'roomy')
        : '<div style="width: 100%; height: 100%;"></div>';
      pages.push(`
        <div class="roll-page double-100">
          <div class="two-up-stacked">
            ${firstCard}
            ${secondCard}
          </div>
        </div>
      `);
    }
    body = pages.join('');
  } else if (type === 'a4') {
    const requested = Math.min(100, Math.max(1, Math.floor(Number(labelsPerPage || 24))));
    const preset = requested;
    const cols = preset <= 24 ? 4 : 5;
    const rows = Math.ceil(preset / cols);
    const density: 'roomy' | 'compact' | 'tight' =
      preset <= 24 ? 'roomy' : preset <= 40 ? 'compact' : 'tight';
    const a4Class = preset <= 24 ? 'a4-24' : preset <= 40 ? 'a4-40' : 'a4-60';
    const pages: string[] = [];
    for (let idx = 0; idx < items.length; idx += preset) {
      pages.push(`
        <div class="a4-grid ${a4Class}" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr);">
          ${items.slice(idx, idx + preset).map(i => renderCard(i, widthPx, heightPx, density)).join('')}
        </div>
      `);
    }
    body = pages.join('');
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * {
    box-sizing: border-box;
  }
  html, body {
    margin: 0;
    padding: 0;
    font-family: Arial, Helvetica, sans-serif;
    -webkit-print-color-adjust: exact;
  }
  @page {
    margin: 0;
  }
  div {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  .label-card {
    width: 100%;
    height: 100%;
    overflow: hidden; /* CRITICAL */
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    box-sizing: border-box;
    background: #fff;
    border: 1px dashed red; /* Debug border mode */
    padding: 2mm;
    gap: 1mm;
    page-break-inside: avoid;
    break-inside: avoid;
    flex-shrink: 0;
  }
  .top-section {
    width: 100%;
    flex: 0 1 auto;
    max-height: 55%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .middle-section {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    margin: 0.3mm 0;
    flex-shrink: 0;
  }
  .bottom-section {
    width: 100%;
    display: flex;
    justify-content: center;
    flex-shrink: 0;
  }
  .label-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.3mm;
    width: 100%;
    overflow: hidden;
    box-sizing: border-box;
  }
  /* Vertical (portrait) mode: stack lines in a single column */
  .vertical-layout .label-grid {
    grid-template-columns: 1fr;
  }
  .label-grid-cell {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    width: 100%;
    font-size: 3mm;
    line-height: 1.1;
    min-width: 0;
  }
  .label-price {
    font-weight: bold;
    white-space: nowrap;
  }
  .barcode-wrapper {
    background: #fff;
    padding: 0.6mm;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    box-sizing: border-box;
    flex-shrink: 0;
  }
  
  /* Roll labels for thermal printer */
  .roll-page {
    box-sizing: border-box;
    page-break-after: always;
    overflow: hidden;
    width: 100%;
    height: 100%;
  }
  .roll-page:last-child {
    page-break-after: avoid;
  }
  .single-58 { width: 58mm; height: 40mm; display: flex; align-items: center; justify-content: center; }
  .single-80 { width: 80mm; height: 50mm; display: flex; align-items: center; justify-content: center; }
  .single-100 { width: 100mm; height: 50mm; display: flex; align-items: center; justify-content: center; }
  .single-50x25 { width: 50mm; height: 25mm; display: flex; align-items: center; justify-content: center; }
  .double-116 { width: 116mm; height: 40mm; }
  .double-100 { width: 100mm; height: 100mm; }

  .two-up {
    display: grid;
    grid-template-columns: 1fr 1fr;
    height: 100%;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .two-up-stacked {
    display: grid;
    grid-template-rows: 1fr 1fr;
    height: 100%;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  /* A4 grid pages — gap shrinks as density rises */
  .a4-grid {
    width: 210mm;
    height: 295mm;
    box-sizing: border-box;
    padding: 8mm;
    display: grid;
    page-break-after: always;
  }
  .a4-grid:last-child {
    page-break-after: avoid;
  }
  .a4-24 { gap: 3mm; }
  .a4-40 { gap: 1.5mm; padding: 6mm; }
  .a4-60 { gap: 1mm; padding: 5mm; }
</style></head>
<body class="${orientation === 'vertical' ? 'vertical-layout' : ''}">${body}</body></html>`;
};

function formatRupees(value: string | number): string {
  const paise = Number(value || 0);
  if (!Number.isFinite(paise)) return '0.00';
  return (paise / 100).toFixed(2);
}

export async function generateLabelsPDF(
  template: '58x40' | '80x50' | '100x50' | '116x40' | '100x100' | '50x25' | 'a4',
  itemsData: any[],
  opts?: { mode?: 'general_printer' | 'label_printer'; labelsPerPage?: number; templateId?: string; orientation?: 'horizontal' | 'vertical' },
) {
  // Determine barcode source per item:
  // If item has a pre-encoded smart_barcode_str (set by the labels route), use it.
  // Otherwise fall back to the plain sku field.
  const itemsWithBarcodes = await Promise.all(
    itemsData.map(async (item) => ({
      ...item,
      barcodeUri: item.sku
        ? await getBarcodeDataUri(item._smart_barcode_str || item.sku)
        : '',
    }))
  );

  const { TEMPLATES } = await import('../templates/labelTemplates');
  const templateObj = opts?.templateId ? TEMPLATES.find(t => t.id === opts.templateId) : undefined;

  let width: string | undefined;
  let height: string | undefined;
  if (template === '58x40') {
    width = `${PRINTER_PROFILES.THERMAL_58.width}mm`;
    height = `${PRINTER_PROFILES.THERMAL_58.height}mm`;
  } else if (template === '80x50') {
    width = `${PRINTER_PROFILES.THERMAL_80.width}mm`;
    height = `${PRINTER_PROFILES.THERMAL_80.height}mm`;
  } else if (template === '100x50') {
    width = `${PRINTER_PROFILES.LABEL_100x50.width}mm`;
    height = `${PRINTER_PROFILES.LABEL_100x50.height}mm`;
  } else if (template === '116x40') {
    width = `${PRINTER_PROFILES.LABEL_116x40.width}mm`;
    height = `${PRINTER_PROFILES.LABEL_116x40.height}mm`;
  } else if (template === '100x100') {
    width = `${PRINTER_PROFILES.LABEL_100x100.width}mm`;
    height = `${PRINTER_PROFILES.LABEL_100x100.height}mm`;
  } else if (template === '50x25') {
    width = `${PRINTER_PROFILES.LABEL_50x25.width}mm`;
    height = `${PRINTER_PROFILES.LABEL_50x25.height}mm`;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    // Disable cache so the latest CSS/layout is always applied (no stale landscape styles)
    await page.setCacheEnabled(false);
    await page.setContent(generateHtml(itemsWithBarcodes, template, opts?.labelsPerPage, opts?.mode, templateObj, opts?.orientation), { waitUntil: 'domcontentloaded' });

    const pdfBuffer = await page.pdf({
      // Explicitly force portrait (landscape: false) so Puppeteer never guesses orientation.
      landscape: false,
      width: template !== 'a4' ? width : undefined,
      height: template !== 'a4' ? height : undefined,
      format: template === 'a4' ? 'A4' : undefined,
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    return pdfBuffer;
  } finally {
    await browser.close();
  }
}
