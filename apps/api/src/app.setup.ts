import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';

/** Shared by main.ts and the e2e tests, so tests exercise the real HTTP setup. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.enableShutdownHooks();
  return app;
}
