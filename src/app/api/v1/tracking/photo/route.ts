import { Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { getTrackingBookingId } from '@/lib/tracking';
import { passengerPhotos } from '@/server/driver-photos';
import { readDocument } from '@/server/storage';

export const dynamic = 'force-dynamic';

// The driver's selfie / the car's front photo for the passenger of THIS ride, while a driver is on it
// (2026-11-24). Never a public URL; nothing once the ride is over or the driver is off it.
export async function GET(req: Request) {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  const kind = new URL(req.url).searchParams.get('kind');
  if (kind !== 'driver' && kind !== 'car') return Errors.notFound();
  const active = await prisma.assignment.findFirst({ where: { activeBookingId: bookingId }, select: { driverId: true, vehiclePlate: true } });
  if (!active) return Errors.notFound();
  const ids = await passengerPhotos(active.driverId, active.vehiclePlate);
  const id = kind === 'driver' ? ids.driver : ids.car;
  if (!id) return Errors.notFound();
  const doc = await prisma.applicationDocument.findUnique({ where: { id }, select: { storageKey: true, mime: true } });
  const buf = doc ? await readDocument(doc.storageKey) : null;
  if (!doc || !buf) return Errors.notFound();
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': doc.mime, 'Cache-Control': 'private, max-age=600', 'Content-Disposition': 'inline' } });
}
