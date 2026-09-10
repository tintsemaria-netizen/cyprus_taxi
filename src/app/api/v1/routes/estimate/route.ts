import { apiOk, Errors } from '@/lib/http';
import { demoEstimate } from '@/lib/places';
import { validCoord } from '@/lib/geo';

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
  // DEMO estimate — clearly labelled, never presented as a real road route.
  return apiOk(demoEstimate(from as { lat: number; lng: number }, to as { lat: number; lng: number }));
}
