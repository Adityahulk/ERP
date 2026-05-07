import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  FRONTEND_DIST_DIR: z.string().default('./public'),

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

  // SMTP (transactional email — OTP, password reset, etc.)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Microtechnique Accounts <no-reply@microtechnique.in>'),
  // OTP behaviour
  OTP_LENGTH: z.coerce.number().default(6),
  OTP_TTL_MINUTES: z.coerce.number().default(15),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().default(60),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),

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
  TAXPRO_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  TAXPRO_API_HOST: z.string().optional(),
  TAXPRO_ASPID: z.string().optional(),
  TAXPRO_EINV_USER_NAME: z.string().optional(),
  TAXPRO_EINV_PASSWORD: z.string().optional(),
  TAXPRO_EWB_USER_NAME: z.string().optional(),
  TAXPRO_EWB_PASSWORD: z.string().optional(),
  TAXPRO_QR_CODE_SIZE: z.string().default('250'),
  TAXPRO_EINV_AUTH_PATH: z.string().optional(),
  TAXPRO_EINV_INVOICE_PATH: z.string().optional(),
  TAXPRO_EINV_CANCEL_PATH: z.string().optional(),
  TAXPRO_EWB_AUTH_PATH: z.string().optional(),
  TAXPRO_EWB_API_PATH: z.string().optional(),
  TAXPRO_EWB_GEN_ACTION: z.string().default('GENEWAYBILL'),
  TAXPRO_EWB_CANCEL_ACTION: z.string().default('CANEWB'),
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
