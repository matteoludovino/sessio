import { Global, Injectable, Module } from '@nestjs/common';

/** "Now", injectable: time rules (deadlines, "only after the start") are testable without waiting. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
