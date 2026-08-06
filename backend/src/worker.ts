import 'dotenv/config';
import { createRedisConnection } from './config/redis';
import { logger } from './config/logger';
import { startScheduledWorkers } from './jobs/registerWorkers';

const connection = createRedisConnection();
startScheduledWorkers(connection);

logger.info('Microtechnique Accounts worker process started (BullMQ listeners active)');
