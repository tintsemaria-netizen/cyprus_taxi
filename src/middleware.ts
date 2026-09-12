import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Derive the tile host so CSP can allow exactly that origin for map imagery.
const DEFAULT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
function tileOrigin(): string {
  try {
    return new URL((process.env.NEXT_PUBLIC_MAP_TILES || DEFAULT_TILES).replace(/\{[^}]+\}/g, '0')).origin;
  } catch {
    return 'https://server.arcgisonline.com';
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// CSRF/origin defence for cookie-authorized mutations: if a browser sends an
// Origin header, its host must match the request host (blocks cross-site and
// sibling-subdomain origins). Non-browser API clients send no Origin and are
// allowed — they cannot be victims of CSRF since they carry no ambient cookies.
function originAllowed(req: NextRequest): boolean {
  if (!MUTATING.has(req.method)) return true;
  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser client
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const reqHost = req.headers.get('host') || '';
  let baseHost = '';
  try {
    baseHost = new URL(process.env.APP_BASE_URL || '').host;
  } catch {
    /* ignore */
  }
  return originHost === reqHost || (baseHost !== '' && originHost === baseHost);
}

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/') && !originAllowed(req)) {
    return NextResponse.json(
      { error: { code: 'BAD_ORIGIN', message: 'Cross-origin request rejected.', fieldErrors: {}, requestId: '' } },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const res = NextResponse.next();
  const tiles = tileOrigin();
  const csp = [
    "default-src 'self'",
    // Next.js injects inline bootstrap scripts; MapLibre uses blob workers.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${tiles} https://server.arcgisonline.com https://*.arcgisonline.com`,
    `connect-src 'self' ${tiles} https://server.arcgisonline.com https://*.arcgisonline.com`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  // Tile providers may require a Referer. Send only the ORIGIN (never the path/query,
  // so tracking references and tokens never leak) on ordinary pages; keep strict
  // no-referrer on the tracking page and all API/private responses.
  const p = req.nextUrl.pathname;
  const strictNoRef = p === '/track' || p.startsWith('/api/');
  res.headers.set('Referrer-Policy', strictNoRef ? 'no-referrer' : 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');
  return res;
}

export const config = {
  // Apply to everything except static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest).*)'],
};
