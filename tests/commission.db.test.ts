import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// Launch fixes §9: commission ledger in CALCULATION mode — rounding, replays, corrections,
// concurrent payment + accrual, partial payment, cancellation, mode off.
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import { arriveAtPickup, startTrip, completeTrip } from '@/server/dispatch/lifecycle';
import { reportSettlement } from '@/server/driver/settlement';
import { commissionCents, accrueCommissionTx, recordManualEntry, commissionSummary, commissionCsv } from '@/server/commission';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
let n = 0;
const RUN = `${Date.now()}`;
const saved = process.env.COMMISSION_MODE;

async function completedMeterRide() {
  const d = await prisma.driver.findFirst({ where: { publicName: 'Andreas' }, include: { bindings: { where: { endedAt: null } } } });
  if (!d) throw new Error('fixture');
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  const pos = { lat: marina.lat + 0.0002, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `cm-${RUN}`, sequence: ++n };
  await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: pos, create: { driverId: d.id, ...pos } });
  const r = await createBooking({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'C', phone: '+35799123456' } as CreateBookingInput, `cm-${RUN}-${++n}`);
  if (!r.ok) throw new Error('create');
  const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
  await prisma.dispatchJob.deleteMany({ where: { bookingId: b.id } });
  const a = await assignBooking({ bookingId: b.id, driverId: d.id, vehicleId: d.bindings[0].vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true }); if (!a.ok) throw new Error('a');
  const er = await changeStatus({ bookingId: b.id, to: 'EN_ROUTE', expectedRevision: a.revision, actor: 'DRIVER', driverId: d.id, actorId: 'u' }); if (!er.ok) throw new Error('er');
  const ar = await arriveAtPickup(b.id, d.id, er.revision); if (!ar.ok) throw new Error('ar');
  const code = (await prisma.booking.findUnique({ where: { id: b.id } }))!.startCode!;
  const st = await startTrip(b.id, d.id, ar.revision, code); if (!st.ok) throw new Error('st');
  const co = await completeTrip(b.id, d.id, st.revision); if (!co.ok) throw new Error('co');
  return { bookingId: b.id, driverId: d.id };
}
const sumFor = async (bookingId: string) => (await prisma.commissionEntry.aggregate({ where: { bookingId }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error('Refusing: not a _test DB');
});
beforeEach(async () => {
  process.env.COMMISSION_MODE = 'calc';
  await prisma.commissionEntry.deleteMany({});
  await prisma.commissionRule.deleteMany({});
  // Synthetic test rule — NOT a business rate.
  await prisma.commissionRule.create({ data: { version: 1, rateBp: 1250, effectiveFrom: new Date(Date.now() - 86_400_000), note: 'synthetic test rule', createdById: 'test' } });
});
afterAll(() => { if (saved == null) delete process.env.COMMISSION_MODE; else process.env.COMMISSION_MODE = saved; });

describe('§9 commission (calculation mode)', () => {
  it('rounds half away from zero in integer cents', () => {
    expect(commissionCents(1000, 1250)).toBe(125);
    expect(commissionCents(1004, 1250)).toBe(126); // 125.5 → 126
    expect(commissionCents(1003, 1250)).toBe(125); // 125.375 → 125
    expect(commissionCents(-1004, 1250)).toBe(-126);
    expect(commissionCents(0, 1250)).toBe(0);
  });

  it('nothing accrues until the meter amount is confirmed; then once; replays book nothing', async () => {
    const t = await completedMeterRide();
    expect(await sumFor(t.bookingId)).toBe(0); // meter ride, amount not entered yet
    expect((await reportSettlement(t.driverId, t.bookingId, { reportedFinalCents: 2004 })).ok).toBe(true);
    expect(await sumFor(t.bookingId)).toBe(251); // 12.5 % of 20.04 = 2.505 → 2.51
    await prisma.$transaction((tx) => accrueCommissionTx(tx, t.bookingId)); // replay
    await prisma.$transaction((tx) => accrueCommissionTx(tx, t.bookingId));
    expect(await prisma.commissionEntry.count({ where: { bookingId: t.bookingId } })).toBe(1);
  });

  it('a corrected amount books an ADJUSTMENT for the difference (history kept)', async () => {
    const t = await completedMeterRide();
    await reportSettlement(t.driverId, t.bookingId, { reportedFinalCents: 2000 });
    await reportSettlement(t.driverId, t.bookingId, { reportedFinalCents: 2400, correctionReason: 'meter re-read', expectedRevision: 1 });
    const rows = await prisma.commissionEntry.findMany({ where: { bookingId: t.bookingId }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.kind, r.amountCents])).toEqual([['ACCRUAL', 250], ['ADJUSTMENT', 50]]);
    expect(await sumFor(t.bookingId)).toBe(300);
  });

  it('payment: reference required, idempotent, partial payments leave the balance; concurrent with accrual', async () => {
    const t = await completedMeterRide();
    expect((await recordManualEntry({ driverId: t.driverId, kind: 'PAYMENT', amountCents: 100, reference: '', staffId: 'admin' })).ok).toBe(false);
    const [, p1, p2] = await Promise.all([
      reportSettlement(t.driverId, t.bookingId, { reportedFinalCents: 4000 }), // accrues 500
      recordManualEntry({ driverId: t.driverId, kind: 'PAYMENT', amountCents: 200, reference: 'CASH-001', staffId: 'admin' }),
      recordManualEntry({ driverId: t.driverId, kind: 'PAYMENT', amountCents: 200, reference: 'CASH-001', staffId: 'admin' }), // same receipt twice
    ]);
    expect(p1.ok && p2.ok).toBe(true);
    expect(await prisma.commissionEntry.count({ where: { driverId: t.driverId, kind: 'PAYMENT' } })).toBe(1);
    const row = (await commissionSummary()).find((r) => r.driverId === t.driverId)!;
    expect(row.accruedCents).toBe(500);
    expect(row.paidCents).toBe(200);
    expect(row.balanceCents).toBe(300);
    const csv = await commissionCsv(new Date(Date.now() - 3600_000), new Date(Date.now() + 60_000));
    expect(csv.split('\n')[0]).toContain('confirmed_total_cents');
    expect(csv).toContain('CALCULATION');
    expect(csv).not.toMatch(/\+357/); // no phone numbers
  });

  it('cancelled ride and mode off → nothing accrues', async () => {
    const r = await createBooking({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'C', phone: '+35799123456' } as CreateBookingInput, `cm-${RUN}-${++n}`);
    if (!r.ok) throw new Error('create');
    const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
    await changeStatus({ bookingId: b.id, to: 'CANCELED', expectedRevision: b.revision, actor: 'PASSENGER', reason: 'x' });
    expect(await prisma.$transaction((tx) => accrueCommissionTx(tx, b.id))).toBeNull();
    process.env.COMMISSION_MODE = 'off';
    const t = await completedMeterRide();
    await reportSettlement(t.driverId, t.bookingId, { reportedFinalCents: 2000 });
    expect(await sumFor(t.bookingId)).toBe(0);
  });
});
