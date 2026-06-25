import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { getQueue, getDlq, QUEUE_NAMES } from '../jobs/queues';

// ── GET /api/admin/jobs/overview ─────────────────────────────────
// Live queue depths (from Redis/BullMQ) + worker health (from Postgres
// heartbeats) for every registered queue, in one call for the dashboard.
export async function getJobsOverview(req: Request, res: Response) {
  try {
    const overview = await Promise.all(
      QUEUE_NAMES.map(async (name) => {
        const q = getQueue(name);
        const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        const dlqCount = await getDlq(name).getJobCounts('waiting');
        return { queue: name, counts, deadLetterCount: dlqCount.waiting || 0 };
      }),
    );

    const heartbeats = await query(
      `SELECT * FROM worker_heartbeats WHERE last_heartbeat_at > now() - interval '10 minutes' ORDER BY queue_name`,
    );
    const HEALTHY_THRESHOLD_MS = 90_000; // 3 missed 30s heartbeats
    const workers = heartbeats.rows.map((w: any) => ({
      ...w,
      healthy: Date.now() - new Date(w.last_heartbeat_at).getTime() < HEALTHY_THRESHOLD_MS,
    }));

    res.json(success({ queues: overview, workers }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/admin/jobs/runs ──────────────────────────────────────
export async function getJobRuns(req: Request, res: Response) {
  try {
    const { queue, status, limit = 100 } = req.query;
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (queue) { conditions.push(`queue_name = $${idx++}`); params.push(queue); }
    if (status) { conditions.push(`status = $${idx++}`); params.push(status); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await query(
      `SELECT jr.*, c.name AS company_name FROM job_runs jr LEFT JOIN companies c ON c.id = jr.company_id
       ${where} ORDER BY started_at DESC LIMIT $${idx}`,
      [...params, limit],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/admin/jobs/:queue/dead-letter ────────────────────────
export async function getDeadLetterJobs(req: Request, res: Response) {
  try {
    const { queue } = req.params;
    if (!QUEUE_NAMES.includes(queue as any)) return res.status(404).json(error('Unknown queue'));
    const jobs = await getDlq(queue as any).getJobs(['waiting'], 0, 100);
    res.json(success(jobs.map((j) => ({ id: j.id, data: j.data, timestamp: j.timestamp }))));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/admin/jobs/:queue/dead-letter/:id/retry ─────────────
// Re-enqueues a dead-lettered job's ORIGINAL data back onto the live
// queue for a fresh set of attempts, then removes it from the DLQ.
export async function retryDeadLetterJob(req: Request, res: Response) {
  try {
    const { queue, id } = req.params;
    if (!QUEUE_NAMES.includes(queue as any)) return res.status(404).json(error('Unknown queue'));
    const dlq = getDlq(queue as any);
    const job = await dlq.getJob(id);
    if (!job) return res.status(404).json(error('Dead-letter job not found'));

    await getQueue(queue as any).add(queue, job.data.originalData);
    await job.remove();

    res.json(success({ retried: true }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
