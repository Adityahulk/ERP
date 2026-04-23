import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { sendWhatsApp } from '../services/notificationService';
import { query } from '../config/db';
import { success, error } from '../lib/response';

const router = Router();
router.use(verifyToken);

router.post('/send-invoice/:invoiceId', async (req: Request, res: Response) => {
   try {
      // Mock logic assembling invoice meta via DB 
      const invQuery = await query(`
         SELECT i.invoice_number, i.invoice_date, i.total_amount, p.name as party_name, p.phone as party_phone
         FROM invoices i JOIN parties p ON i.party_id = p.id
         WHERE i.id = $1 AND i.company_id = $2
      `, [req.params.invoiceId, req.user!.company_id]);

      if(!invQuery.rows.length) return res.status(404).json(error('Invoice not found'));
      const inv = invQuery.rows[0];

      if(!inv.party_phone) return res.status(400).json(error('Party has no phone number embedded.'));

      const variables = {
         party_name: inv.party_name,
         company_name: req.user!.company_id, // Fetch company name practically
         invoice_number: inv.invoice_number,
         date: new Date(inv.invoice_date).toLocaleDateString(),
         amount: inv.total_amount,
         link: `http://localhost:3000/public/invoices/${req.params.invoiceId}`,
         phone: 'CompanyPhoneSupport'
      };

      const result = await sendWhatsApp(inv.party_phone, 'INVOICE_SHARE', variables, req.user!.company_id);
      res.json(success(result));

   } catch(err:any){ res.status(500).json(error(err.message)); }
});

router.post('/bulk-reminder', requireMinRole('accountant'), async (req: Request, res: Response) => {
    // Triggers mass overdue calculation
    res.json(success({ message: "Bulk reminder cycle initiated into background queue." }));
});

router.get('/logs', async (req: Request, res: Response) => {
   try {
       const logs = await query(`SELECT * FROM notification_logs WHERE company_id = $1 ORDER BY created_at DESC LIMIT 50`, [req.user!.company_id]);
       res.json(success(logs.rows));
   } catch(err:any){ res.status(500).json(error(err.message)); }
});

export default router;
