import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Derive the tile host so CSP can allow exactly that origin for map imagery.
function tileOrigin(): string {
  try {
    return new URL((process.env.NEXT_PUBLIC_MAP_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png').replace(/\{[^}]+\}/g, '0')).origin;
  } catch {
    return 'https://tile.openstreetmap.org';
  }
}

export function middleware(_req: NextRequest) {
  const res = NextResponse.next();
  const tiles = tileOrigin();
  const csp = [
    "default-src 'self'",
    // Next.js injects inline bootstrap scripts; MapLibre uses blob workers.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${tiles}`,
    `connect-src 'self' ${tiles}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');
  return res;
}

export const config = {
  // Apply to everything except static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-maskable.svg|manifest.webmanifest).*)'],
};
