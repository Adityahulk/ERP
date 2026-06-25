import { Job } from 'bullmq';
import { query } from '../../config/db';
import { withJobRunTracking } from '../jobRunTracking';

export async function processLeaveExpiryJob(job: Job) {
  return withJobRunTracking(job, async () => {
    const result = await query(
      `UPDATE leave_applications
       SET status = 'expired', review_note = COALESCE(review_note, 'Auto-expired: start date passed without review'), reviewed_at = now()
       WHERE status = 'pending' AND is_deleted = false AND from_date < CURRENT_DATE
       RETURNING id, company_id`,
    );
    return { expiredCount: result.rowCount || 0 };
  });
}
