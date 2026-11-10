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

describe('NOTES_ENCRYPTION_KEYS', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const problem = (value: string) => () => validateEnv({ ...base, NOTES_ENCRYPTION_KEYS: value });

  it('accepts one or more "version:base64key" entries', () => {
    expect(validateEnv({ ...base, NOTES_ENCRYPTION_KEYS: `1:${key}` }).NOTES_ENCRYPTION_KEYS).toBe(`1:${key}`);
    expect(() => validateEnv({ ...base, NOTES_ENCRYPTION_KEYS: `1:${key}, 2:${key}` })).not.toThrow();
  });

  it('says what is wrong with the usual paste mistakes', () => {
    expect(problem(`NOTES_ENCRYPTION_KEYS=1:${key}`)).toThrow(/without "NOTES_ENCRYPTION_KEYS="/);
    expect(problem(`"1:${key}"`)).toThrow(/quotes/);
    expect(problem(key)).toThrow(/version:base64key/);
    expect(problem(`1:${Buffer.alloc(16).toString('base64')}`)).toThrow(/16 bytes, it must be 32/);
  });
});
