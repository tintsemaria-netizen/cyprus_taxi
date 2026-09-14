import { describe, it, expect, beforeAll } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { getDriverActiveOffer } from '@/server/dispatch/offers';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput => ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 3, passengerName: 'Nikos', phone: '+35799123456', note: 'Two suitcases' } as CreateBookingInput);
const RUN = `${Date.now()}`;
let n = 0;

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await prisma.$queryRaw`SELECT 1`;
});

describe('driver offer — complete order data', () => {
  it('exposes the full fare breakdown + passenger info to the offered driver', async () => {
    const d = await prisma.driver.findFirst({ where: { publicName: 'Andreas' }, include: { bindings: { where: { endedAt: null } } } });
    if (!d || !d.bindings[0]) throw new Error('fixture Andreas missing');
    const r = await createBooking(input(), `off-${RUN}-${++n}`);
    if (!r.ok) throw new Error('create failed');
    const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
    // Give the booking a priced quote snapshot + keep it SEARCHING.
    await prisma.booking.update({
      where: { id: b.id },
      data: { status: 'SEARCHING', priceType: 'REGULATED_METER_ESTIMATE', fareCents: 7883, fareBreakdown: JSON.stringify([{ code: 'initial', label: 'Initial hire', cents: 480 }, { code: 'distance', label: 'Distance 67.3 km', cents: 7403 }]) },
    });
    const offer = await prisma.driverOffer.create({
      data: { bookingId: b.id, driverId: d.id, vehicleId: d.bindings[0].vehicleId, status: 'OFFERED', pickupEtaSec: 240, pickupDistanceM: 1800, expiresAt: new Date(Date.now() + 20_000), activeBookingId: b.id, activeDriverId: d.id },
    });

    const view = await getDriverActiveOffer(d.id);
    expect(view).not.toBeNull();
    expect(view!.offerId).toBe(offer.id);
    expect(view!.passengerName).toBe('Nikos');
    expect(view!.passengerCount).toBe(3);
    expect(view!.note).toBe('Two suitcases');
    expect(view!.priceType).toBe('REGULATED_METER_ESTIMATE');
    expect(view!.fareCents).toBe(7883);
    expect(view!.pickupDistanceM).toBe(1800);
    expect(view!.dropoff.lat).toBeCloseTo(lca.lat, 3); // full dropoff coords, not just a label
    expect(view!.fareBreakdown).toHaveLength(2);
    expect(view!.fareBreakdown![1]).toMatchObject({ label: 'Distance 67.3 km', cents: 7403 });
  });
});
