import { z } from 'zod';
import { keyringProblem } from '../notes/note-cipher.js';

/** Development-only notes key: refused in production. */
export const DEV_NOTES_KEYS = '1:c2Vzc2lvLWRldi1ub3Rlcy1rZXktTk9ULVNFQ1JFVCE=';

/** Every setting the API reads, validated once at startup: a bad value fails the boot. */
/** "https://app.example.com/" is read as its origin; a real path, query or fragment is refused. */
const origin = z
  .url()
  .refine((v) => {
    const u = new URL(v);
    return u.pathname === '/' && !u.search && !u.hash;
  }, 'must be an origin (scheme://host[:port]), without a path')
  .transform((v) => new URL(v).origin);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Browser origin of the web app, trusted for cookies and CSRF checks, and used in email links. */
  WEB_ORIGIN: origin.default('http://localhost:5173'),

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
  /**
   * Keyring of the clinical notes cipher: "version:base64(32 bytes)", comma-separated; the highest
   * version encrypts, older ones still decrypt. Kept out of the database on purpose.
   */
  NOTES_ENCRYPTION_KEYS: z.string().default(DEV_NOTES_KEYS),
  /** Password hashes computed at once (128 MiB each): 1 fits a 512 MiB instance with room to spare. */
  PASSWORD_HASH_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  /** Demo deployment: mails are recorded for the in-app outbox instead of leaving the server. */
  DEMO_MODE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
}).superRefine((env, ctx) => {
  const keyring = keyringProblem(env.NOTES_ENCRYPTION_KEYS);
  if (keyring) {
    ctx.addIssue({ code: 'custom', path: ['NOTES_ENCRYPTION_KEYS'], message: keyring });
  }
  if (env.NODE_ENV === 'production' && env.NOTES_ENCRYPTION_KEYS.includes(DEV_NOTES_KEYS.split(':')[1])) {
    ctx.addIssue({ code: 'custom', path: ['NOTES_ENCRYPTION_KEYS'], message: 'the development key must not be used in production' });
  }
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
