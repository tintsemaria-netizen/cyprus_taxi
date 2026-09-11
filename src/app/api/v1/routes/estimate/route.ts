import { apiOk, Errors } from '@/lib/http';
import { demoEstimate } from '@/lib/places';
import { validCoord } from '@/lib/geo';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  const { from, to } = (body as { from?: unknown; to?: unknown }) || {};
  if (!validCoord(from as never) || !validCoord(to as never)) {
    return Errors.validation({ _: 'from and to must be valid coordinates.' });
  }
  // Synthetic estimates are demo-only. No real routing ADAPTER is implemented yet,
  // so in live mode we always report ETA unavailable — a provider name/key is not an
  // implemented adapter and must never trigger the straight-line demo estimate.
  if (!config.demoMode) {
    return apiOk({ available: false, reason: 'No routing provider configured.' });
  }
  // DEMO estimate — clearly labelled, never presented as a real road route.
  return apiOk(demoEstimate(from as { lat: number; lng: number }, to as { lat: number; lng: number }));
}
