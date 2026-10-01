import { BlockList, isIP } from 'node:net';
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
  extra?: Record<string, unknown>,
) {
  const rid = requestId();
  const res = NextResponse.json(
    { error: { code, message, fieldErrors, requestId: rid, ...(extra || {}) } },
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

// Proxies we trust to append to X-Forwarded-For: loopback/private (nginx, Docker) and Cloudflare's
// published edge ranges (https://www.cloudflare.com/ips-v4 + ips-v6). Extra CIDRs can be added via
// TRUSTED_PROXY_CIDRS (comma-separated).
const CLOUDFLARE_CIDRS = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
];
const PRIVATE_CIDRS = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10'];

let trusted: BlockList | null = null;
function trustedProxies(): BlockList {
  if (trusted) return trusted;
  const bl = new BlockList();
  const extra = (process.env.TRUSTED_PROXY_CIDRS || '').split(',').map((c) => c.trim()).filter(Boolean);
  for (const cidr of [...CLOUDFLARE_CIDRS, ...PRIVATE_CIDRS, ...extra]) {
    const [addr, bits] = cidr.split('/');
    const type = isIP(addr) === 6 ? 'ipv6' : 'ipv4';
    try { bl.addSubnet(addr, Number(bits), type); } catch { /* ignore malformed */ }
  }
  return (trusted = bl);
}

function isTrustedProxy(ip: string): boolean {
  const v = isIP(ip);
  if (!v) return false;
  return trustedProxies().check(ip, v === 6 ? 'ipv6' : 'ipv4');
}

// Client IP for rate limiting. Walks X-Forwarded-For from the RIGHT (entries appended by our own
// proxies), skipping at most `hops` trusted proxies (the Cloudflare edge nginx saw; loopback/Docker), and returns
// the first untrusted address. Entries further left are client-supplied and can be forged, so they
// are never chosen while an untrusted address exists to their right. A direct-to-origin request
// (bypassing Cloudflare) therefore resolves to the caller's real address, not a forged one.
export function clientIp(req: Request, hops: number): string {
  const xff = req.headers.get('x-forwarded-for');
  const parts = (xff || '').split(',').map((s) => s.trim()).filter(Boolean);
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (!parts.length) return realIp || 'unknown';
  let skipped = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const ip = parts[i];
    if (skipped < hops && isTrustedProxy(ip)) { skipped++; continue; }
    return ip;
  }
  return parts[0];
}
