import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { sendWhatsApp } from '../services/notificationService';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { env } from '../config/env';
import { enqueueJob } from '../jobs/queues';

const router = Router();
router.use(verifyToken);

router.post('/send-invoice/:invoiceId', async (req: Request, res: Response) => {
  try {
    const invQuery = await query(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.total_amount,
              COALESCE(p.name, i.party_name_snapshot) AS party_display,
              p.phone AS party_phone,
              c.name AS company_name, c.phone AS company_phone
       FROM invoices i
       LEFT JOIN parties p ON p.id = i.party_id AND p.company_id = i.company_id
       JOIN companies c ON c.id = i.company_id AND c.is_deleted = false
       WHERE i.id = $1 AND i.company_id = $2 AND i.is_deleted = false`,
      [req.params.invoiceId, req.user!.company_id],
    );

    if (!invQuery.rows.length) return res.status(404).json(error('Invoice not found'));
    const inv = invQuery.rows[0];

    const phone = String(req.body?.phone || inv.party_phone || '').replace(/\s+/g, '');
    if (!phone) {
      return res.status(400).json(error('Enter a mobile number to share this invoice.'));
    }

    const invDate =
      inv.invoice_date instanceof Date
        ? inv.invoice_date.toISOString().slice(0, 10)
        : String(inv.invoice_date).slice(0, 10);
    const amountStr = (Number(inv.total_amount || 0) / 100).toFixed(2);
    const link = `${env.FRONTEND_URL.replace(/\/$/, '')}/sales/${inv.id}`;

    const variables = {
      party_name: inv.party_display,
      company_name: inv.company_name,
      invoice_number: inv.invoice_number,
      date: invDate,
      amount: amountStr,
      link,
      phone: String(inv.company_phone || ''),
    };

    const result = await sendWhatsApp(phone, 'INVOICE_SHARE', variables, req.user!.company_id);
    res.json(success(result));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
});

router.post('/bulk-reminder', requireMinRole('accountant'), async (req: Request, res: Response) => {
  try {
    const { jobId } = await enqueueJob('paymentReminder', { companyId: req.user!.company_id }, { companyId: req.user!.company_id, priority: 1 });
    res.status(202).json(success({ queued: true, jobId }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
});

router.post('/send-reminder/:invoiceId', async (req: Request, res: Response) => {
  try {
    const invQuery = await query(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, i.balance_due,
              COALESCE(p.name, i.party_name_snapshot) AS party_display, p.phone AS party_phone,
              c.name AS company_name, c.phone AS company_phone
       FROM invoices i
       LEFT JOIN parties p ON p.id = i.party_id AND p.company_id = i.company_id
       JOIN companies c ON c.id = i.company_id AND c.is_deleted = false
       WHERE i.id = $1 AND i.company_id = $2 AND i.is_deleted = false`,
      [req.params.invoiceId, req.user!.company_id],
    );
    if (!invQuery.rows.length) return res.status(404).json(error('Invoice not found'));
    const inv = invQuery.rows[0];
    if (Number(inv.balance_due) <= 0) return res.status(400).json(error('This invoice has no outstanding balance.'));

    const phone = String(req.body?.phone || inv.party_phone || '').replace(/\s+/g, '');
    if (!phone) return res.status(400).json(error('Enter a mobile number to send the reminder to.'));

    const result = await sendWhatsApp(phone, 'PAYMENT_REMINDER', {
      party_name: inv.party_display, company_name: inv.company_name, invoice_number: inv.invoice_number,
      date: String(inv.invoice_date).slice(0, 10), due_date: inv.due_date ? String(inv.due_date).slice(0, 10) : 'on receipt',
      amount: (Number(inv.balance_due) / 100).toFixed(2), phone: String(inv.company_phone || ''),
    }, req.user!.company_id);
    res.json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
});

router.post('/send-receipt/:paymentId', async (req: Request, res: Response) => {
  try {
    const payQuery = await query(
      `SELECT pay.id, pay.payment_number, pay.payment_date, pay.amount, pay.payment_mode,
              COALESCE(p.name, 'Customer') AS party_display, p.phone AS party_phone,
              c.name AS company_name
       FROM payments pay
       LEFT JOIN parties p ON p.id = pay.party_id AND p.company_id = pay.company_id
       JOIN companies c ON c.id = pay.company_id AND c.is_deleted = false
       WHERE pay.id = $1 AND pay.company_id = $2 AND pay.is_deleted = false`,
      [req.params.paymentId, req.user!.company_id],
    );
    if (!payQuery.rows.length) return res.status(404).json(error('Payment not found'));
    const pay = payQuery.rows[0];

    const phone = String(req.body?.phone || pay.party_phone || '').replace(/\s+/g, '');
    if (!phone) return res.status(400).json(error('Enter a mobile number to send the receipt to.'));

    const result = await sendWhatsApp(phone, 'PAYMENT_RECEIPT', {
      party_name: pay.party_display, company_name: pay.company_name, payment_number: pay.payment_number || pay.id.slice(0, 8),
      date: String(pay.payment_date).slice(0, 10), amount: (Number(pay.amount) / 100).toFixed(2), payment_mode: pay.payment_mode || 'N/A',
    }, req.user!.company_id);
    res.json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
});

router.post('/whatsapp-test', async (req: Request, res: Response) => {
  try {
    const phone = String(req.body?.phone || '').replace(/\s+/g, '');
    if (!phone) return res.status(400).json(error('Enter a mobile number to send the test message to.'));

    const companyRes = await query(`SELECT name FROM companies WHERE id = $1`, [req.user!.company_id]);
    const companyName = companyRes.rows[0]?.name || 'Microtechnique';

    const result = await sendWhatsApp(
      phone,
      'CAMPAIGN_BROADCAST',
      { message: `This is a test message from ${companyName} via Microtechnique ERP. If you received this, WhatsApp sending is working correctly.` },
      req.user!.company_id,
    );
    res.json(success(result));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
});

router.get('/logs', async (req: Request, res: Response) => {
  try {
    const logs = await query(
      `SELECT * FROM notification_logs WHERE company_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user!.company_id],
    );
    res.json(success(logs.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
});

export default router;
