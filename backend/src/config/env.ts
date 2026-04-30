import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  SHARE_SECRET: z.string().default('bizflow-share-secret'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_NUMBER: z.string().optional(),
  TWILIO_SMS_FROM: z.string().optional(),

  // File uploads
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_FILE_SIZE: z.coerce.number().default(10485760), // 10MB

  // Puppeteer
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),

  // E-Invoice / GSP
  EINVOICE_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
  EINVOICE_USERNAME: z.string().optional(),
  EINVOICE_PASSWORD: z.string().optional(),
  EINVOICE_GSP_URL: z.string().optional(),
  EINVOICE_SANDBOX_URL: z.string().optional(),
  EINVOICE_PRODUCTION_URL: z.string().optional(),
  // TaxPro (optional primary provider)
  TAXPRO_API_BASE_URL: z.string().optional(),
  TAXPRO_API_KEY: z.string().optional(),
  TAXPRO_API_SECRET: z.string().optional(),
  TAXPRO_USERNAME: z.string().optional(),
  TAXPRO_PASSWORD: z.string().optional(),
  TAXPRO_IRN_ENDPOINT: z.string().optional(),
  TAXPRO_CANCEL_ENDPOINT: z.string().optional(),
  GSTIN_LOOKUP_API_URL: z.string().optional(),
  GSTIN_LOOKUP_API_KEY: z.string().optional(),
  GSTIN_LOOKUP_API_KEY_HEADER: z.string().default('Authorization'),
  /** 64 hex chars (32 bytes) for AES-256-GCM storage of GSP passwords at rest */
  CREDENTIALS_ENCRYPTION_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
