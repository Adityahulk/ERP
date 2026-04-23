import puppeteer from 'puppeteer';

export async function generateInvoicePDF(invoiceData: any, companyData: any): Promise<Buffer> {
  // Mock implementations for now. Real implementations load huge HTML templates inside Chromium.
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  const html = `
    <html>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <h1>Tax Invoice</h1>
        <h3>${companyData.name}</h3>
        <p>Invoice #: ${invoiceData.invoice_number}</p>
        <p>Total: ${invoiceData.total_amount / 100}</p>
        <p>Generated dynamically by BizFlow Puppeteer Engine</p>
      </body>
    </html>
  `;
  
  await page.setContent(html);
  const pdfBuffer = await page.pdf({ format: 'A4' });
  await browser.close();
  
  // Puppeteer typing returns Uint8Array in exact newer versions, returning Buffer cast safely
  return Buffer.from(pdfBuffer);
}

export async function generateThermalReceipt(invoiceData: any, companyData: any): Promise<Buffer> {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  const html = `
    <html>
      <body style="font-family: monospace; width: 80mm; padding: 0; margin: 0;">
        <div style="text-align: center; font-weight: bold; font-size: 14px;">${companyData.name}</div>
        <div style="text-align: center; font-size: 10px;">${companyData.city}</div>
        <hr />
        <div>Bill: ${invoiceData.invoice_number}</div>
        <div>Total: ₹${invoiceData.total_amount / 100}</div>
        <hr />
        <div style="text-align: center;">Thank You!</div>
      </body>
    </html>
  `;
  
  await page.setContent(html);
  // Thermal paper width 80mm
  const pdfBuffer = await page.pdf({ width: '80mm', height: '200mm' });
  await browser.close();
  
  return Buffer.from(pdfBuffer);
}
