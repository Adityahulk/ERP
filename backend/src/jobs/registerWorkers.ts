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
 * Starts BullMQ workers. Processors are no-ops until producers enqueue real jobs and handlers
 * are implemented (overdue reminders, low stock, HR jobs, etc.).
 */
export function startScheduledWorkers(connection: Redis): Worker[] {
  logger.warn(
    'Scheduled job workers are registered with stub processors — no overdue/low-stock/HR automation runs until handlers and enqueue logic are wired.',
  );
  const workers: Worker[] = [];
  for (const name of QUEUES) {
    workers.push(
      new Worker(
        name,
        async () => {
          logger.debug(`[worker:${name}] stub tick (no business action)`);
        },
        { connection },
      ),
    );
    logger.info(`Worker registered (stub): ${name}`);
  }
  return workers;
}
