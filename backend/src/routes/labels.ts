import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { query } from '../config/db';
import { generateLabelsPDF } from '../services/labelService';

const router = Router();
router.use(verifyToken);

const VALID_TEMPLATES = new Set(['58x40', '100x50', 'a4']);

router.post('/bulk', async (req: Request, res: Response) => {
   try {
     const { items, size, mode, labels_per_page } = req.body; // items: [{item_id, quantity}]
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
     if (mode === 'label_printer' && items.filter((i: any) => Number(i?.quantity || 0) > 0).length > 1) {
       return res.status(400).json({ success: false, error: 'Label printer supports one item at a time' });
     }

     const printQueue = [];
     
     // Optimization: Batch select target items instead of looping
     // Since this is a simple implementation, fetching individually or via IN
     const ids = items.map((i:any) => i.item_id).filter(Boolean);
     if (!ids.length) return res.status(400).json({ success: false, error: 'Missing item ids in payload' });
     const [itemDetails, companyRes] = await Promise.all([
      query(
        `SELECT id, name, COALESCE(barcode, sku) AS sku, hsn_code, selling_price, gst_rate
         FROM items
         WHERE id = ANY($1::uuid[]) AND company_id = $2`,
        [ids, companyId],
      ),
       query(`SELECT name FROM companies WHERE id = $1`, [companyId]),
     ]);
     const companyName = companyRes.rows[0]?.name || 'My Company';

     for (const reqItem of items) {
        const qty = Number(reqItem.quantity || 0);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const dbMeta = itemDetails.rows.find(
          (r: { id: string; sku: string }) => r.id === reqItem.item_id || (reqItem.sku && r.sku === reqItem.sku),
        );
        if (dbMeta) {
           for (let i = 0; i < qty; i++) {
              printQueue.push({ ...dbMeta, company_name: companyName });
           }
        }
     }

     if (!printQueue.length) return res.status(404).json({ success: false, error: 'No valid items found' });

     const pdfBuffer = await generateLabelsPDF(template as '58x40' | '100x50' | 'a4', printQueue, {
       mode: mode === 'label_printer' ? 'label_printer' : 'general_printer',
       labelsPerPage: labelsPerPageNum || undefined,
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
