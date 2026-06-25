import 'dotenv/config';
import { createRedisConnection } from './config/redis';
import { logger } from './config/logger';
import { startScheduledWorkers } from './jobs/registerWorkers';
import { setRepeatingJob } from './jobs/queues';

const connection = createRedisConnection();
startScheduledWorkers(connection);

// Platform-wide daily sweep — checks every company's due service
// reminders in one pass (the processor itself scopes by company_id
// per row), so this is registered once, not per-tenant.
setRepeatingJob('serviceReminder', 'daily-service-reminder-sweep', {}, 24 * 60 * 60 * 1000).catch((err) => {
  logger.error(`Failed to schedule daily service reminder sweep: ${err.message}`);
});

logger.info('BizFlow worker process started (BullMQ listeners active)');
