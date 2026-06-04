import puppeteer from 'puppeteer';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bwipjs = require('bwip-js');

async function getBarcodeDataUri(barcodeText: string): Promise<string> {
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: barcodeText || 'N/A',
      scale: 2,
      height: 12,
      includetext: false,
    });
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

function getPriceFontSize(priceText: string): string {
  const len = (priceText || '').length;
  if (len <= 8) return '14px';
  if (len <= 10) return '13px';
  if (len <= 12) return '12px';
  if (len <= 14) return '11px';
  return '10px';
}

/** Render a single label. `density` controls how aggressively we shrink/hide content for tight grids. */
function labelCard(
  i: LabelItem,
  widthPx: string,
  heightPx: string,
  density: 'roomy' | 'compact' | 'tight' = 'roomy'
) {
  const showCompany = density !== 'tight';
  const currency = i.currency || 'INR';

  const brandLine = i.label_brand || i.company_name || '';
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
    <div style="width: 100%; font-size: 9px; font-weight: bold; color: #555; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">
      ${esc(brandLine)}
    </div>` : '';

  const barcodeHtml = showBc ? `
    <div class="barcode-wrapper">
      ${i.barcodeUri ? `<img src="${i.barcodeUri}" style="display: block; width: 80%; max-width: 150px; height: 32px; object-fit: contain;" />` : ''}
      ${i.showBarcodeText !== false ? `<div style="font-size: 8px; color: #555; margin-top: 1px; text-align: center;">${esc(barcodeValue)}</div>` : ''}
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
  heightPx: string
): string {
  const currency = item.currency || 'INR';

  const data = {
    brandName: item.label_brand ?? item.company_name ?? '',
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
    <div style="width: 100%; font-size: 9px; font-weight: bold; color: #555; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">
      ${esc(data.brandName)}
    </div>` : '';

  const barcodeHtml = showBc ? `
    <div class="barcode-wrapper">
      ${barcodeUri ? `<img src="${barcodeUri}" style="display: block; width: 80%; max-width: 150px; height: 32px; object-fit: contain;" />` : ''}
      ${item.showBarcodeText !== false ? `<div style="font-size: 8px; color: #555; margin-top: 1px; text-align: center;">${esc(data.barcodeValue || 'N/A')}</div>` : ''}
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
  type: '58x40' | '100x50' | 'a4',
  labelsPerPage?: number,
  mode: 'general_printer' | 'label_printer' = 'general_printer',
  templateObj?: any,
) => {
  let body = '';

  // Resolve dimensions
  let widthPx = '200px';
  let heightPx = '120px';

  if (type === '58x40') {
    widthPx = '210px';
    heightPx = '142px';
  } else if (type === '100x50') {
    widthPx = '368px';
    heightPx = '180px';
  } else if (type === 'a4') {
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
  } else if (templateObj) {
    widthPx = `${templateObj.width}px`;
    heightPx = `${templateObj.height}px`;
  }

  // For roll (thermal) pages, card fills its container (100% w/h via CSS)
  // widthPx/heightPx are used only for A4 grid cells where explicit sizing is needed
  const renderCard = (i: LabelItem, density: 'roomy' | 'compact' | 'tight' = 'roomy') => {
    if (templateObj) {
      return renderDynamicTemplateCard(templateObj, i, i.barcodeUri, widthPx, heightPx);
    }
    return labelCard(i, widthPx, heightPx, density);
  };

  if (type === '58x40') {
    // 1-up 58×40: card fills page exactly via 100% dims — avoids Puppeteer mm-rounding page breaks
    body = items.map(i =>
      `<div class="roll-page single-58">${templateObj
        ? renderDynamicTemplateCard(templateObj, i, i.barcodeUri, '100%', '100%')
        : labelCard(i, '100%', '100%', 'roomy')}</div>`
    ).join('');
  } else if (type === '100x50') {
    // 1-up 100×50: card fills page exactly via 100% dims
    body = items.map(i =>
      `<div class="roll-page single-100">${templateObj
        ? renderDynamicTemplateCard(templateObj, i, i.barcodeUri, '100%', '100%')
        : labelCard(i, '100%', '100%', 'roomy')}</div>`
    ).join('');
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
          ${items.slice(idx, idx + preset).map(i => renderCard(i, density)).join('')}
        </div>
      `);
    }
    body = pages.join('');
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 0; }
  body,html{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;}
  .label-card{
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    overflow: hidden;
    background: #fff;
    border: 1px dashed #bbb;
    padding: 4px;
    gap: 0px;
    page-break-inside: avoid;
    break-inside: avoid;
    /* width/height set via inline style from labelCard() — explicit mm for thermal */
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
    margin: 1px 0;
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
    gap: 1px;
    width: 100%;
    overflow: hidden;
    box-sizing: border-box;
  }
  .label-grid-cell {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    width: 100%;
    font-size: 9px;
    line-height: 1.1;
    min-width: 0;
    /* text-align is set via inline style from renderFieldBackend — user align wins */
  }
  .label-price {
    font-weight: bold;
    white-space: nowrap;
  }
  .barcode-wrapper {
    background: #fff;
    padding: 2px;
    width: 90%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    flex-shrink: 0;
  }
  .roll-page:last-child {
    page-break-after: avoid;
  }
  .a4-grid:last-child {
    page-break-after: avoid;
  }

  /* Roll labels for thermal printer */
  .roll-page{box-sizing:border-box;page-break-after:always;overflow:hidden;}
  /* single-58/100: flex container so card fills the page without mm rounding gaps */
  .single-58{width:58mm;height:40mm;overflow:hidden;display:flex;align-items:center;justify-content:center;}
  .single-100{width:100mm;height:50mm;overflow:hidden;display:flex;align-items:center;justify-content:center;}

  /* A4 grid pages — gap shrinks as density rises */
  .a4-grid{width:210mm;height:295mm;box-sizing:border-box;padding:8mm;display:grid;page-break-after:always;}
  .a4-24{gap:3mm;}
  .a4-40{gap:1.5mm;padding:6mm;}
  .a4-60{gap:1mm;padding:5mm;}

  .page {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    align-items: start;
  }
</style></head>
<body>${body}</body></html>`;
};

function formatRupees(value: string | number): string {
  const paise = Number(value || 0);
  if (!Number.isFinite(paise)) return '0.00';
  return (paise / 100).toFixed(2);
}

export async function generateLabelsPDF(
  template: '58x40' | '100x50' | 'a4',
  itemsData: any[],
  opts?: { mode?: 'general_printer' | 'label_printer'; labelsPerPage?: number; templateId?: string },
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
  if (template === '58x40') { width = '58mm'; height = '40mm'; }
  else if (template === '100x50') { width = '100mm'; height = '50mm'; }

  if (templateObj) {
    // Template mode: use template dimensions for label_printer
    if (opts?.mode === 'label_printer') {
      width = `${templateObj.width}px`;
      height = `${templateObj.height}px`;
    }
    // For general_printer, A4 page size stays as-is; template affects card content only
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(generateHtml(itemsWithBarcodes, template, opts?.labelsPerPage, opts?.mode, templateObj), { waitUntil: 'domcontentloaded' });

    const pdfBuffer = await page.pdf({
      width,
      height,
      format: template === 'a4' ? 'A4' : undefined,
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    return pdfBuffer;
  } finally {
    await browser.close();
  }
}
