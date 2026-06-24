import { Job } from 'bullmq';
import { query } from '../../config/db';
import { sendMail } from '../../services/mailer';
import { withJobRunTracking } from '../jobRunTracking';

export async function processPendingLeaveReminder(job: Job) {
  return withJobRunTracking(job, async () => {
    const pending = await query(
      `SELECT la.id, la.from_date, la.to_date, la.reason, la.company_id,
              u.name AS applicant_name, c.name AS company_name
       FROM leave_applications la
       JOIN users u ON u.id = la.user_id
       JOIN companies c ON c.id = la.company_id AND c.is_deleted = false
       WHERE la.status = 'pending' AND la.is_deleted = false
         AND la.created_at < now() - interval '2 days'`,
    );

    const byCompany = new Map<string, any[]>();
    for (const row of pending.rows) {
      (byCompany.get(row.company_id) || byCompany.set(row.company_id, []).get(row.company_id))!.push(row);
    }

    let emailsSent = 0;
    for (const [companyId, items] of byCompany) {
      const admins = await query(`SELECT email FROM users WHERE company_id = $1 AND role = 'admin' AND is_active = true AND email IS NOT NULL`, [companyId]);
      const list = items.map((i: any) => `<li>${i.applicant_name}: ${i.from_date} to ${i.to_date} — ${i.reason}</li>`).join('');
      for (const admin of admins.rows) {
        const result = await sendMail({
          to: admin.email,
          subject: `${items.length} leave request(s) awaiting your review — ${items[0].company_name}`,
          html: `<p>The following leave requests have been pending for more than 2 days:</p><ul>${list}</ul>`,
          text: items.map((i: any) => `${i.applicant_name}: ${i.from_date} to ${i.to_date} — ${i.reason}`).join('\n'),
        });
        if (result.delivered) emailsSent++;
      }
    }

    return { pendingApplications: pending.rows.length, companiesNotified: byCompany.size, emailsSent };
  });
}
