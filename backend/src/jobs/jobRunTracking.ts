import { Job } from 'bullmq';
import { query } from '../config/db';

/**
 * Wraps a processor's actual work with job_runs status tracking.
 * Every queue processor should call this rather than writing to
 * job_runs directly, so success/failure/duration are recorded
 * consistently for the admin monitoring dashboard.
 */
export async function withJobRunTracking<T>(
  job: Job,
  fn: () => Promise<T>,
): Promise<T> {
  const runId = job.data?._runId;
  const startedAt = Date.now();
  try {
    const result = await fn();
    if (runId) {
      await query(
        `UPDATE job_runs SET status = 'success', result = $1::jsonb, finished_at = now(), duration_ms = $2, attempt = $3 WHERE id = $4`,
        [JSON.stringify(result ?? {}), Date.now() - startedAt, job.attemptsMade + 1, runId],
      );
    }
    return result;
  } catch (err: any) {
    if (runId) {
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts || 1);
      await query(
        `UPDATE job_runs SET status = $1, error_message = $2, finished_at = now(), duration_ms = $3, attempt = $4 WHERE id = $5`,
        [isFinalAttempt ? 'dead_letter' : 'failed', err.message || String(err), Date.now() - startedAt, job.attemptsMade + 1, runId],
      );
    }
    throw err; // re-throw so BullMQ's own retry/backoff logic still runs
  }
}
