import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(currentDir, '../../.env') });
loadDotenv();

/**
 * Xác thực biến môi trường bằng Zod
 * Ứng dụng sẽ crash ngay khi khởi động nếu thiếu biến bắt buộc
 */
const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url('DATABASE_URL phải là URL hợp lệ'),

  // Lark / Feishu (optional — sync layer won't work without them)
  LARK_APP_ID: z.string().default(''),
  LARK_APP_SECRET: z.string().default(''),
  LARK_APP_TOKEN: z.string().default(''),
  LARK_HR_APP_TOKEN: z.string().default(''),

  // Server
  PORT: z.coerce.number().int().positive().default(3100),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // Automation
  ASNOVA_WEBHOOK_SECRET: z.string().default(''),
  ASNOVA_AUTOMATION_ENABLED: z.enum(['true', 'false']).optional(),
  ASNOVA_AUTOMATION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  ASNOVA_AUTOMATION_PERIODIC_CODES: z.string().default(''),
  ASNOVA_DAILY_PAYROLL_SHEET_ENABLED: z.enum(['true', 'false']).default('false'),
  ASNOVA_DAILY_PAYROLL_SHEET_HOUR: z.coerce.number().int().min(0).max(23).default(6),
  STIRLING_PDF_URL: z.string().default(''),
  STIRLING_PDF_API_KEY: z.string().default(''),
  ASNOVA_PDF_WEBHOOK_URL: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error(
      '❌ Lỗi cấu hình biến môi trường:',
      result.error.flatten().fieldErrors,
    );
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();

export const automationEnabled = env.ASNOVA_AUTOMATION_ENABLED
  ? env.ASNOVA_AUTOMATION_ENABLED === 'true'
  : env.NODE_ENV === 'production';
