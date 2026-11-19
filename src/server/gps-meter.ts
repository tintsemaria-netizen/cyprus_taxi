import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { computeGpsMeter, type GpsMeter } from '@/lib/gps-meter';

// GPS taximeter for one ride (see src/lib/gps-meter.ts): the driver's GPS samples from the
// moment the trip started (TRIP_STARTED) until now / completion. By driver + time window, so a
// shared ride's second leg and samples without a booking link are counted too.
type Db = Prisma.TransactionClient | typeof prisma;

export async function gpsMeterFor(db: Db, bookingId: string, driverId: string, until: Date = new Date()): Promise<GpsMeter | null> {
  const started = await db.bookingEvent.findFirst({ where: { bookingId, type: 'TRIP_STARTED' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  if (!started) return null;
  const b = await db.booking.findUnique({ where: { id: bookingId }, select: { luggageCount: true, passengerCount: true, vClass: true } });
  if (!b) return null;
  const pts = await db.gpsSample.findMany({
    where: { driverId, sampledAt: { gte: started.createdAt, lte: until } },
    select: { lat: true, lng: true, accuracyM: true, sampledAt: true },
    orderBy: { sampledAt: 'asc' },
    take: 20_000,
  });
  return computeGpsMeter(pts, { startedAt: started.createdAt, luggageCount: b.luggageCount, passengerCount: b.passengerCount, vClass: b.vClass });
}
