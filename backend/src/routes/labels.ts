import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { query } from '../config/db';
import { generateLabelsPDF } from '../services/labelService';

const router = Router();
router.use(verifyToken);

const VALID_TEMPLATES = new Set(['58x40', '100x50', 'a4']);

router.post('/bulk', async (req: Request, res: Response) => {
   try {
     const { items, size, mode, labels_per_page, templateId } = req.body; // items: [{item_id, quantity, ...label_line1-6}]
     const companyId = req.user!.company_id;

     if (!Array.isArray(items) || !items.length) {
       return res.status(400).json({ success: false, error: 'No items provided' });
     }
     const template = String(size || '58x40');
     if (!VALID_TEMPLATES.has(template)) {
       return res.status(400).json({ success: false, error: 'Invalid label size template' });
     }
     if (mode && !['general_printer', 'label_printer'].includes(String(mode))) {
       return res.status(400).json({ success: false, error: 'Invalid print mode' });
     }
     const labelsPerPageNum = Number(labels_per_page || 0);
     if (mode === 'general_printer' && labelsPerPageNum && (!Number.isInteger(labelsPerPageNum) || labelsPerPageNum < 1 || labelsPerPageNum > 100)) {
       return res.status(400).json({ success: false, error: 'General printer labels per page must be a whole number between 1 and 100' });
     }
     if (mode === 'label_printer' && labelsPerPageNum && ![1, 2].includes(labelsPerPageNum)) {
       return res.status(400).json({ success: false, error: 'Label printer supports only 1 or 2 labels per page' });
     }
     const uniqueItemIds = new Set(items.map((i: any) => i.item_id || i.sku).filter(Boolean));
     if (mode === 'label_printer' && uniqueItemIds.size > 1) {
       return res.status(400).json({ success: false, error: 'Label printer supports one item at a time' });
     }

     const printQueue = [];

     // Batch-fetch item metadata
     const ids = items.map((i: any) => i.item_id).filter(Boolean);
     if (!ids.length) return res.status(400).json({ success: false, error: 'Missing item ids in payload' });
     const [itemDetails, companyRes] = await Promise.all([
       query(
         `SELECT id, name, barcode, sku, hsn_code, selling_price, gst_rate
          FROM items
          WHERE id = ANY($1::uuid[]) AND company_id = $2`,
         [ids, companyId],
       ),
       query(`SELECT name FROM companies WHERE id = $1`, [companyId]),
     ]);
     const companyName = companyRes.rows[0]?.name || 'My Company';

     const { getOrCreateItemBarcode } = await import('../utils/barcodeUtils');

     // Generate/Get barcodes for all items in sequence
     const barcodeMap = new Map<string, string>();
     for (const id of ids) {
       try {
         const bc = await getOrCreateItemBarcode(id, companyId);
         barcodeMap.set(id, bc);
       } catch (err: any) {
         console.error(`Failed to generate barcode for item ${id}:`, err.message);
       }
     }

     for (const reqItem of items) {
       const qty = Number(reqItem.quantity || 0);
       if (!Number.isFinite(qty) || qty <= 0) continue;
       const dbMeta = itemDetails.rows.find(
         (r: { id: string }) => r.id === reqItem.item_id
       );
       if (dbMeta) {
         const itemBarcode = barcodeMap.get(dbMeta.id) || dbMeta.barcode || dbMeta.sku || 'LABEL';
         const finalBarcode = (reqItem.barcodeSource === 'custom' && reqItem.customBarcodeValue)
           ? reqItem.customBarcodeValue
           : itemBarcode;

         for (let i = 0; i < qty; i++) {
           printQueue.push({
             ...dbMeta,
             sku: finalBarcode,
             company_name: companyName,
             // Internal field: passes barcode string to labelService
             _smart_barcode_str: finalBarcode,
             // Label Editor overrides — all optional free text, no calculations
             label_brand: reqItem.label_brand  ?? undefined,
             label_line1: reqItem.label_line1  ?? undefined,
             label_line2: reqItem.label_line2  ?? undefined,
             label_line3: reqItem.label_line3  ?? undefined,
             label_line4: reqItem.label_line4  ?? undefined,
             label_line5: reqItem.label_line5  ?? undefined,
             label_line6: reqItem.label_line6  ?? undefined,
             price: reqItem.price ?? undefined,
             currency: reqItem.currency ?? 'INR',
             showBarcode: reqItem.showBarcode !== false,
             showBarcodeText: reqItem.showBarcodeText !== false,
             barcodeSource: reqItem.barcodeSource || 'system',
             customBarcodeValue: reqItem.customBarcodeValue || '',
           });
         }
       }
     }

     if (!printQueue.length) return res.status(404).json({ success: false, error: 'No valid items found' });

     const pdfBuffer = await generateLabelsPDF(template as '58x40' | '100x50' | 'a4', printQueue, {
       mode: mode === 'label_printer' ? 'label_printer' : 'general_printer',
       labelsPerPage: labelsPerPageNum || undefined,
       templateId: templateId || undefined,
     });

     res.setHeader('Content-Type', 'application/pdf');
     res.setHeader('Content-Disposition', `attachment; filename=labels-${Date.now()}.pdf`);
     res.status(200).send(pdfBuffer);
   } catch (err: any) {
     console.error('labels route error:', err.message, err.detail, err.position);
     res.status(500).json({ success: false, error: err.message || 'Failed to generate labels' });
   }
});

export default router;
