import request from 'supertest';
import type { TestApp } from './app.js';
import type { SignedIn } from './auth.js';

/** Requests on behalf of a signed-in staff member. */
export function as(t: TestApp, who: SignedIn) {
  return {
    get: (url: string) => request(t.http).get(url).set('Cookie', who.cookie),
    post: (url: string, body: object = {}) => request(t.http).post(url).set('Cookie', who.cookie).send(body),
    patch: (url: string, body: object) => request(t.http).patch(url).set('Cookie', who.cookie).send(body),
    put: (url: string, body: object) => request(t.http).put(url).set('Cookie', who.cookie).send(body),
    delete: (url: string) => request(t.http).delete(url).set('Cookie', who.cookie),
  };
}

/** A São Paulo wall-clock time (UTC-3) as an ISO instant: at('2030-01-07 08:00'). */
export const at = (local: string) => `${local.replace(' ', 'T')}:00-03:00`;
