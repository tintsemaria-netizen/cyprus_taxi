import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => {
  try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; }
})();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import { arriveAtPickup, startTrip, completeTrip } from '@/server/dispatch/lifecycle';
import { passengerReceipt } from '@/server/receipt';
import { drainReceiptEmails, requestReceiptEmail, METER_HOLD_MS } from '@/server/email/receipts';
import { reportSettlement } from '@/server/driver/settlement';
// Past the meter-amount hold (launch fixes §6) — the e-mail is due.
const later = () => new Date(Date.now() + METER_HOLD_MS + 1000);
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput =>
  ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Test', phone: '+35799123456' } as CreateBookingInput);

let n = 0;
const RUN = `${Date.now()}`;
const key = () => `rcm-${RUN}-${++n}`;

async function driverAt(name: 'Andreas' | 'Maria', meters: number) {
  const d = await prisma.driver.findFirst({ where: { publicName: name }, include: { bindings: { where: { endedAt: null } } } });
  if (!d || !d.bindings[0]) throw new Error(`fixture ${name} missing`);
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  await prisma.latestDriverLocation.upsert({
    where: { driverId: d.id },
    update: { lat: marina.lat + meters * 0.000009, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `rc-${RUN}`, sequence: ++n },
    create: { driverId: d.id, lat: marina.lat + meters * 0.000009, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `rc-${RUN}`, sequence: ++n },
  });
  return { driverId: d.id, vehicleId: d.bindings[0].vehicleId };
}

async function completedBooking(email: string | null = 'rider@example.com', locale = 'ru') {
  const { driverId, vehicleId } = await driverAt('Andreas', 20);
  const passenger = await prisma.passenger.create({ data: { phone: `+35794${RUN.slice(-6)}${++n}`.slice(0, 15), phoneVerifiedAt: new Date(), email: email ? `${n}-${email}` : null, locale } });
  const r = await createBooking(input(), key());
  if (!r.ok) throw new Error('create failed');
  const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
  // Simulate a quoted booking so the completed Fare carries an estimate + itemised breakdown.
  await prisma.booking.update({
    where: { id: b.id },
    data: {
      passengerId: passenger.id,
      fareCents: 965,
      priceType: 'REGULATED_METER_ESTIMATE',
      fareBreakdown: JSON.stringify([
        { code: 'initial', label: 'Initial hire (day tariff)', cents: 600 },
        { code: 'distance', label: 'Distance 5.0 km × €0.73/km', cents: 365 },
      ]),
    },
  });
  const a = await assignBooking({ bookingId: b.id, driverId, vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
  if (!a.ok) throw new Error('assign failed'); let rev = a.revision;
  const er = await changeStatus({ bookingId: b.id, to: 'EN_ROUTE', expectedRevision: rev, actor: 'DRIVER', driverId, actorId: 'u' }); if (!er.ok) throw new Error('er'); rev = er.revision;
  const ar = await arriveAtPickup(b.id, driverId, rev); if (!ar.ok) throw new Error('ar'); rev = ar.revision;
  const code = (await prisma.booking.findUnique({ where: { id: b.id } }))!.startCode!;
  const st = await startTrip(b.id, driverId, rev, code); if (!st.ok) throw new Error('st'); rev = st.revision;
  const co = await completeTrip(b.id, driverId, rev); if (!co.ok) throw new Error('co');
  return { bookingId: b.id, passengerId: passenger.id, reference: b.reference };
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await prisma.$queryRaw`SELECT 1`;
});

beforeEach(async () => {
  await prisma.receiptEmail.deleteMany({});
  await prisma.passengerRating.deleteMany({});
  await prisma.tripRating.deleteMany({});
  await prisma.chatMessage.deleteMany({});
  await prisma.fare.deleteMany({});
  await prisma.waitingSession.deleteMany({});
  await prisma.driverOffer.deleteMany({});
  await prisma.dispatchJob.deleteMany({});
  await prisma.bookingEvent.deleteMany({});
  await prisma.assignment.deleteMany({});
  await prisma.trackingGrant.deleteMany({});
  await prisma.latestDriverLocation.deleteMany({});
  await prisma.idempotencyReceipt.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.passengerSession.deleteMany({});
  await prisma.passenger.deleteMany({});
  for (const name of ['Andreas', 'Maria', 'Petros']) {
    const d = await prisma.driver.findFirst({ where: { publicName: name } });
    if (d) await prisma.driver.update({ where: { id: d.id }, data: { onDuty: false, available: false } });
  }
});


import { vi, afterEach } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; });

function mockProvider(status = 200) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify(status === 200 ? { id: 'msg_1' } : { message: 'bad' }), { status });
  }));
  process.env.RESEND_API_KEY = 're_test';
  process.env.EMAIL_FROM = 'IL-Y <receipts@il-y.taxi>';
  return calls;
}

describe('e-mailed trip receipts (2026-11-17)', () => {
  it('completion queues one receipt e-mail in the passenger language; the worker sends it', async () => {
    const t = await completedBooking();
    const row = await prisma.receiptEmail.findUniqueOrThrow({ where: { bookingId: t.bookingId } });
    expect(row.status).toBe('PENDING');
    expect(row.locale).toBe('ru');

    // Meter ride: the e-mail is held for the driver's taximeter amount; no provider → nothing sent.
    const idle = await drainReceiptEmails(new Date());
    expect(idle.configured).toBe(false);
    expect((await prisma.receiptEmail.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING');

    const calls = mockProvider();
    const r = await drainReceiptEmails(later());
    expect(r.claimed).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.to).toEqual([row.toEmail]);
    expect(String(calls[0].body.subject)).toContain(t.reference);
    expect(String(calls[0].body.subject)).toContain('Чек');
    expect(String(calls[0].body.html)).toContain('Limassol Marina');
    expect(String(calls[0].body.html)).toMatch(/9,65/); // 965 cents estimate, no waiting
    expect(calls[0].headers['Idempotency-Key']).toBe(`receipt-${t.bookingId}-0`);
    const sent = await prisma.receiptEmail.findUniqueOrThrow({ where: { id: row.id } });
    expect(sent.status).toBe('SENT');
    expect(sent.providerMessageId).toBe('msg_1');

    // The in-app receipt shows the e-mail status (masked address).
    const rc = await passengerReceipt(t.bookingId, t.passengerId);
    expect(rc.ok && rc.receipt.email?.status).toBe('SENT');
    expect(rc.ok && rc.receipt.email?.to).toMatch(/^.•••@example\.com$/);
    expect(rc.ok && rc.receipt.fare.totalCents).toBe(965);

    // A second drain sends nothing more.
    await drainReceiptEmails(later());
    expect(calls).toHaveLength(1);
  });

  it('no e-mail on the account → nothing queued; «send» is refused', async () => {
    const t = await completedBooking(null);
    expect(await prisma.receiptEmail.count({ where: { bookingId: t.bookingId } })).toBe(0);
    const r = await requestReceiptEmail(t.bookingId, t.passengerId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_EMAIL');
  });

  it('«send again» re-queues with a new idempotency key, capped at 3', async () => {
    const t = await completedBooking();
    const calls = mockProvider();
    await drainReceiptEmails(later());
    for (let i = 1; i <= 3; i++) {
      const r = await requestReceiptEmail(t.bookingId, t.passengerId);
      expect(r.ok).toBe(true);
      await drainReceiptEmails(later());
      expect(calls[i].headers['Idempotency-Key']).toBe(`receipt-${t.bookingId}-${i}`);
    }
    const over = await requestReceiptEmail(t.bookingId, t.passengerId);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('RESEND_LIMIT');
    // Another passenger cannot request it.
    const other = await prisma.passenger.create({ data: { email: `x${Date.now()}@example.com` } });
    expect((await requestReceiptEmail(t.bookingId, other.id)).ok).toBe(false);
  });

  it('a rejected address (4xx) fails without retry; a 5xx retries later', async () => {
    const t = await completedBooking();
    mockProvider(422);
    await drainReceiptEmails(later());
    expect((await prisma.receiptEmail.findUniqueOrThrow({ where: { bookingId: t.bookingId } })).status).toBe('FAILED');

    const t2 = await completedBooking('second@example.com');
    vi.unstubAllGlobals();
    mockProvider(503);
    await drainReceiptEmails(later());
    const row = await prisma.receiptEmail.findUniqueOrThrow({ where: { bookingId: t2.bookingId } });
    expect(row.status).toBe('RETRY');
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('launch fixes §6: the driver\'s meter amount releases the e-mail at once and is the total (no «≈»)', async () => {
    const t = await completedBooking();
    const before = await passengerReceipt(t.bookingId, t.passengerId);
    expect(before.ok && before.receipt.fare.totalApprox).toBe(true);
    const asg = await prisma.assignment.findFirstOrThrow({ where: { bookingId: t.bookingId, reason: 'completed' } });
    const s = await reportSettlement(asg.driverId, t.bookingId, { reportedFinalCents: 1840 });
    expect(s.ok).toBe(true);
    const calls = mockProvider();
    await drainReceiptEmails(new Date(Date.now() + 1000)); // well before the hold would end
    expect(calls).toHaveLength(1);
    expect(String(calls[0].body.html)).toMatch(/18,40/);
    expect(String(calls[0].body.html)).not.toContain('≈');
    const after = await passengerReceipt(t.bookingId, t.passengerId);
    expect(after.ok && after.receipt.fare.totalCents).toBe(1840); // meter amount, waiting NOT added again
    expect(after.ok && after.receipt.fare.totalApprox).toBe(false);
  });

  it('launch fixes §3: without a provider, due e-mails are skipped — enabling later sends no backlog', async () => {
    const t = await completedBooking();
    await drainReceiptEmails(later()); // no provider
    expect((await prisma.receiptEmail.findUniqueOrThrow({ where: { bookingId: t.bookingId } })).status).toBe('SKIPPED');
    const calls = mockProvider();
    await drainReceiptEmails(later());
    expect(calls).toHaveLength(0);
    // The passenger can still ask for it explicitly.
    expect((await requestReceiptEmail(t.bookingId, t.passengerId)).ok).toBe(true);
    await drainReceiptEmails(later());
    expect(calls).toHaveLength(1);
  });
});
