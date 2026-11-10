/** PostgreSQL error codes the API turns into domain errors. */
export const PgError = {
  uniqueViolation: '23505',
  exclusionViolation: '23P01',
  foreignKeyViolation: '23503',
} as const;

/** The SQLSTATE of a node-postgres error, also when an ORM wraps it in `cause`. */
export function pgErrorCode(error: unknown): string | undefined {
  for (let e: unknown = error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return code;
    }
  }
  return undefined;
}
