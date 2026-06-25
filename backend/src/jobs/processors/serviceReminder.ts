import { Job } from 'bullmq';
import { query } from '../../config/db';
import { sendWhatsApp } from '../../services/notificationService';
import { sendMail } from '../../services/mailer';
import { withJobRunTracking } from '../jobRunTracking';

const RECURRENCE_DAYS: Record<string, number> = { monthly: 30, quarterly: 90, yearly: 365 };

export async function processServiceReminder(job: Job) {
  return withJobRunTracking(job, async () => {
    const due = await query(
      `SELECT sr.*, p.name AS party_name, p.phone AS party_phone, p.email AS party_email, c.name AS company_name
       FROM service_reminders sr
       LEFT JOIN parties p ON p.id = sr.party_id
       JOIN companies c ON c.id = sr.company_id AND c.is_deleted = false
       WHERE sr.is_deleted = false AND sr.status = 'pending' AND sr.due_date <= CURRENT_DATE`,
    );

    let sent = 0;
    let skipped = 0;
    for (const r of due.rows) {
      try {
        if (r.channel === 'whatsapp' && r.party_phone) {
          await sendWhatsApp(r.party_phone, 'SERVICE_REMINDER', {
            message: `Reminder: ${r.title} for ${r.party_name || 'your account'} is due on ${new Date(r.due_date).toLocaleDateString('en-IN')}. ${r.notes || ''}`,
            company_name: r.company_name,
          }, r.company_id);
          sent++;
        } else if (r.channel === 'email' && r.party_email) {
          const result = await sendMail({
            to: r.party_email,
            subject: `Reminder: ${r.title}`,
            text: `${r.title} is due on ${new Date(r.due_date).toLocaleDateString('en-IN')}. ${r.notes || ''}`,
            html: `<p>${r.title} is due on ${new Date(r.due_date).toLocaleDateString('en-IN')}.</p><p>${r.notes || ''}</p>`,
          });
          if (result.delivered) sent++; else skipped++;
        } else {
          skipped++; // SMS not wired to a real provider yet, or no contact on file
          continue;
        }

        if (r.recurrence && RECURRENCE_DAYS[r.recurrence]) {
          const nextDue = new Date(r.due_date);
          nextDue.setDate(nextDue.getDate() + RECURRENCE_DAYS[r.recurrence]);
          await query(`UPDATE service_reminders SET due_date = $1, last_sent_at = now() WHERE id = $2`, [nextDue.toISOString().split('T')[0], r.id]);
        } else {
          await query(`UPDATE service_reminders SET status = 'sent', last_sent_at = now() WHERE id = $1`, [r.id]);
        }
      } catch {
        skipped++;
      }
    }

    return { dueCount: due.rows.length, sent, skipped };
  });
}
