import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { sendWhatsApp, sendBulkWhatsApp } from '../services/notificationService';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { env } from '../config/env';

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

    const phone = String(inv.party_phone || '').replace(/\s+/g, '');
    if (!phone) {
      return res.status(400).json(error('Party has no phone number. Add a mobile number to the customer record.'));
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
    const overdue = await query(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, i.balance_due,
              COALESCE(p.name, i.party_name_snapshot) AS party_name, p.phone AS party_phone,
              c.name AS company_name, c.phone AS company_phone
       FROM invoices i
       LEFT JOIN parties p ON p.id = i.party_id AND p.company_id = i.company_id
       JOIN companies c ON c.id = i.company_id AND c.is_deleted = false
       WHERE i.company_id = $1
         AND i.is_deleted = false
         AND i.status != 'cancelled'
         AND i.payment_status IN ('unpaid', 'partially_paid', 'overdue')
         AND i.balance_due > 0
         AND COALESCE(i.due_date, i.invoice_date) < CURRENT_DATE`,
      [req.user!.company_id],
    );

    const messages: {
      phone: string;
      template_type: string;
      variables: Record<string, string>;
      companyId: string;
    }[] = [];

    for (const row of overdue.rows) {
      const ph = String(row.party_phone || '').replace(/\s+/g, '');
      if (!ph) continue;
      const invDate =
        row.invoice_date instanceof Date
          ? row.invoice_date.toLocaleDateString('en-IN')
          : String(row.invoice_date);
      const dueDate = row.due_date
        ? row.due_date instanceof Date
          ? row.due_date.toLocaleDateString('en-IN')
          : String(row.due_date)
        : '—';
      messages.push({
        phone: ph,
        template_type: 'PAYMENT_REMINDER',
        companyId: req.user!.company_id,
        variables: {
          party_name: row.party_name,
          company_name: row.company_name,
          invoice_number: row.invoice_number,
          date: invDate,
          due_date: dueDate,
          amount: (Number(row.balance_due || 0) / 100).toFixed(2),
          phone: String(row.company_phone || ''),
        },
      });
    }

    const results = messages.length ? await sendBulkWhatsApp(messages) : [];
    res.json(
      success({
        overdue_invoices: overdue.rows.length,
        reminders_sent: messages.length,
        skipped_no_phone: overdue.rows.length - messages.length,
        results,
      }),
    );
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
