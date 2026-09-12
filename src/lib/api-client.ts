// Thin client-side fetch wrapper for the JSON API. Always same-origin, credentials
// included for cookie-authorized routes.

export interface ApiError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
  requestId?: string;
}

export class ApiRequestError extends Error {
  status: number;
  body: ApiError;
  constructor(status: number, body: ApiError) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export class ApiTimeoutError extends Error {
  constructor() {
    super('Request timed out.');
    this.name = 'ApiTimeoutError';
  }
}

export async function api<T>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    // Optional cancellation + finite timeout for lookups (search/reverse). Booking
    // POSTs pass neither, so their behaviour is unchanged.
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  // Combine an optional caller signal with an optional timeout into one controller.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : null;
  let timedOut = false;
  if (timer) {
    // Track timeout vs. explicit cancellation so callers can distinguish them.
    controller.signal.addEventListener('abort', () => { if (!(opts.signal?.aborted)) timedOut = true; }, { once: true });
  }

  try {
    const res = await fetch(`/api/v1${path}`, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
      signal: controller.signal,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = (json.error as ApiError) || { code: 'ERROR', message: 'Request failed.' };
      throw new ApiRequestError(res.status, err);
    }
    return json as T;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      if (timedOut) throw new ApiTimeoutError();
      throw e; // caller-initiated cancellation
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
