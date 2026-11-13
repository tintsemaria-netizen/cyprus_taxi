import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Passenger pre-bookings (2026-11-13): "My pre-bookings" list, the ~1 hour reminder (home card
// flag + exactly-once push), and account-wide push audience for a signed-in passenger's rides.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => new Headers(),
}));

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { createEmailPassenger, createPassengerSession } from '@/server/passenger';
import { runPassengerReminders } from '@/server/dispatch/passenger-reminders';
import { audiencesFor } from '@/server/push';
import * as prebookingsRoute from '@/app/api/v1/passenger/prebookings/route';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const RUN = `${Date.now()}`;
let n = 0;

async function passenger() {
  jar.clear();
  const p = await createEmailPassenger({ email: `pb${RUN}${++n}@example.com`, passwordHash: 'x', name: 'Ana' });
  await createPassengerSession(p.id);
  return p;
}
async function prebook(passengerId: string, minutesAhead: number) {
  const r = await createBooking({ pickup: lca, dropoff: marina, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'Ana', phone: '+35799123456' } as CreateBookingInput, `pb-${RUN}-${++n}`, undefined, passengerId);
  if (!r.ok) throw new Error('create');
  const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
  await prisma.dispatchJob.deleteMany({ where: { bookingId: b.id } });
  return prisma.booking.update({ where: { id: b.id }, data: { status: 'REQUESTED', scheduledAt: new Date(Date.now() + minutesAhead * 60_000) } });
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
});
beforeEach(() => { jar.clear(); });

describe('passenger pre-bookings', () => {
  it('lists upcoming pre-bookings soonest first, flags the one within the hour', async () => {
    const p = await passenger();
    const later = await prebook(p.id, 300);
    const soon = await prebook(p.id, 45);
    const res = await prebookingsRoute.GET();
    expect(res.status).toBe(200);
    const { prebookings } = await res.json();
    expect(prebookings.map((x: { id: string }) => x.id)).toEqual([soon.id, later.id]);
    expect(prebookings[0].soon).toBe(true);
    expect(prebookings[1].soon).toBe(false);
    jar.clear();
    expect((await prebookingsRoute.GET()).status).toBe(401);
  });

  it('sends the ~1 hour reminder exactly once, only within the hour', async () => {
    const p = await passenger();
    const far = await prebook(p.id, 120);
    const near = await prebook(p.id, 50);
    await runPassengerReminders();
    await runPassengerReminders(); // second tick: no duplicate
    const q = (id: string) => prisma.notificationOutbox.count({ where: { audience: `PASSENGER:${id}`, dedupeKey: `passenger-remind:${id}` } });
    expect(await q(near.id)).toBe(1);
    expect(await q(far.id)).toBe(0);
    expect((await prisma.booking.findUnique({ where: { id: near.id } }))!.passengerRemindedAt).not.toBeNull();
    // A cancelled ride is not reminded.
    const cancelled = await prebook(p.id, 40);
    await prisma.booking.update({ where: { id: cancelled.id }, data: { status: 'CANCELED' } });
    await runPassengerReminders();
    expect(await q(cancelled.id)).toBe(0);
  });

  it('a ride notification also reaches the owner\'s account devices', async () => {
    const p = await passenger();
    const b = await prebook(p.id, 200);
    expect(await audiencesFor(`PASSENGER:${b.id}`)).toEqual([`PASSENGER:${b.id}`, `PASSENGER_ACCOUNT:${p.id}`]);
    expect(await audiencesFor('DRIVER:x')).toEqual(['DRIVER:x']);
  });
});
