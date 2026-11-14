import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import type { CreateBookingInput } from '@/lib/validation';
import { savePassengerLocation, clearPassengerLocation, passengerLocationForDriver, purgePassengerLocations } from '@/server/passenger-location';

// Opt-in passenger location for the driver, before pickup only (2026-11-15).
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);

const RUN = `${Date.now()}`;
const input = { pickup: { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' }, dropoff: { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' }, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'Loc', phone: '+35799123456' } as CreateBookingInput;
let n = 0;
async function booking(status: string) {
  const r = await createBooking(input, `pl-${RUN}-${++n}`);
  if (!r.ok) throw new Error('create');
  return prisma.booking.update({ where: { reference: (r.body as { reference: string }).reference }, data: { status: status as never } });
}

describe('passenger location sharing', () => {
  it('stores only before pickup, shows the driver only fresh fixes', async () => {
    const searching = await booking('SEARCHING');
    expect(await savePassengerLocation(searching.id, { lat: 34.67, lng: 33.04, accuracyM: 8 })).toBe('not_active');
    const b = await booking('EN_ROUTE');
    const t0 = new Date();
    expect(await savePassengerLocation(b.id, { lat: 34.6707, lng: 33.0414, accuracyM: 8 }, t0)).toBe('ok');
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(passengerLocationForDriver(row, t0)).toMatchObject({ lat: 34.6707, lng: 33.0414, accuracyM: 8, ageSec: 0 });
    expect(passengerLocationForDriver(row, new Date(t0.getTime() + 61_000))).toBeNull(); // stale → hidden
    expect(passengerLocationForDriver({ ...row, status: 'IN_PROGRESS' }, t0)).toBeNull();  // after pickup → hidden
    await clearPassengerLocation(b.id);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).passengerLat).toBeNull();
  });

  it('worker purge: after pickup and when older than 5 minutes', async () => {
    const picked = await booking('EN_ROUTE');
    await savePassengerLocation(picked.id, { lat: 34.67, lng: 33.04, accuracyM: 5 });
    await prisma.booking.update({ where: { id: picked.id }, data: { status: 'IN_PROGRESS' } });
    const old = await booking('ARRIVED');
    await savePassengerLocation(old.id, { lat: 34.67, lng: 33.04, accuracyM: 5 }, new Date(Date.now() - 6 * 60_000));
    const fresh = await booking('ARRIVED');
    await savePassengerLocation(fresh.id, { lat: 34.67, lng: 33.04, accuracyM: 5 });
    await purgePassengerLocations();
    const get = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id } });
    expect((await get(picked.id)).passengerLocAt).toBeNull();
    expect((await get(old.id)).passengerLocAt).toBeNull();
    expect((await get(fresh.id)).passengerLocAt).not.toBeNull();
  });
});
