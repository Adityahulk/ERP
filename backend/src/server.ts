import app from './app';
import { env } from './config/env';
import { pool } from './config/db';
import { redis } from './config/redis';
import { logger } from './config/logger';
import fs from 'fs';
import path from 'path';

const PORT = env.PORT;

async function start(): Promise<void> {
  try {
    // Ensure upload directory exists
    const uploadDir = path.resolve(env.UPLOAD_DIR);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      logger.info(`📁 Created upload directory: ${uploadDir}`);
    }

    // Ensure logs directory exists
    const logsDir = path.resolve('logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Test database connection
    const dbResult = await pool.query('SELECT NOW() as time');
    logger.info(`✅ PostgreSQL connected — Server time: ${dbResult.rows[0].time}`);

    // Test Redis connection
    const pong = await redis.ping();
    logger.info(`✅ Redis connected — ${pong}`);

    // Start server
    app.listen(PORT, () => {
      logger.info(`🚀 BizFlow API running on http://localhost:${PORT}`);
      logger.info(`📋 Environment: ${env.NODE_ENV}`);
      logger.info(`🏥 Health check: http://localhost:${PORT}/health`);
      if (env.NODE_ENV === 'production' && env.EINVOICE_MODE === 'mock') {
        logger.warn(
          'EINVOICE_MODE is "mock" in production — IRNs will not be generated on the GST network. Set EINVOICE_MODE=sandbox or production and configure GSP credentials.',
        );
      }
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down gracefully...');
  await pool.end();
  redis.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received — shutting down gracefully...');
  await pool.end();
  redis.disconnect();
  process.exit(0);
});

start();
