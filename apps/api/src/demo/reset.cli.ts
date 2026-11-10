import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { DemoService } from './demo.module.js';

/** `pnpm demo:reset`: rebuilds the demo clinic in the configured database (wipes it first). */
if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
  console.error('Refusing to wipe a production database that is not a demo (DEMO_MODE=true).');
  process.exit(1);
}
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
try {
  console.log(await app.get(DemoService).reset());
} finally {
  await app.close();
}
