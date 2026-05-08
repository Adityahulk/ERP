import puppeteer from 'puppeteer';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bwipjs = require('bwip-js');

async function getBarcodeDataUri(sku: string): Promise<string> {
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: sku || 'N/A',
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

type LabelItem = { name: string; sku: string; selling_price: string | number; gst_rate: number; company_name: string; barcodeUri: string };

/** Render a single label. `density` controls how aggressively we shrink/hide content for tight grids. */
function labelCard(i: LabelItem, density: 'roomy' | 'compact' | 'tight' = 'roomy') {
  // Tight cells (60/page) hide the company line so the item name has breathing room.
  const showCompany = density !== 'tight';
  return `
    <div class="label-card density-${density}">
      ${showCompany ? `<div class="company">${esc(i.company_name || 'My Company')}</div>` : ''}
      <div class="item-name" title="${esc(i.name)}">${esc(i.name)}</div>
      ${i.barcodeUri ? `<img class="barcode" src="${i.barcodeUri}" alt="barcode">` : ''}
      <div class="meta">
        <span class="sku">${esc(i.sku || 'N/A')}</span>
        <span class="price">&#8377;${formatRupees(i.selling_price)}</span>
      </div>
      ${density === 'roomy' ? `<div class="gst">GST ${Number(i.gst_rate || 0)}%</div>` : ''}
    </div>`;
}

const generateHtml = (
  items: Array<LabelItem>,
  type: '58x40' | '100x50' | 'a4',
  labelsPerPage?: number,
  mode: 'general_printer' | 'label_printer' = 'general_printer',
) => {
  let body = '';

  if (mode === 'label_printer' && Number(labelsPerPage) === 2) {
    const pages: string[] = [];
    for (let idx = 0; idx < items.length; idx += 2) {
      pages.push(`
        <div class="roll-page two-up">
          ${items.slice(idx, idx + 2).map((i) => labelCard(i, 'roomy')).join('')}
        </div>`);
    }
    body = pages.join('');
  } else if (type === '58x40') {
    body = items.map(i => `<div class="roll-page single-58">${labelCard(i, 'roomy')}</div>`).join('');
  } else if (type === '100x50') {
    body = items.map(i => `<div class="roll-page single-100">${labelCard(i, 'roomy')}</div>`).join('');
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
          ${items.slice(idx, idx + preset).map(i => labelCard(i, density)).join('')}
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
    border:1px dashed #bbb;
    padding:3px 4px;
    text-align:center;
    box-sizing:border-box;
    display:flex;
    flex-direction:column;
    align-items:stretch;
    justify-content:space-between;
    overflow:hidden;
    width:100%;
    height:100%;
    line-height:1.1;
  }
  .label-card .company{font-size:8px;font-weight:600;color:#555;letter-spacing:.02em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .label-card .item-name{font-weight:700;line-height:1.15;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
  .label-card .barcode{width:100%;object-fit:contain;display:block;}
  .label-card .meta{display:flex;justify-content:space-between;align-items:baseline;gap:4px;}
  .label-card .sku{font-family:monospace;color:#444;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;text-align:left;}
  .label-card .price{font-weight:700;color:#111;flex:0 0 auto;}
  .label-card .gst{font-size:8px;color:#666;}

  /* Density tiers — tighter cells get smaller fonts + barcode */
  .density-roomy   .item-name{font-size:11px;max-height:26px;}
  .density-roomy   .barcode  {height:34px;}
  .density-roomy   .sku      {font-size:8px;}
  .density-roomy   .price    {font-size:12px;}

  .density-compact .item-name{font-size:9px;max-height:22px;}
  .density-compact .barcode  {height:24px;}
  .density-compact .sku      {font-size:7px;}
  .density-compact .price    {font-size:10px;}

  .density-tight   {padding:2px 3px;}
  .density-tight   .item-name{font-size:8px;max-height:18px;-webkit-line-clamp:2;}
  .density-tight   .barcode  {height:16px;}
  .density-tight   .sku      {font-size:6.5px;}
  .density-tight   .price    {font-size:9px;}

  /* Roll labels for thermal printer */
  .roll-page{box-sizing:border-box;page-break-after:always;}
  .single-58{width:58mm;height:40mm;}
  .single-100{width:100mm;height:50mm;}
  .single-100 .item-name{font-size:14px;max-height:34px;}
  .single-100 .barcode{height:60px;}
  .single-100 .price{font-size:18px;}
  .two-up{width:116mm;height:40mm;display:grid;grid-template-columns:1fr 1fr;}

  /* A4 grid pages — gap shrinks as density rises */
  .a4-grid{width:210mm;height:297mm;box-sizing:border-box;padding:8mm;display:grid;page-break-after:always;}
  .a4-24{gap:3mm;}
  .a4-40{gap:1.5mm;padding:6mm;}
  .a4-60{gap:1mm;padding:5mm;}
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
  opts?: { mode?: 'general_printer' | 'label_printer'; labelsPerPage?: number },
) {
  // Generate all barcodes locally (no external network calls)
  const itemsWithBarcodes = await Promise.all(
    itemsData.map(async (item) => ({
      ...item,
      barcodeUri: item.sku ? await getBarcodeDataUri(item.sku) : '',
    }))
  );

  let width: string | undefined;
  let height: string | undefined;
  if (template === '58x40') { width = '58mm'; height = '40mm'; }
  else if (template === '100x50') { width = '100mm'; height = '50mm'; }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(generateHtml(itemsWithBarcodes, template, opts?.labelsPerPage, opts?.mode), { waitUntil: 'domcontentloaded' });

    const pdfBuffer = await page.pdf({
      width: opts?.mode === 'label_printer' && opts.labelsPerPage === 2 ? '116mm' : width,
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
