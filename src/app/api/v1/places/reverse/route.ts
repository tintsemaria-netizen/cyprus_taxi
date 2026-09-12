import { apiOk, Errors, clientIp } from '@/lib/http';
import { reverseLookup } from '@/lib/places';
import { validCoord } from '@/lib/geo';
import { config } from '@/lib/config';
import { googleConfigured, googleReverse } from '@/server/google';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Parse a required finite numeric query param. Rejects absent/blank/non-numeric,
// but a genuine numeric zero is valid.
function numParam(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = numParam(url.searchParams.get('lat'));
  const lng = numParam(url.searchParams.get('lng'));
  if (lat === null || lng === null || !validCoord({ lat, lng })) {
    return Errors.validation({ _: 'Valid finite lat and lng are required.' });
  }

  // Real Google Geocoding when configured (independent of booking DEMO_MODE).
  if (googleConfigured()) {
    const rl = await rateLimit('reverse', clientIp(req, config.trustedProxyHops), 30, 60);
    if (!rl.ok) return Errors.throttled(rl.retryAfter);
    try {
      return apiOk({ provider: 'google', place: await googleReverse(lat, lng) });
    } catch {
      return apiOk({ provider: 'google', unavailable: true, place: null });
    }
  }

  // Demo fixtures only in explicit demo mode; otherwise report unavailable.
  if (!config.demoMode) return apiOk({ demo: false, unavailable: true, place: null });
  return apiOk({ demo: true, place: reverseLookup(lat, lng) });
}
