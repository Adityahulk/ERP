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

function labelCard(i: { name: string; sku: string; selling_price: string | number; gst_rate: number; company_name: string; barcodeUri: string }, style = '') {
  return `
    <div class="label-card" style="${style}">
      <div class="company">${esc(i.company_name || 'My Company')}</div>
      <div class="item-name">${esc(i.name)}</div>
      ${i.barcodeUri ? `<img class="barcode" src="${i.barcodeUri}">` : ''}
      <div class="sku">${esc(i.sku || 'N/A')}</div>
      <div class="price">&#8377;${formatRupees(i.selling_price)} <span>GST:${Number(i.gst_rate || 0)}%</span></div>
    </div>`;
}

const generateHtml = (
  items: Array<{ name: string; sku: string; selling_price: string | number; gst_rate: number; company_name: string; barcodeUri: string }>,
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
          ${items.slice(idx, idx + 2).map((i) => labelCard(i)).join('')}
        </div>`);
    }
    body = pages.join('');
  } else if (type === '58x40') {
    body = items.map(i => `<div class="roll-page single-58">${labelCard(i)}</div>`).join('');
  } else if (type === '100x50') {
    body = items.map(i => `<div class="roll-page single-100">${labelCard(i)}</div>`).join('');
  } else if (type === 'a4') {
    const preset = [24, 40, 65].includes(Number(labelsPerPage || 0)) ? Number(labelsPerPage) : 24;
    const cols = preset === 24 ? 4 : preset === 40 ? 5 : 5;
    const rows = Math.ceil(preset / cols);
    const pages: string[] = [];
    for (let idx = 0; idx < items.length; idx += preset) {
      pages.push(`
        <div class="a4-grid" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr);">
          ${items.slice(idx, idx + preset).map(i => labelCard(i)).join('')}
        </div>
      `);
    }
    body = pages.join('');
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 0; }
  body,html{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;}
  .label-card{border:1px dashed #aaa;padding:5px;text-align:center;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;width:100%;height:100%;}
  .company{font-size:8px;font-weight:700;color:#444;overflow:hidden;white-space:nowrap;}
  .item-name{font-size:10px;font-weight:700;line-height:1.15;overflow:hidden;max-height:24px;}
  .barcode{width:100%;height:30px;object-fit:contain;}
  .sku{font-size:8px;font-family:monospace;overflow:hidden;white-space:nowrap;}
  .price{font-size:12px;font-weight:700;}
  .price span{font-size:8px;color:#666;font-weight:400;}
  .roll-page{box-sizing:border-box;page-break-after:always;}
  .single-58{width:58mm;height:40mm;}
  .single-100{width:100mm;height:50mm;}
  .single-100 .item-name{font-size:14px;max-height:34px;}
  .single-100 .barcode{height:60px;}
  .single-100 .price{font-size:18px;}
  .two-up{width:116mm;height:40mm;display:grid;grid-template-columns:1fr 1fr;}
  .a4-grid{width:210mm;height:297mm;box-sizing:border-box;padding:8mm;display:grid;gap:2mm;page-break-after:always;}
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
