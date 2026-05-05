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

const generateHtml = (
  items: Array<{ name: string; sku: string; selling_price: string | number; gst_rate: number; company_name: string; barcodeUri: string }>,
  type: '58x40' | '100x50' | 'a4',
  labelsPerPage?: number,
) => {
  let body = '';

  if (type === '58x40') {
    body = items.map(i => `
      <div style="width:219px;height:151px;border:1px dashed #ccc;padding:5px;box-sizing:border-box;text-align:center;page-break-after:always;display:flex;flex-direction:column;justify-content:center;">
        <div style="font-size:8px;color:gray;">${i.company_name || 'My Company'}</div>
        <div style="font-size:11px;font-weight:bold;overflow:hidden;max-height:26px;">${i.name}</div>
        <div style="margin:4px 0;">${i.barcodeUri ? `<img src="${i.barcodeUri}" style="max-width:100%;height:50px;">` : ''}</div>
        <div style="font-size:8px;font-family:monospace;">${i.sku || 'N/A'}</div>
        <div style="font-size:14px;font-weight:bold;">&#8377;${formatRupees(i.selling_price)} <span style="font-size:9px;color:gray;font-weight:normal;">GST:${i.gst_rate || 0}%</span></div>
      </div>
    `).join('');
  } else if (type === '100x50') {
    body = items.map(i => `
      <div style="width:377px;height:188px;padding:10px;text-align:center;page-break-after:always;border:1px dashed #ccc;box-sizing:border-box;">
        <h1 style="font-size:16px;margin-bottom:5px;">${i.company_name || 'My Company'}</h1>
        <h2 style="font-size:14px;margin-bottom:10px;">${i.name}</h2>
        ${i.barcodeUri ? `<img src="${i.barcodeUri}" style="max-width:100%;height:60px;">` : ''}
        <p style="font-family:monospace;font-size:10px;margin:2px 0;">${i.sku || 'N/A'}</p>
        <p style="font-size:18px;font-weight:bold;margin-top:5px;">Price: &#8377;${formatRupees(i.selling_price)} (GST ${i.gst_rate || 0}%)</p>
      </div>
    `).join('');
  } else if (type === 'a4') {
    const preset = [24, 40, 65].includes(Number(labelsPerPage || 0)) ? Number(labelsPerPage) : 24;
    const cols = preset === 24 ? 4 : preset === 40 ? 5 : 5;
    const rowHeight = preset === 24 ? 150 : preset === 40 ? 95 : 72;
    body = `
      <div style="display:grid;grid-template-columns:repeat(${cols},1fr);grid-auto-rows:${rowHeight}px;gap:3px;padding:8px;">
        ${items.map(i => `
          <div style="border:1px dashed #aaa;padding:5px;text-align:center;display:flex;flex-direction:column;justify-content:space-between;">
            <div style="font-size:8px;font-weight:bold;overflow:hidden;white-space:nowrap;">${i.company_name || 'My Company'}</div>
            <div style="font-size:10px;font-weight:bold;overflow:hidden;height:24px;">${i.name}</div>
            ${i.barcodeUri ? `<div><img src="${i.barcodeUri}" style="width:100%;height:30px;"></div>` : ''}
            <div style="font-size:8px;font-family:monospace;">${i.sku || ''}</div>
            <div style="font-size:12px;font-weight:bold;">&#8377;${formatRupees(i.selling_price)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>body,html{margin:0;padding:0;font-family:sans-serif;}</style></head>
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
    await page.setContent(generateHtml(itemsWithBarcodes, template, opts?.labelsPerPage), { waitUntil: 'domcontentloaded' });

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
