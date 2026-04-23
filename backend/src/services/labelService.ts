import puppeteer from 'puppeteer';

const generateHtml = (items: any[], type: '58x40' | '100x50' | 'a4') => {
   let body = '';
   
   if (type === '58x40') {
      // 58mm x 40mm thermal sticker
      // 1mm = 3.77px approx. So 58mm = 219px, 40mm = 151px
      body = items.map(i => `
         <div style="width: 219px; height: 151px; border: 1px dashed #ccc; padding: 5px; box-sizing: border-box; text-align: center; page-break-after: always; display: flex; flex-direction: column; justify-content: center;">
            <div style="font-size: 8px; color: gray;">${i.company_name || 'My Company'}</div>
            <div style="font-size: 11px; font-weight: bold; overflow: hidden; max-height: 26px;">${i.name}</div>
            <div style="margin: 4px 0;"><img src="https://bwipjs-api.metafloor.com/?bcid=code128&text=${i.sku || 'N/A'}&scale=2&height=10" style="max-width: 100%; height: 50px;"></div>
            <div style="font-size: 8px; font-family: monospace;">${i.sku || 'N/A'}</div>
            <div style="font-size: 14px; font-weight: bold;">₹${i.selling_price || '0.00'} <span style="font-size:9px;color:gray;font-weight:normal;">GST:${i.gst_rate||0}%</span></div>
         </div>
      `).join('');
   } else if (type === '100x50') {
      body = items.map(i => `
         <div style="width: 377px; height: 188px; padding: 10px; text-align: center; page-break-after: always; border: 1px dashed #ccc; box-sizing: border-box;">
            <h1 style="font-size: 16px; margin-bottom: 5px;">${i.company_name || 'My Company'}</h1>
            <h2 style="font-size: 14px; margin-bottom: 10px;">${i.name}</h2>
            <img src="https://bwipjs-api.metafloor.com/?bcid=code128&text=${i.sku || 'N/A'}&scale=3&height=15" style="max-width: 100%; height: 60px;">
            <p style="font-family: monospace; font-size: 10px; margin: 2px 0;">${i.sku || 'N/A'}</p>
            <p style="font-size: 18px; font-weight: bold; margin-top: 5px;">Price: ₹${i.selling_price || '0.00'} (GST ${i.gst_rate||0}%)</p>
         </div>
      `).join('');
   } else if (type === 'a4') {
      // grid css for matching stickers
      body = `
         <div style="display: grid; grid-template-columns: repeat(4, 1fr); grid-auto-rows: 132px; gap: 3px; padding: 8px;">
            ${items.map(i => `
               <div style="border: 1px dashed #aaa; padding: 5px; text-align: center; display: flex; flex-direction: column; justify-content: space-between;">
                  <div style="font-size: 8px; font-weight: bold; overflow: hidden; white-space: nowrap;">${i.company_name || 'My Company'}</div>
                  <div style="font-size: 10px; font-weight: bold; overflow: hidden; height: 24px;">${i.name}</div>
                  <div><img src="https://bwipjs-api.metafloor.com/?bcid=code128&text=${i.sku || 'N/A'}&scale=2&height=7" style="width: 100%; height:30px"></div>
                  <div style="font-size: 12px; font-weight: bold;">₹${i.selling_price || '0.00'}</div>
               </div>
            `).join('')}
         </div>
      `;
   }

   return `
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"><style>body,html{margin:0;padding:0;font-family:sans-serif;}</style></head>
      <body>${body}</body></html>
   `;
}

export async function generateLabelsPDF(template: '58x40' | '100x50' | 'a4', itemsData: any[]) {
   let width, height;
   if(template === '58x40') { width = '58mm'; height = '40mm'; }
   else if(template === '100x50') { width = '100mm'; height = '50mm'; }
   
   const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
   const page = await browser.newPage();
   await page.setContent(generateHtml(itemsData, template), { waitUntil: 'networkidle0' });

   const pdfBuffer = await page.pdf({
      width: width,
      height: height,
      format: template === 'a4' ? 'A4' : undefined,
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 }
   });
   
   await browser.close();
   return pdfBuffer;
}
