import { Job } from 'bullmq';
import { query } from '../../config/db';
import { withJobRunTracking } from '../jobRunTracking';

export async function processDailyAbsenceMarker(job: Job) {
  return withJobRunTracking(job, async () => {
    const today = new Date().toISOString().split('T')[0];
    const companies = await query(`SELECT id FROM companies WHERE is_deleted = false`);

    let marked = 0;
    for (const { id: companyId } of companies.rows) {
      const result = await query(
        `INSERT INTO attendance (company_id, user_id, date, status)
         SELECT u.company_id, u.id, $2::date, 'absent'
         FROM users u
         WHERE u.company_id = $1 AND u.is_active = true
           AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.user_id = u.id AND a.date = $2::date)
           AND NOT EXISTS (
             SELECT 1 FROM leave_applications la
             WHERE la.user_id = u.id AND la.status = 'approved' AND la.is_deleted = false
               AND $2::date BETWEEN la.from_date AND la.to_date
           )
         RETURNING id`,
        [companyId, today],
      );
      marked += result.rowCount || 0;
    }

    return { companiesProcessed: companies.rows.length, attendanceRowsMarked: marked };
  });
}
