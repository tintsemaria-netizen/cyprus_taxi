import { apiOk, Errors, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { rateLimit } from '@/lib/rate-limit';
import { shareSlots } from '@/server/share-slots';

export const dynamic = 'force-dynamic';

// «Попутчик» departure hours for a day and a route: orders already there, people in each, and when I'd arrive
// with each (2026-11-24). Counts and times only — no names or addresses.
export async function GET(req: Request) {
  const rl = await rateLimit('share-slots', clientIp(req, config.trustedProxyHops), 60, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  const q = new URL(req.url).searchParams;
  const day = q.get('day') || '';
  const n = (k: string) => Number(q.get(k));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || ['pLat', 'pLng', 'dLat', 'dLng'].some((k) => !Number.isFinite(n(k)))) return Errors.validation({ _: 'day, pLat, pLng, dLat, dLng required.' });
  const people = Math.min(6, Math.max(1, Math.round(n('pax')) || 1));
  const vClass = q.get('vClass') === 'XL' ? 'XL' : 'COMFORT';
  return apiOk(await shareSlots(day, { lat: n('pLat'), lng: n('pLng') }, { lat: n('dLat'), lng: n('dLng') }, { people, vClass }));
}
