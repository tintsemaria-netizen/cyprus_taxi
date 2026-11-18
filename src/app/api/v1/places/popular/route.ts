import { apiOk, Errors, clientIp } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';
import { googleConfigured } from '@/server/google';
import { popularNear } from '@/server/popular';

export const dynamic = 'force-dynamic';

// Popular places around the passenger, nearest first (empty address search box, 2026-11-18).
export async function GET(req: Request) {
  const rl = await rateLimit('places-popular', clientIp(req, config.trustedProxyHops), 30, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  const m = (new URL(req.url).searchParams.get('near') || '').match(/^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/);
  const near = m && Number(m[1]) > 34 && Number(m[1]) < 36 && Number(m[2]) > 32 && Number(m[2]) < 35 ? { lat: Number(m[1]), lng: Number(m[2]) } : { lat: 34.92, lng: 33.2 };
  return apiOk({ places: await popularNear(near, googleConfigured()) });
}
