import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { TestApp } from './app.js';

export const PASSWORD = 'correct horse battery';

/** "name=value" of the session cookie a response set (supertest has no browser cookie jar). */
export function sessionCookie(res: request.Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find((c) => c.includes('sid='));
  if (!cookie) {
    throw new Error(`No session cookie in response ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return cookie.split(';')[0];
}

export const uniqueEmail = (label = 'user') => `${label}-${randomUUID()}@example.com`;

export interface SignedIn {
  cookie: string;
  user: { id: string; clinicId: string; email: string; name: string; role: string };
}

/** A new clinic with its owner, signed in. */
export async function signUpOwner({ http }: TestApp, clinicName = 'Clínica Teste'): Promise<SignedIn> {
  const res = await request(http)
    .post('/api/auth/sign-up')
    .send({ clinicName, name: 'Dona Ana', email: uniqueEmail('owner'), password: PASSWORD })
    .expect(201);
  return { cookie: sessionCookie(res), user: res.body };
}

/** Invites a staff member as `owner`, then accepts through the link that was mailed. */
export async function addStaff(t: TestApp, owner: SignedIn, role: 'reception' | 'psychologist', name = 'Pessoa Equipe') {
  const email = uniqueEmail(role);
  await request(t.http).post('/api/staff/invitations').set('Cookie', owner.cookie).send({ email, name, role }).expect(201);
  const token = await invitationToken(t, email);
  const res = await request(t.http).post('/api/invitations/accept').send({ token, password: PASSWORD }).expect(200);
  return { cookie: sessionCookie(res), user: res.body } satisfies SignedIn;
}

/** Delivers the outbox (where the invitation mail waits), then reads the link from the mail. */
export async function invitationToken({ mailbox, deliver }: TestApp, email: string): Promise<string> {
  await deliver();
  const mail = mailbox.assertSent({ to: email });
  const token = mail.link('/convite').searchParams.get('token');
  if (!token) {
    throw new Error('Invitation mail without a token');
  }
  return token;
}
