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

// Plain-http visitors behind Cloudflare (2026-11-21): http://il-y.taxi served the app without redirecting, and the
// browser then refused to keep the Secure login cookie — staff could not log in from a phone. Cloudflare tells the
// visitor's real scheme in CF-Visitor (nginx always forwards X-Forwarded-Proto https), so send them to https.
function cameOverPlainHttp(req: NextRequest): boolean {
  const v = req.headers.get('cf-visitor');
  return !!v && /"scheme"\s*:\s*"http"/.test(v);
}

const MUTATION_HEADER = 'x-ily-mutation';
const WELCOME_COOKIE = 'ily_welcome_seen';

export function proxy(req: NextRequest) {
  if (cameOverPlainHttp(req) && (req.method === 'GET' || req.method === 'HEAD')) {
    const host = req.headers.get('host') || req.nextUrl.host;
    return NextResponse.redirect(`https://${host}${req.nextUrl.pathname}${req.nextUrl.search}`, 308);
  }
  if (req.nextUrl.pathname.startsWith('/api/') && !originAllowed(req)) {
    return NextResponse.json(
      { error: { code: 'BAD_ORIGIN', message: 'Cross-origin request rejected.', fieldErrors: {}, requestId: '' } },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  // Start page first (2026-11-26, operator): a passenger opening the site or the installed app on a phone that has
  // never been here (first time, a new phone, from a QR code or a link) sees /welcome once; after that «/» opens
  // the booking screen straight away. Someone already signed in on this phone is not sent there.
  if ((req.method === 'GET' || req.method === 'HEAD') && req.nextUrl.pathname === '/'
    && !req.cookies.has(WELCOME_COOKIE) && !req.cookies.has('tc_passenger') && !req.headers.get('next-router-prefetch')) {
    const to = req.nextUrl.clone(); to.pathname = '/welcome';
    return NextResponse.redirect(to, 307);
  }
  // «Журнал изменений» (2026-11-23): tell requireStaff which changing API call this is, so an admin's
  // change is logged for the owner. Always overwritten here — a client can never set it itself.
  const reqHeaders = new Headers(req.headers);
  reqHeaders.delete(MUTATION_HEADER);
  if (req.nextUrl.pathname.startsWith('/api/v1/') && MUTATING.has(req.method)) reqHeaders.set(MUTATION_HEADER, `${req.method} ${req.nextUrl.pathname}`);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  const tiles = tileOrigin();
  // Free vector map (2026-11-28): OpenFreeMap style, tiles, fonts and icons all come from one host.
  const vec = 'https://tiles.openfreemap.org';
  // Google Maps JS SDK resource hosts (per Google's CSP guidance). The vector/WebGL
  // map's shared-label worker fetches label images from *.gstatic.com AND data: URIs
  // via connect-src, so both must be allowed there (this only surfaces on real GPU
  // vector rendering, not software-WebGL raster fallback).
  const g = {
    script: 'https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com',
    img: 'https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com https://*.googleusercontent.com',
    connect: 'https://maps.googleapis.com https://*.googleapis.com https://*.google.com https://*.gstatic.com',
    style: 'https://fonts.googleapis.com',
    font: 'https://fonts.gstatic.com',
  };
  const csp = [
    "default-src 'self'",
    // Next.js injects inline bootstrap scripts; MapLibre/Google use blob workers.
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: ${g.script}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    `style-src 'self' 'unsafe-inline' ${g.style}`,
    `img-src 'self' data: blob: ${tiles} ${vec} https://server.arcgisonline.com https://*.arcgisonline.com https://api.maptiler.com ${g.img}`,
    `connect-src 'self' data: blob: ${tiles} ${vec} https://server.arcgisonline.com https://*.arcgisonline.com https://api.maptiler.com ${g.connect}`,
    `font-src 'self' data: ${g.font}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  // Browsers then go straight to https next time (only when Cloudflare confirms the visit was https).
  if (/"scheme"\s*:\s*"https"/.test(req.headers.get('cf-visitor') || '')) res.headers.set('Strict-Transport-Security', 'max-age=31536000');
  res.headers.set('X-Frame-Options', 'DENY');
  // Tile providers may require a Referer. Send only the ORIGIN (never the path/query,
  // so tracking references and tokens never leak) on ordinary pages; keep strict
  // no-referrer on the tracking page and all API/private responses.
  const p = req.nextUrl.pathname;
  const strictNoRef = p === '/track' || p === '/share' || p.startsWith('/api/');
  res.headers.set('Referrer-Policy', strictNoRef ? 'no-referrer' : 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');
  // The start page was shown on this phone: from now on «/» opens the booking screen (2 years).
  if (p === '/welcome' && !req.cookies.has(WELCOME_COOKIE)) {
    res.cookies.set(WELCOME_COOKIE, '1', { path: '/', maxAge: 2 * 365 * 24 * 3600, sameSite: 'lax', httpOnly: true, secure: req.nextUrl.protocol === 'https:' || /"scheme"\s*:\s*"https"/.test(req.headers.get('cf-visitor') || '') });
  }
  return res;
}

export const config = {
  // Apply to everything except static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|manifest-driver.webmanifest).*)'],
};
