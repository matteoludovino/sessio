/** Every call goes to /api on this origin, with the session cookie. */
export interface Conflict {
  reason: string;
  message?: string;
  occurrenceDate?: string;
  startsAt: string;
  endsAt?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly conflicts: Conflict[] = [],
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join(' ') : (data.message ?? 'Algo deu errado. Tente de novo.');
    throw new ApiError(res.status, res.status === 400 && data.issues ? 'Verifique os campos.' : message, data.conflicts ?? []);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export const qs = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter((e): e is [string, string] => !!e[1]);
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
};
