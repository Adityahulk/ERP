import { Job } from 'bullmq';
import { query } from '../../config/db';
import { sendWhatsApp } from '../../services/notificationService';
import { withJobRunTracking } from '../jobRunTracking';

export async function processPaymentReminder(job: Job) {
  return withJobRunTracking(job, async () => {
    const { companyId } = job.data;

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
         AND i.payment_status IN ('unpaid', 'partial', 'partially_paid', 'overdue')
         AND i.balance_due > 0
         AND COALESCE(i.due_date, i.invoice_date) < CURRENT_DATE`,
      [companyId],
    );

    let sent = 0;
    let skipped = 0;
    for (const row of overdue.rows) {
      const phone = String(row.party_phone || '').replace(/\s+/g, '');
      if (!phone) { skipped++; continue; }
      const fmt = (d: any) => (d instanceof Date ? d.toLocaleDateString('en-IN') : String(d));
      await sendWhatsApp(phone, 'PAYMENT_REMINDER', {
        party_name: row.party_name || 'Customer',
        invoice_number: row.invoice_number,
        date: fmt(row.invoice_date),
        due_date: row.due_date ? fmt(row.due_date) : '—',
        amount: (parseInt(row.balance_due) / 100).toFixed(2),
        phone: row.company_phone || '',
        company_name: row.company_name,
      }, companyId);
      sent++;
    }

    return { overdueInvoices: overdue.rows.length, remindersSent: sent, skippedNoPhone: skipped };
  });
}
