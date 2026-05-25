import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_POOL_MIN: z.coerce.number().default(2),
  DB_POOL_MAX: z.coerce.number().default(20),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:3005'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  DATA_ENCRYPTION_KEY: z.string().default(''),
  BNI_ECOLLECTION_BASE_URL: z.string().default('https://apibeta.bni-ecollection.com/'),
  BNI_ECOLLECTION_CLIENT_ID: z.string().default(''),
  BNI_ECOLLECTION_SECRET_KEY: z.string().default(''),
  BNI_ECOLLECTION_PREFIX: z.string().default('8'),
  BNI_ECOLLECTION_TIME_DIFF_LIMIT_SEC: z.coerce.number().default(300),
  BNI_CALLBACK_IP_ALLOWLIST: z.string().default(''),
  BNI_DEBUG_LOG: z.coerce.boolean().default(false),
  // SMTP (optional — falls back to console logging if not set)
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('noreply@saunggul.ac.id'),
  // Frontend URL for reset links
  FRONTEND_URL: z.string().default('http://localhost:3005'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
const normalizeOrigin = (origin: string) =>
  origin.trim().replace(/^['"`\s]+/, '').replace(/['"`\s]+$/, '');
export const config = {
  db: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    pool: { min: env.DB_POOL_MIN, max: env.DB_POOL_MAX },
  },
  jwt: {
    secret: env.JWT_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  },
  server: {
    port: env.PORT,
    host: env.HOST,
    isDev: env.NODE_ENV === 'development',
    logLevel: env.LOG_LEVEL || (env.NODE_ENV === 'development' ? 'info' : 'warn'),
  },
  cors: {
    origins: env.CORS_ORIGINS.split(',').map(normalizeOrigin).filter(Boolean),
  },
  storage: {
    driver: env.STORAGE_DRIVER,
    uploadDir: env.UPLOAD_DIR,
  },
  crypto: {
    dataEncryptionKey: env.DATA_ENCRYPTION_KEY,
  },
  bniEcollection: {
    baseUrl: env.BNI_ECOLLECTION_BASE_URL,
    clientId: env.BNI_ECOLLECTION_CLIENT_ID,
    secretKey: env.BNI_ECOLLECTION_SECRET_KEY,
    prefix: env.BNI_ECOLLECTION_PREFIX,
    timeDiffLimitSec: env.BNI_ECOLLECTION_TIME_DIFF_LIMIT_SEC,
    callbackIpAllowlist: env.BNI_CALLBACK_IP_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean),
    debugLog: env.BNI_DEBUG_LOG,
  },
  smtp: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM,
  },
  frontendUrl: env.FRONTEND_URL,
};
