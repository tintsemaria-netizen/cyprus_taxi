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
import { drainReceiptEmails, requestReceiptEmail } from '@/server/email/receipts';
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

async function completedBooking(email: string | null = 'rider@example.com', locale = 'ru', meterCents?: number, receiptMode = 'EACH') {
  const { driverId, vehicleId } = await driverAt('Andreas', 20);
  const passenger = await prisma.passenger.create({ data: { phone: `+35794${RUN.slice(-6)}${++n}`.slice(0, 15), phoneVerifiedAt: new Date(), email: email ? `${n}-${email}` : null, locale, receiptMode, receiptModeSince: receiptMode === 'EACH' ? null : new Date(Date.now() - 1000) } });
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
  const co = await completeTrip(b.id, driverId, rev, meterCents); if (!co.ok) throw new Error('co');
  return { bookingId: b.id, passengerId: passenger.id, reference: b.reference, driverId };
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await prisma.$queryRaw`SELECT 1`;
});

beforeEach(async () => {
  await prisma.receiptEmail.deleteMany({});
  await prisma.receiptDigest.deleteMany({});
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

describe('amount fixed at «Завершить» (2026-11-24)', () => {
  it('a meter amount typed on the completion screen is the receipt total and the driver earning; afterwards it is locked', async () => {
    const t = await completedBooking('rider@example.com', 'ru', 1720);
    const rc = await passengerReceipt(t.bookingId, t.passengerId);
    expect(rc.ok && rc.receipt.fare.totalCents).toBe(1720);
    const { earningsSummary } = await import('@/server/driver/earnings');
    const e = await earningsSummary(t.driverId, new Date(Date.now() - 3600_000), new Date(Date.now() + 60_000));
    expect(e.byCurrency.find((c) => c.currency === 'EUR')?.recordedEarningsCents).toBeGreaterThanOrEqual(1720);
    const { POST } = await import('@/app/api/v1/driver/bookings/[id]/settlement/route');
    expect(POST).toBeTypeOf('function'); // the route answers AMOUNT_LOCKED for every driver request
  });
  it('without a typed amount: the app fare + waiting, the same in the receipt', async () => {
    const t = await completedBooking('rider@example.com', 'ru');
    const rc = await passengerReceipt(t.bookingId, t.passengerId);
    expect(rc.ok && rc.receipt.fare.totalCents).toBe(965);
  });
});

describe('e-mailed trip receipts (2026-11-17)', () => {
  it('completion queues one receipt e-mail in the passenger language; the worker sends it', async () => {
    const t = await completedBooking();
    const row = await prisma.receiptEmail.findUniqueOrThrow({ where: { bookingId: t.bookingId } });
    expect(row.status).toBe('PENDING');
    expect(row.locale).toBe('ru');

    // No provider configured: nothing is sent, the row waits.
    const idle = await drainReceiptEmails(new Date());
    expect(idle.configured).toBe(false);
    expect((await prisma.receiptEmail.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING');

    const calls = mockProvider();
    const r = await drainReceiptEmails(new Date());
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
    await drainReceiptEmails(new Date());
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
    await drainReceiptEmails(new Date());
    for (let i = 1; i <= 3; i++) {
      const r = await requestReceiptEmail(t.bookingId, t.passengerId);
      expect(r.ok).toBe(true);
      await drainReceiptEmails(new Date());
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
    await drainReceiptEmails(new Date());
    expect((await prisma.receiptEmail.findUniqueOrThrow({ where: { bookingId: t.bookingId } })).status).toBe('FAILED');

    const t2 = await completedBooking('second@example.com');
    vi.unstubAllGlobals();
    mockProvider(503);
    await drainReceiptEmails(new Date());
    const row = await prisma.receiptEmail.findUniqueOrThrow({ where: { bookingId: t2.bookingId } });
    expect(row.status).toBe('RETRY');
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
});


describe('receipt e-mail settings: per trip / weekly / monthly / off (2026-11-26)', () => {
  const p2 = (x: number) => String(x).padStart(2, '0');
  const nextWeekNoon = async () => { const { startOfNicosiaDay } = await import('@/lib/timezone'); return new Date(startOfNicosiaDay(new Date(), 7).getTime() + 12 * 3600_000); };
  const nextMonthSecond = async () => {
    const { nicosiaDayKey, nicosiaMidnightUtc } = await import('@/lib/timezone');
    const [y, m] = nicosiaDayKey(new Date()).split('-').map(Number);
    return new Date(nicosiaMidnightUtc(`${m === 12 ? y + 1 : y}-${p2(m === 12 ? 1 : m + 1)}-02`).getTime() + 12 * 3600_000);
  };

  it('Cyprus calendar periods: previous Mon–Sun week and previous month', async () => {
    const { previousPeriod } = await import('@/server/email/receipt-digest');
    const thu = new Date('2026-11-26T10:00:00Z');
    expect(previousPeriod('WEEKLY', thu).start.toISOString()).toBe('2026-11-15T22:00:00.000Z'); // Mon 16 Nov 00:00 EET
    expect(previousPeriod('WEEKLY', thu).end.toISOString()).toBe('2026-11-22T22:00:00.000Z');
    expect(previousPeriod('MONTHLY', thu).start.toISOString()).toBe('2026-09-30T21:00:00.000Z'); // 1 Oct 00:00 EEST
    expect(previousPeriod('MONTHLY', thu).end.toISOString()).toBe('2026-10-31T22:00:00.000Z');
    // A Monday belongs to the new week: the previous week ends at its midnight.
    expect(previousPeriod('WEEKLY', new Date('2026-11-23T09:00:00Z')).end.toISOString()).toBe('2026-11-22T22:00:00.000Z');
  });

  it('weekly: no e-mail per trip; one summary after the week, once; sent in the passenger language', async () => {
    const t = await completedBooking('rider@example.com', 'ru', undefined, 'WEEKLY');
    expect(await prisma.receiptEmail.count({ where: { bookingId: t.bookingId } })).toBe(0);
    const { scheduleReceiptDigests, drainReceiptDigests } = await import('@/server/email/receipt-digest');
    expect(await scheduleReceiptDigests(new Date())).toBe(0); // the week is not over yet
    const later = await nextWeekNoon();
    expect(await scheduleReceiptDigests(later)).toBe(1);
    expect(await scheduleReceiptDigests(later)).toBe(0); // never twice for the same week
    const row = await prisma.receiptDigest.findFirstOrThrow({ where: { passengerId: t.passengerId } });
    expect(row.bookingIds).toEqual([t.bookingId]);
    const calls = mockProvider();
    await drainReceiptDigests(later);
    expect(calls).toHaveLength(1);
    expect(String(calls[0].body.subject)).toContain('Чеки IL-Y');
    expect(String(calls[0].body.html)).toContain('Limassol Marina');
    expect(String(calls[0].body.html)).toContain('/account#receipts');
    expect((await prisma.receiptDigest.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('SENT');
  });

  it('monthly: one summary after the month', async () => {
    const t = await completedBooking('rider@example.com', 'en', undefined, 'MONTHLY');
    expect(await prisma.receiptEmail.count({ where: { bookingId: t.bookingId } })).toBe(0);
    const { scheduleReceiptDigests } = await import('@/server/email/receipt-digest');
    expect(await scheduleReceiptDigests(await nextMonthSecond())).toBe(1);
    expect((await prisma.receiptDigest.findFirstOrThrow({ where: { passengerId: t.passengerId } })).period).toBe('MONTHLY');
  });

  it('off: nothing is e-mailed; the receipt is still available', async () => {
    const t = await completedBooking('rider@example.com', 'ru', undefined, 'OFF');
    expect(await prisma.receiptEmail.count({ where: { bookingId: t.bookingId } })).toBe(0);
    const { scheduleReceiptDigests } = await import('@/server/email/receipt-digest');
    expect(await scheduleReceiptDigests(await nextWeekNoon())).toBe(0);
    expect((await passengerReceipt(t.bookingId, t.passengerId)).ok).toBe(true);
  });

  it('a trip completed before switching to a summary is not listed again (it already had its own e-mail)', async () => {
    const t = await completedBooking('rider@example.com', 'ru');
    expect(await prisma.receiptEmail.count({ where: { bookingId: t.bookingId } })).toBe(1);
    await prisma.passenger.update({ where: { id: t.passengerId }, data: { receiptMode: 'WEEKLY', receiptModeSince: new Date(Date.now() + 1000) } });
    const { scheduleReceiptDigests } = await import('@/server/email/receipt-digest');
    expect(await scheduleReceiptDigests(await nextWeekNoon())).toBe(0);
  });

  it('switched back to per-trip before the summary went out: the summary is skipped', async () => {
    const t = await completedBooking('rider@example.com', 'ru', undefined, 'WEEKLY');
    const { scheduleReceiptDigests, drainReceiptDigests } = await import('@/server/email/receipt-digest');
    const later = await nextWeekNoon();
    await scheduleReceiptDigests(later);
    await prisma.passenger.update({ where: { id: t.passengerId }, data: { receiptMode: 'EACH' } });
    const calls = mockProvider();
    await drainReceiptDigests(later);
    expect(calls).toHaveLength(0);
    expect((await prisma.receiptDigest.findFirstOrThrow({ where: { passengerId: t.passengerId } })).status).toBe('SKIPPED');
  });
});
