import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { enqueuePassengerDriverNews } from '@/server/push';
import type { CreateBookingInput } from '@/lib/validation';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);

const base = { pickup: { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' }, dropoff: { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' }, vClass: 'COMFORT', passengerCount: 1, passengerName: 'Zed', phone: '+35799123456' };
const notes = (id: string) => prisma.notificationOutbox.count({ where: { audience: `PASSENGER:${id}` } });

describe('driver news for the passenger (2026-11-19)', () => {
  it('pre-booked ride: one «driver assigned», no driver-change notices', async () => {
    const r = await createBooking({ ...base, when: 'NOW' } as unknown as CreateBookingInput, `pdn-${Date.now()}-a`);
    if (!r.ok) throw new Error(JSON.stringify(r));
    const made = await prisma.booking.findUniqueOrThrow({ where: { reference: (r.body as { reference: string }).reference } });
    await prisma.dispatchJob.deleteMany({ where: { bookingId: made.id } });
    const b = await prisma.booking.update({ where: { id: made.id }, data: { status: 'REQUESTED', scheduledAt: new Date(Date.now() + 26 * 3600_000) } });
    const before = await notes(b.id);
    await enqueuePassengerDriverNews(prisma, b.id, 'assigned', 'Driver confirmed', 'x');
    await enqueuePassengerDriverNews(prisma, b.id, 'change', 'Driver change', 'x');
    await enqueuePassengerDriverNews(prisma, b.id, 'assigned', 'Driver assigned', 'x');
    expect(await notes(b.id)).toBe(before + 1);
  });
  it('ride booked now: every driver notice still goes out', async () => {
    const r = await createBooking({ ...base, when: 'NOW' } as unknown as CreateBookingInput, `pdn-${Date.now()}-b`);
    if (!r.ok) throw new Error(JSON.stringify(r));
    const b = await prisma.booking.findUniqueOrThrow({ where: { reference: (r.body as { reference: string }).reference } });
    const before = await notes(b.id);
    await enqueuePassengerDriverNews(prisma, b.id, 'assigned', 'Driver assigned', 'x');
    await enqueuePassengerDriverNews(prisma, b.id, 'change', 'Finding you another driver', 'x');
    expect(await notes(b.id)).toBe(before + 2);
  });
});
