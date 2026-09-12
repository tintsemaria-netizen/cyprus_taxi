import { apiOk, Errors } from '@/lib/http';
import { reverseLookup } from '@/lib/places';
import { validCoord } from '@/lib/geo';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Demo-only reverse geocode. In live mode (no real adapter) report unavailable so
// the client shows honest coordinates instead of a fabricated address.
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
  if (!config.demoMode) return apiOk({ demo: false, unavailable: true, place: null });
  return apiOk({ demo: true, place: reverseLookup(lat, lng) });
}
