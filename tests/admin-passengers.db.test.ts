import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { listPassengers, passengerRides, passengerDetail, resetPassengerPassword } from '@/server/admin-passengers';
import { verifyPassword, hashPassword } from '@/lib/auth';
import { createBooking } from '@/server/bookings';
import type { CreateBookingInput } from '@/lib/validation';

// Admin "Clients" list (2026-11-14): search and per-client ride counts.
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);

const RUN = `${Date.now()}`;
const input = { pickup: { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' }, dropoff: { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' }, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'Zed', phone: '+35799123456' } as CreateBookingInput;
let n = 0;

describe('admin passengers', () => {
  it('counts rides by status and finds by name/email', async () => {
    const p = await prisma.passenger.create({ data: { name: `Zed ${RUN}`, email: `zed${RUN}@example.com` } });
    for (const status of ['COMPLETED', 'COMPLETED', 'CANCELED'] as const) {
      const r = await createBooking(input, `ap-${RUN}-${++n}`, undefined, p.id);
      if (!r.ok) throw new Error('create');
      await prisma.booking.update({ where: { reference: r.body.reference }, data: { status } });
    }
    const byName = await listPassengers(`zed ${RUN}`);
    expect(byName.total).toBe(1);
    expect(byName.passengers[0]).toMatchObject({ id: p.id, rides: 3, completed: 2, canceled: 1 });
    expect((await listPassengers(`zed${RUN}@EXAMPLE`)).passengers[0]?.id).toBe(p.id);
    expect((await passengerRides(p.id)).length).toBe(3);
  });

  it('reset password: new temp password works, old one fails, sessions revoked, audited', async () => {
    const p = await prisma.passenger.create({ data: { name: `Pw ${RUN}`, email: `pw${RUN}@example.com`, passwordHash: await hashPassword('OldPassword1') } });
    await prisma.passengerSession.create({ data: { passengerId: p.id, sessionDigest: `d-${RUN}`, expiresAt: new Date(Date.now() + 3600e3) } });
    expect((await passengerDetail(p.id))).toMatchObject({ hasPassword: true, activeSessions: 1, email: `pw${RUN}@example.com` });
    const temp = await resetPassengerPassword(p.id, 'admin-test');
    expect(temp).toBeTruthy();
    const after = await prisma.passenger.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.passwordHash).not.toContain(temp!);
    expect(await verifyPassword(temp!, after.passwordHash!)).toBe(true);
    expect(await verifyPassword('OldPassword1', after.passwordHash!)).toBe(false);
    expect((await passengerDetail(p.id))?.activeSessions).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: 'RESET_PASSENGER_PASSWORD', target: p.id } })).toBe(1);
    expect(await resetPassengerPassword('00000000-0000-0000-0000-000000000000', 'admin-test')).toBeNull();
  });
});
