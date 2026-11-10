import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

export interface SessionLink {
  appointmentId: string;
  /** The start time the link was issued for: a rescheduled session invalidates its old links. */
  startsAt: Date;
}

const PURPOSE = 'session-link.v1';

/**
 * Stateless signed links for patients: HMAC-SHA256 over the appointment and its start time. Nothing
 * to store, and every old link dies by itself when the session is rescheduled.
 */
@Injectable()
export class LinkTokens {
  constructor(private readonly config: ConfigService<Env, true>) {}

  sign({ appointmentId, startsAt }: SessionLink): string {
    const body = Buffer.from(`${appointmentId}.${startsAt.getTime()}`).toString('base64url');
    return `${body}.${this.mac(body)}`;
  }

  /** The link's content, or null for anything forged, truncated or malformed. */
  verify(token: string): SessionLink | null {
    const [body, mac, extra] = token.split('.');
    if (!body || !mac || extra !== undefined) return null;
    const expected = Buffer.from(this.mac(body));
    const given = Buffer.from(mac);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const [appointmentId, ms] = Buffer.from(body, 'base64url').toString().split('.');
    const startsAt = new Date(Number(ms));
    if (!/^[0-9a-f-]{36}$/.test(appointmentId ?? '') || Number.isNaN(startsAt.getTime())) return null;
    return { appointmentId, startsAt };
  }

  private mac(body: string): string {
    return createHmac('sha256', this.config.get('LINK_SECRET', { infer: true })).update(`${PURPOSE}:${body}`).digest('base64url');
  }
}
