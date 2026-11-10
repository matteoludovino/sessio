import { z } from 'zod';

/** Every setting the API reads, validated once at startup: a bad value fails the boot. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Browser origin of the web app, trusted for cookies and CSRF checks, and used in email links. */
  WEB_ORIGIN: z.url().default('http://localhost:5173'),

  /** smtp: Mailpit in development or any SMTP relay. resend: Resend's API. log: logs only. */
  MAIL_TRANSPORT: z.enum(['smtp', 'resend', 'log']).default('smtp'),
  SMTP_URL: z.url().default('smtp://localhost:1025'),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Sessio <no-reply@sessio.local>'),

  /** Bearer secret of POST /api/internal/jobs/run, called by the external scheduler. */
  JOBS_SECRET: z.string().min(16).default('dev-jobs-secret-change-me'),
  /** Runs the jobs in-process every N minutes while the API is awake (0: only the external call). */
  JOBS_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(5),
  /** "off" for instances that must not publish outbox messages (and in tests, which drive it). */
  OUTBOX_RELAY: z.enum(['on', 'off']).default('on'),
  /** HMAC key of the patients' confirmation links. */
  LINK_SECRET: z.string().min(16).default('dev-link-secret-change-me'),
  /** Demo deployment: mails are recorded for the in-app outbox instead of leaving the server. */
  DEMO_MODE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && (env.LINK_SECRET.startsWith('dev-') || env.LINK_SECRET.length < 32)) {
    ctx.addIssue({ code: 'custom', path: ['LINK_SECRET'], message: 'set a random secret of 32+ characters in production' });
  }
  if (env.NODE_ENV === 'production' && (env.JOBS_SECRET.startsWith('dev-') || env.JOBS_SECRET.length < 32)) {
    ctx.addIssue({ code: 'custom', path: ['JOBS_SECRET'], message: 'set a random secret of 32+ characters in production' });
  }
  if (env.MAIL_TRANSPORT === 'resend' && !env.RESEND_API_KEY) {
    ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'required when MAIL_TRANSPORT=resend' });
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
