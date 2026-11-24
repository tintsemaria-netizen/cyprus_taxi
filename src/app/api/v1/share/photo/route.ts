import { Errors, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { resolveShareToken } from '@/lib/tracking';
import { passengerPhotos, photoFile } from '@/server/driver-photos';
import { readDocument } from '@/server/storage';

export const dynamic = 'force-dynamic';

// «Поделиться поездкой» (2026-11-24, operator): the car's front photo for the people the passenger shared
// the trip with — never the driver's photo. Token in the POST body (as /share/view), only while a driver
// is on the ride.
export async function POST(req: Request) {
  const rl = await rateLimit('share-photo', clientIp(req, config.trustedProxyHops), 30, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  let body: { token?: unknown };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const token = typeof body.token === 'string' ? body.token : '';
  const bookingId = token.length >= 20 ? await resolveShareToken(token) : null;
  if (!bookingId) return Errors.notFound();
  const active = await prisma.assignment.findFirst({ where: { activeBookingId: bookingId }, select: { driverId: true, vehiclePlate: true } });
  if (!active) return Errors.notFound();
  const id = (await passengerPhotos(active.driverId, active.vehiclePlate)).car;
  const doc = id ? await photoFile(id) : null;
  const buf = doc ? await readDocument(doc.storageKey) : null;
  if (!doc || !buf) return Errors.notFound();
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': doc.mime, 'Cache-Control': 'private, no-store' } });
}
