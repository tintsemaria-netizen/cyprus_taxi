import { apiOk, Errors } from '@/lib/http';
import { reverseLookup } from '@/lib/places';
import { validCoord } from '@/lib/geo';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Demo-only reverse geocode. In live mode (no real adapter) report unavailable so
// the client shows honest coordinates instead of a fabricated address.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  if (!validCoord({ lat, lng })) return Errors.validation({ _: 'lat/lng required.' });
  if (!config.demoMode) return apiOk({ demo: false, unavailable: true, place: null });
  return apiOk({ demo: true, place: reverseLookup(lat, lng) });
}
