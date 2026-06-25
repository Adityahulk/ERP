import { Queue, type JobsOptions } from 'bullmq';
import { createRedisConnection } from '../config/redis';
import { query } from '../config/db';

const connection = createRedisConnection();

/**
 * Default retry policy for every queue: 5 attempts, exponential
 * backoff starting at 5s (5s, 10s, 20s, 40s, 80s). After the final
 * attempt is exhausted, the worker moves the job into a dedicated
 * `<queue>-dlq` queue (see registerWorkers.ts) rather than just
 * letting BullMQ silently mark it "failed" and forget about it.
 */
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: false, // kept until explicitly moved to DLQ or inspected
};

export const QUEUE_NAMES = [
  // Pre-existing queues — were 100% stub processors before this change.
  // (overdueInvoiceReminder and lowStockAlert were folded into
  // paymentReminder/inventoryAlert below — same job, no duplicate
  // processors for the same real-world action.)
  'dailyAbsenceMarker',
  'leaveExpiryJob',
  'pendingLeaveReminder',
  // New, real, integration-related queues.
  'integrationSync',
  'googleBusinessSync',
  'adsSync',
  'whatsappCampaign',
  'emailCampaign',
  'paymentReminder',
  'inventoryAlert',
  'autoBackup',
  'serviceReminder',
] as const;

export type QueueName = typeof QUEUE_NAMES[number];

const queues = new Map<QueueName, Queue>();
const dlqQueues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
    queues.set(name, q);
  }
  return q;
}

export function getDlq(name: QueueName): Queue {
  let q = dlqQueues.get(name);
  if (!q) {
    q = new Queue(`${name}-dlq`, { connection });
    dlqQueues.set(name, q);
  }
  return q;
}

/**
 * Enqueues a job AND writes the durable job_runs row up front (status
 * 'running'). The job_runs.id is passed back to the processor inside
 * the job payload so the processor can update the SAME row on
 * completion/failure — no separate event-listener wiring needed.
 */
export async function enqueueJob(
  name: QueueName,
  data: Record<string, any>,
  opts?: JobsOptions & { companyId?: string },
): Promise<{ jobId: string; runId: string }> {
  const runRes = await query(
    `INSERT INTO job_runs (queue_name, company_id, payload, status) VALUES ($1,$2,$3::jsonb,'running') RETURNING id`,
    [name, opts?.companyId || null, JSON.stringify(data)],
  );
  const runId = runRes.rows[0].id;

  const job = await getQueue(name).add(name, { ...data, _runId: runId }, opts);

  await query(`UPDATE job_runs SET job_id = $1 WHERE id = $2`, [job.id, runId]);
  return { jobId: job.id!, runId };
}

/** Registers (or updates) a repeatable job for "Scheduled Sync". Pass `everyMs: null` to remove the schedule. */
export async function setRepeatingJob(
  name: QueueName,
  jobKey: string,
  data: Record<string, any>,
  everyMs: number | null,
) {
  const q = getQueue(name);
  // Clear any existing repeatable registration for this jobKey first —
  // BullMQ identifies repeatables by their (name, repeat-options, id)
  // combination, so changing the frequency means removing the old one.
  const existing = await q.getRepeatableJobs();
  for (const rep of existing) {
    if (rep.id === jobKey) {
      await q.removeRepeatableByKey(rep.key);
    }
  }
  if (everyMs) {
    await q.add(name, { ...data }, { repeat: { every: everyMs }, jobId: jobKey });
  }
}

export function closeAllQueues() {
  return Promise.all([...queues.values(), ...dlqQueues.values()].map((q) => q.close()));
}
