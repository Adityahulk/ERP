import { Worker, Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { logger } from '../config/logger';
import { query } from '../config/db';
import { getDlq, QUEUE_NAMES, type QueueName } from './queues';
import { processIntegrationSync, processGoogleBusinessSync, processAdsSync } from './processors/integrationSync';
import { processWhatsappCampaign } from './processors/whatsappCampaign';
import { processEmailCampaign } from './processors/emailCampaign';
import { processPaymentReminder } from './processors/paymentReminder';
import { processInventoryAlert } from './processors/inventoryAlert';
import { processAutoBackup } from './processors/autoBackup';
import { processServiceReminder } from './processors/serviceReminder';
import { processDailyAbsenceMarker } from './processors/dailyAbsenceMarker';
import { processLeaveExpiryJob } from './processors/leaveExpiryJob';
import { processPendingLeaveReminder } from './processors/pendingLeaveReminder';

/**
 * NOTE on scope: this file intentionally does NOT register queues for
 * "Service Reminders", "Loyalty Processing", or "Referral Rewards".
 * Those features have no backend domain model yet (no service-booking
 * table, no loyalty-points table, no referral table) — registering a
 * worker with nothing real to process would be exactly the
 * "placeholder worker" pattern this rewrite is meant to eliminate.
 * Add them here once their domain tables/controllers exist.
 */
const PROCESSORS: Record<QueueName, (job: Job) => Promise<any>> = {
  dailyAbsenceMarker: processDailyAbsenceMarker,
  leaveExpiryJob: processLeaveExpiryJob,
  pendingLeaveReminder: processPendingLeaveReminder,
  integrationSync: processIntegrationSync,
  googleBusinessSync: processGoogleBusinessSync,
  adsSync: processAdsSync,
  whatsappCampaign: processWhatsappCampaign,
  emailCampaign: processEmailCampaign,
  paymentReminder: processPaymentReminder,
  inventoryAlert: processInventoryAlert,
  autoBackup: processAutoBackup,
  serviceReminder: processServiceReminder,
};

// Rate limiting protects external providers (Twilio, SMTP, Google,
// Meta) from being hammered by a single tenant's burst of jobs, and
// keeps DB load predictable. BullMQ enforces this per-worker.
const RATE_LIMITS: Partial<Record<QueueName, { max: number; duration: number }>> = {
  whatsappCampaign: { max: 20, duration: 1000 },
  emailCampaign: { max: 10, duration: 1000 },
  paymentReminder: { max: 20, duration: 1000 },
  inventoryAlert: { max: 5, duration: 1000 },
  integrationSync: { max: 5, duration: 1000 },
  googleBusinessSync: { max: 5, duration: 1000 },
  adsSync: { max: 5, duration: 1000 },
};

const CONCURRENCY: Partial<Record<QueueName, number>> = {
  whatsappCampaign: 3,
  emailCampaign: 3,
  autoBackup: 1, // disk I/O heavy — one at a time is intentional
};

const HEARTBEAT_INTERVAL_MS = 30_000;
const WORKER_INSTANCE_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Starts one real BullMQ Worker per queue. Each worker:
 *   - runs the matching real processor from jobs/processors/*
 *   - retries failed jobs per the attempts/backoff set in queues.ts
 *   - on the FINAL failed attempt, moves the job to a `<queue>-dlq`
 *     queue (inspectable/replayable, not just discarded)
 *   - writes a heartbeat row every 30s so the admin dashboard can
 *     tell a stalled/crashed worker from a merely-idle one
 */
export function startScheduledWorkers(connection: Redis): Worker[] {
  const workers: Worker[] = [];

  for (const name of QUEUE_NAMES) {
    const processor = PROCESSORS[name];
    const worker = new Worker(name, processor, {
      connection,
      concurrency: CONCURRENCY[name] || 2,
      limiter: RATE_LIMITS[name],
    });

    let processedCount = 0;
    let failedCount = 0;

    worker.on('completed', (job) => {
      processedCount++;
      logger.debug(`[worker:${name}] job ${job.id} completed`);
    });

    worker.on('failed', async (job, err) => {
      failedCount++;
      const attemptsMax = job?.opts.attempts || 1;
      const attemptsMade = job?.attemptsMade || 0;
      const isFinalAttempt = attemptsMade >= attemptsMax;
      logger.error(`[worker:${name}] job ${job?.id} failed (attempt ${attemptsMade}/${attemptsMax}): ${err.message}`);

      if (isFinalAttempt && job) {
        try {
          await getDlq(name).add('dead-letter', {
            originalJobId: job.id,
            originalData: job.data,
            error: err.message,
            failedAt: new Date().toISOString(),
          });
          logger.warn(`[worker:${name}] job ${job.id} exhausted ${attemptsMax} attempts — moved to dead-letter queue`);
        } catch (dlqErr: any) {
          logger.error(`[worker:${name}] CRITICAL: failed to move job ${job.id} to DLQ: ${dlqErr.message}`);
        }
      }
    });

    const heartbeat = setInterval(async () => {
      try {
        await query(
          `INSERT INTO worker_heartbeats (queue_name, worker_instance_id, status, jobs_processed, jobs_failed, last_heartbeat_at)
           VALUES ($1, $2, 'running', $3, $4, now())
           ON CONFLICT (queue_name, worker_instance_id) DO UPDATE SET
             jobs_processed = $3, jobs_failed = $4, last_heartbeat_at = now(), status = 'running'`,
          [name, WORKER_INSTANCE_ID, processedCount, failedCount],
        );
      } catch (e: any) {
        logger.error(`[worker:${name}] heartbeat write failed: ${e.message}`);
      }
    }, HEARTBEAT_INTERVAL_MS);

    worker.on('closed', () => clearInterval(heartbeat));

    workers.push(worker);
    const rl = RATE_LIMITS[name];
    logger.info(
      `Worker registered: ${name} (concurrency=${CONCURRENCY[name] || 2}${rl ? `, rate-limited ${rl.max}/${rl.duration}ms` : ''})`,
    );
  }

  logger.info(`${workers.length} real BullMQ workers started — retry, dead-letter queue, and heartbeat monitoring active for all.`);
  return workers;
}
