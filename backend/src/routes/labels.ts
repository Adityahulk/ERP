import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { query } from '../config/db';
import { generateLabelsPDF } from '../services/labelService';

const router = Router();
router.use(verifyToken);

router.post('/bulk', async (req: Request, res: Response) => {
   try {
     const { items, size } = req.body; // items: [{item_id, quantity}]
     const companyId = req.user!.company_id;

     if (!items || !items.length) return res.status(400).json({ success: false, error: 'No items provided' });

     const printQueue = [];
     
     // Optimization: Batch select target items instead of looping
     // Since this is a simple implementation, fetching individually or via IN
     const ids = items.map((i:any) => i.item_id);
     const itemDetails = await query(
       `SELECT id, name, sku, hsn_code, selling_price, tax_rate as gst_rate FROM items WHERE id = ANY($1::uuid[]) AND company_id = $2`,
       [ids, companyId],
     );

     for (const reqItem of items) {
        const dbMeta = itemDetails.rows.find(
          (r: { id: string; sku: string }) => r.id === reqItem.item_id || (reqItem.sku && r.sku === reqItem.sku),
        );
        if (dbMeta) {
           for (let i = 0; i < reqItem.quantity; i++) {
              printQueue.push({ ...dbMeta, company_name: "MY ENTERPRISE" }); // Inject Company Context
           }
        }
     }

     if (!printQueue.length) return res.status(404).json({ success: false, error: 'No valid items found' });

     const pdfBuffer = await generateLabelsPDF(size || '58x40', printQueue);

     res.setHeader('Content-Type', 'application/pdf');
     res.setHeader('Content-Disposition', `attachment; filename=labels-${Date.now()}.pdf`);
     res.status(200).send(pdfBuffer);
   } catch(err:any){ res.status(500).json({ success: false, error: err.message }); }
});

export default router;
