import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './config/env.js';

/** Shared by main.ts and the e2e tests, so tests exercise the real HTTP setup. */
export function configureApp(app: INestApplication): INestApplication {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useSecurityHeaders();
  // Cross-site writes are refused with a 403 on every route, public ones included.
  app.enableCsrfProtection({ trustedOrigins: [config.get('WEB_ORIGIN', { infer: true })] });
  app.enableShutdownHooks();
  return app;
}
