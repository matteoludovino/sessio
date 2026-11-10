import { validateEnv } from './env.js';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('WEB_ORIGIN', () => {
  it('accepts an origin, with or without the trailing slash a browser bar adds', () => {
    expect(validateEnv({ ...base, WEB_ORIGIN: 'https://sessio.example.com' }).WEB_ORIGIN).toBe('https://sessio.example.com');
    expect(validateEnv({ ...base, WEB_ORIGIN: 'https://sessio.example.com/' }).WEB_ORIGIN).toBe('https://sessio.example.com');
    expect(validateEnv({ ...base, WEB_ORIGIN: 'http://localhost:5173' }).WEB_ORIGIN).toBe('http://localhost:5173');
  });

  it('refuses a URL with a path, with a message that says why', () => {
    expect(() => validateEnv({ ...base, WEB_ORIGIN: 'https://sessio.example.com/app' })).toThrow(/WEB_ORIGIN: must be an origin/);
  });
});
