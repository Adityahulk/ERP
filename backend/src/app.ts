import express from 'express';
import { randomUUID } from 'crypto';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import { env } from './config/env';
import { logger } from './config/logger';
import routes from './routes';
import { normalizeRequestDates } from './middleware/dateNormalizer';

const app = express();

app.use((req, res, next) => {
  const id = (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id']) || randomUUID();
  (req as express.Request & { reqId?: string }).reqId = id;
  res.setHeader('X-Request-Id', id);
  next();
});

// ── Security ──────────────────────────────────────────
app.use(helmet({
  // Dev UI (e.g. localhost:3000) calls API on 127.0.0.1:PORT — avoid CORP blocking the response body.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: env.CORS_ORIGIN.split(',').map(s => s.trim()),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Body parsing ──────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(normalizeRequestDates);

// ── Logging ───────────────────────────────────────────
app.use(morgan('short', {
  stream: { write: (msg: string) => logger.info(msg.trim()) },
}));

// ── Static files ──────────────────────────────────────
app.use('/uploads', express.static(path.resolve(env.UPLOAD_DIR)));

// ── API routes ────────────────────────────────────────
app.use('/api', routes);

// ── Health check ──────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'bizflow-api',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ── Full-stack static frontend hosting ────────────────
const frontendDist = path.resolve(env.FRONTEND_DIST_DIR);
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  logger.warn(`Frontend dist not found at ${frontendDist}; serving API only.`);
}

// ── 404 handler ───────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// ── Global error handler ──────────────────────────────
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const reqId = (req as express.Request & { reqId?: string }).reqId;
  logger.error('Unhandled error:', { err, reqId });

  const statusCode = err.statusCode || 500;
  const message = env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message || 'Internal server error';

  res.status(statusCode).json({
    success: false,
    message,
    ...(env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

export default app;
