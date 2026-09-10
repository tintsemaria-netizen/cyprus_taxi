import { NextResponse } from 'next/server';
import crypto from 'crypto';

export type FieldErrors = Record<string, string>;

export function requestId(): string {
  return crypto.randomBytes(8).toString('hex');
}

// Standard error envelope (SPEC §8).
export function apiError(
  status: number,
  code: string,
  message: string,
  fieldErrors: FieldErrors = {},
) {
  const rid = requestId();
  const res = NextResponse.json(
    { error: { code, message, fieldErrors, requestId: rid } },
    { status },
  );
  applyPrivateHeaders(res);
  res.headers.set('x-request-id', rid);
  return res;
}

export function apiOk<T>(data: T, status = 200) {
  const res = NextResponse.json(data as object, { status });
  applyPrivateHeaders(res);
  return res;
}

// Private/auth/tracking responses must not be cached or leak referrers (SPEC §3/§10).
export function applyPrivateHeaders(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  return res;
}

export const Errors = {
  unauthorized: () => apiError(401, 'UNAUTHENTICATED', 'Authentication required.'),
  forbidden: () => apiError(403, 'FORBIDDEN', 'You do not have access to this resource.'),
  notFound: (msg = 'Not found.') => apiError(404, 'NOT_FOUND', msg),
  conflict: (msg = 'The resource changed. Refresh and retry.') =>
    apiError(409, 'CONFLICT', msg),
  validation: (fieldErrors: FieldErrors, msg = 'Validation failed.') =>
    apiError(422, 'VALIDATION', msg, fieldErrors),
  throttled: (retryAfter = 60) => {
    const res = apiError(429, 'RATE_LIMITED', 'Too many requests. Slow down.');
    res.headers.set('Retry-After', String(retryAfter));
    return res;
  },
  server: (msg = 'Unexpected server error.') => apiError(500, 'SERVER_ERROR', msg),
};

// Best-effort client IP honouring a bounded number of trusted proxy hops.
export function clientIp(req: Request, hops: number): string {
  const xff = req.headers.get('x-forwarded-for');
  if (!xff) return 'unknown';
  const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
  // The rightmost `hops` entries are added by our own trusted proxies; the entry
  // just before them is the closest untrusted client.
  const idx = Math.max(0, parts.length - hops - 1);
  return parts[idx] || parts[0] || 'unknown';
}
