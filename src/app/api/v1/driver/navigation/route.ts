import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { validCoord } from '@/lib/geo';
import { isLocale } from '@/i18n/config';
import { prisma } from '@/lib/db';
import { googleConfigured, googleNavRoute } from '@/server/google';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Turn-by-turn route for the driver's ACTIVE trip: to the pickup before the passenger is on board,
// to the destination once IN_PROGRESS. The target always comes from the driver's own active
// assignment (never from the client); the origin is the phone's current fix. No simulated route
// without a real router — the client then offers external navigation instead.
export async function POST(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: { from?: unknown; heading?: unknown; lang?: unknown };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  if (!validCoord(body.from as never)) return Errors.validation({ from: 'from must be a valid coordinate.' });
  const from = body.from as { lat: number; lng: number };
  const heading = typeof body.heading === 'number' && Number.isFinite(body.heading) ? body.heading : null;
  const lang = isLocale(body.lang) ? body.lang : 'en';

  const active = await prisma.assignment.findFirst({ where: { activeDriverId: ctx.driver.id }, include: { booking: true } });
  if (!active) return apiOk({ available: false, reason: 'NO_TRIP' });
  const b = active.booking;
  const leg = b.status === 'IN_PROGRESS' ? 'dropoff' : 'pickup';
  const to = leg === 'dropoff' ? { lat: b.dropoffLat, lng: b.dropoffLng } : { lat: b.pickupLat, lng: b.pickupLng };
  const base = { bookingId: b.id, status: b.status, leg, target: to };
  if (b.status === 'ARRIVED') return apiOk({ ...base, available: false, reason: 'ARRIVED' });
  if (!googleConfigured()) return apiOk({ ...base, available: false, reason: 'NO_ROUTER' });

  // Rerouting is client-driven (off-route / periodic); bound it per driver.
  const rl = await rateLimit('driver-nav', ctx.driver.id, 20, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  try {
    const r = await googleNavRoute({ ...from, heading }, to, lang, { timeoutMs: 8000 });
    if (!r) return apiOk({ ...base, available: false, reason: 'NO_ROUTE' });
    return apiOk({ ...base, available: true, ...r });
  } catch {
    return apiOk({ ...base, available: false, reason: 'ROUTER_ERROR' });
  }
}
