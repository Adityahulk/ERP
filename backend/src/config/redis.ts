import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

export const redis = new Redis(env.REDIS_URL, {
  // API requests must fail fast when Redis is unavailable. BullMQ uses the
  // dedicated connection below, where unlimited retries are required.
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  enableOfflineQueue: false,
  connectTimeout: 3000,
  retryStrategy: (times: number) => {
    return Math.min(times * 200, 5000);
  },
  reconnectOnError: (err: Error) => {
    return err.message.includes('READONLY') ? 2 : false;
  },
});

redis.on('connect', () => {
  logger.info('✅ Redis connected');
});

redis.on('error', (err: Error) => {
  logger.error('Redis connection error:', err.message);
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

/**
 * Create a duplicate Redis connection for BullMQ subscribers
 */
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
