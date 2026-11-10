import { timingSafeEqual } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';

/** For machine-to-machine endpoints: constant-time comparison of "Bearer <secret>". */
export function assertBearer(authorization: string | undefined, secret: string): void {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authorization ?? '');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new UnauthorizedException();
  }
}
