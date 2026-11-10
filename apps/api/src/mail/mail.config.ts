import { ConfigService } from '@nestjs/config';
import { LogMailTransport, type MailTransport, ResendTransport, SmtpTransport } from '@nestjs/mail';
import type { Env } from '../config/env.js';

/** The transport for this environment. Tests replace it with InMemoryMailTransport. */
export function mailTransport(config: ConfigService<Env, true>): MailTransport {
  switch (config.get('MAIL_TRANSPORT', { infer: true })) {
    case 'smtp':
      return new SmtpTransport({ url: config.get('SMTP_URL', { infer: true }) });
    case 'resend':
      return new ResendTransport({ apiKey: config.get('RESEND_API_KEY', { infer: true })! });
    case 'log':
      return new LogMailTransport();
  }
}
