import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { logger } from '../config/logger';

const QUEUES = [
  'overdueInvoiceReminder',
  'lowStockAlert',
  'dailyAbsenceMarker',
  'leaveExpiryJob',
  'pendingLeaveReminder',
] as const;

/**
 * Starts BullMQ workers (stub processors). Replace job handlers with real logic when scheduling is wired.
 */
export function startScheduledWorkers(connection: Redis): Worker[] {
  const workers: Worker[] = [];
  for (const name of QUEUES) {
    workers.push(
      new Worker(
        name,
        async () => {
          logger.debug(`[worker:${name}] tick`);
        },
        { connection },
      ),
    );
    logger.info(`Worker registered: ${name}`);
  }
  return workers;
}
