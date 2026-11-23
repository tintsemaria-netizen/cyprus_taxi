import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// Share board («Табло попутчиков», 2026-11-21): unpaired co-rider pre-bookings are listed for
// other passengers on the same corridor; «ride together» proposes the pair at the OTHER
// passenger's time, the proposer already counts as «yes», the other answers.
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { createBooking } from '@/server/bookings';
import { answerShare, matchPrebookings } from '@/server/share';
import { shareBoard, proposeFromBoard } from '@/server/share-board';
import { createBookingSchema } from '@/lib/validation';

const MIN = 60_000;
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA), Larnaca, Cyprus' };
const lcaNear = { lat: 34.8790, lng: 33.6200, label: 'Larnaca Airport parking, Larnaca, Cyprus' };
const nic1 = { lat: 35.1667, lng: 33.3667, label: '12 Eleftheria Sq, Nicosia 1011, Cyprus' };
const nic2 = { lat: 35.1750, lng: 33.3500, label: '5 Makariou Ave, Nicosia, Cyprus' };
const lim = { lat: 34.6786, lng: 33.0440, label: 'Limassol centre, Limassol, Cyprus' };
const RUN = `${Date.now()}`;
let n = 0;

async function passenger() {
  return prisma.passenger.create({ data: { phone: `+3579${RUN.slice(-5)}${String(++n).padStart(2, '0')}`, phoneVerifiedAt: new Date(), name: 'Secret Name' } });
}
async function ride(pid: string, from: typeof lca, to: typeof lca, hoursAhead: number, o: { wait?: number; early?: number; pax?: number; old?: boolean; arrive?: [number, number] } = {}) {
  const input = createBookingSchema.parse({ pickup: from, dropoff: to, when: 'NOW', vClass: 'COMFORT', passengerCount: o.pax ?? 1, luggageCount: 1, passengerName: 'Secret Name', phone: '+35799123456', shareOptIn: true, shareMaxExtraMin: 20 });
  const r = await createBooking(input, `sb-${RUN}-${++n}`);
  if (!r.ok) throw new Error(r.code);
  const b = await prisma.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
  await prisma.dispatchJob.deleteMany({ where: { bookingId: b.id } });
  return prisma.booking.update({ where: { id: b.id }, data: { passengerId: pid, status: 'REQUESTED', fareCents: 6000, priceType: 'REGULATED_FIXED', scheduledAt: new Date(Date.now() + hoursAhead * 3600_000), shareWaitMin: o.wait ?? 0, shareEarlyMin: o.early ?? 0, shareTermsVersion: o.old ? null : config.share.termsVersion,
    ...(o.arrive ? { arriveFrom: new Date(base + o.arrive[0] * MIN), arriveBy: new Date(base + o.arrive[1] * MIN) } : {}) } });
}
// Arrival windows are given in minutes after this point (tomorrow, a round hour).
const base = Math.ceil((Date.now() + 24 * 3600_000) / 3600_000) * 3600_000;

beforeAll(() => { if (!dbName.endsWith('_test')) throw new Error('Refusing: not a _test DB'); });
beforeEach(async () => {
  await prisma.shareGroup.deleteMany({});
  await prisma.preAssignment.deleteMany({});
  await prisma.notificationOutbox.deleteMany({});
  for (const m of ['chatMessage', 'fare', 'receiptEmail', 'waitingSession', 'driverOffer', 'dispatchJob', 'bookingEvent', 'assignment', 'trackingGrant', 'idempotencyReceipt', 'passengerRating', 'tripRating', 'booking'] as const) {
    await (prisma[m] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({});
  }
});

describe('share board', () => {
  it('TZ 2026-11-23: «ride together» is offered only for a ride that fits BOTH passengers’ terms; nothing private is shown', async () => {
    const a = await passenger(), b = await passenger(), c = await passenger();
    const ra = await ride(a.id, lca, nic1, 24);
    const rb = await ride(b.id, lcaNear, nic2, 25.5); // 1.5 h apart: listed (±1 h reach), but even moving me 1 h does not fit
    expect(await matchPrebookings()).toBe(0);
    const v0 = await shareBoard(a.id);
    expect(v0.mine.map((m) => m.id)).toEqual([ra.id]);
    expect(v0.others).toHaveLength(0);
    expect(v0.all.map((r) => r.id)).toEqual([rb.id]); // still visible in the open list
    // 10 min later, and that passenger can be picked up up to 20 min earlier: fits both, I keep my time.
    const rc = await ride(c.id, lcaNear, nic2, 24 + 10 / 60, { early: 20 });
    const v = await shareBoard(a.id);
    expect(v.others.map((o) => o.id)).toEqual([rc.id]);
    expect(Math.abs(v.others[0].myShiftMin!)).toBeLessThanOrEqual(10); // I (the one choosing) adapt a few minutes
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/Secret Name|\+357|Eleftheria|Makariou/); // no names, phones or streets
  });

  // ---- «Быть на месте» windows (operator 2026-11-23) ----
  it('auto: overlapping windows 12–13 and 11–12:30 → paired; route first, the later one ~10 min before the common end', async () => {
    const a = await passenger(), b = await passenger();
    const h = (base - Date.now()) / 3600_000;
    const ra = await ride(a.id, lca, nic1, h, { arrive: [120, 180] }); // 12:00–13:00 (base = 10:00)
    const rb = await ride(b.id, lcaNear, nic2, h, { arrive: [60, 150] }); // 11:00–12:30
    expect(await matchPrebookings()).toBe(1);
    const g = (await prisma.shareGroup.findFirst({ where: { OR: [{ hostBookingId: ra.id }, { guestBookingId: ra.id }] } }))!;
    expect(g.status).toBe('MATCHED');
    const arr = g.arrivals as { host: number; guest: number };
    const at = (m: number) => g.startAt!.getTime() + m * MIN;
    const [fa, fb] = [g.hostBookingId === ra.id ? arr.host : arr.guest, g.hostBookingId === rb.id ? arr.host : arr.guest].map(at);
    expect(fa).toBeGreaterThanOrEqual(base + 115 * MIN); expect(fa).toBeLessThanOrEqual(base + 170 * MIN);
    expect(fb).toBeGreaterThanOrEqual(base + 55 * MIN); expect(fb).toBeLessThanOrEqual(base + 140 * MIN); // 12:30 − 10 min
    expect(Math.max(fa, fb)).toBeGreaterThanOrEqual(base + 135 * MIN); // near the end of the common part, not early
  });

  it('auto: windows that do not overlap are not paired; the board offers it, asks first, then tells the new arrival time', async () => {
    const a = await passenger(), b = await passenger(), c = await passenger();
    const h = (base - Date.now()) / 3600_000;
    const ra = await ride(a.id, lca, nic1, h, { arrive: [180, 240] }); // 13:00–14:00
    const rb = await ride(b.id, lcaNear, nic2, h, { arrive: [270, 300] }); // 14:30–15:00
    await ride(c.id, lcaNear, nic2, h, { arrive: [420, 480] }); // 17:00–18:00: beyond ±1 h, not shown
    expect(await matchPrebookings()).toBe(0);
    const v = await shareBoard(a.id);
    expect(v.others.map((o) => o.id)).toEqual([rb.id]);
    expect(v.all).toHaveLength(0);
    expect(v.others[0].myOutside).toBe(true);
    const r1 = await proposeFromBoard(a.id, ra.id, rb.id);
    expect(r1).toMatchObject({ ok: false, code: 'OUTSIDE_WINDOW' });
    const r = await proposeFromBoard(a.id, ra.id, rb.id, new Date(), true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const myAt = new Date(r.arriveAt).getTime();
    expect(myAt).toBeGreaterThan(base + 240 * MIN); // after my own window — I agreed
    expect(myAt).toBeLessThanOrEqual(base + 300 * MIN);
    const g = await prisma.shareGroup.findUniqueOrThrow({ where: { id: r.proposalId } });
    expect(g.status).toBe('MATCHED');
    const arr = g.arrivals as { host: number; guest: number };
    const bAt = g.startAt!.getTime() + (g.hostBookingId === rb.id ? arr.host : arr.guest) * MIN;
    expect(bAt).toBeGreaterThanOrEqual(base + 265 * MIN); expect(bAt).toBeLessThanOrEqual(base + 290 * MIN); // theirs kept, with the buffer
    const fa = await prisma.booking.findUniqueOrThrow({ where: { id: ra.id } });
    expect(fa.arriveBy!.getTime()).toBeGreaterThanOrEqual(myAt); // my window now covers what I agreed to
  });

  it('hides other corridors and rides inside the last 4 h; the open board shows everyone else\'s rides to anyone', async () => {
    const a = await passenger(), b = await passenger(), c = await passenger(), d = await passenger();
    const ra = await ride(a.id, lca, nic1, 24);
    const rb = await ride(b.id, lca, lim, 24); // different destination
    await ride(c.id, lcaNear, nic2, 3); // within 4 h (settings.shareBoardHideMinutes)
    expect((await shareBoard(a.id)).others).toHaveLength(0);
    // 2026-11-22 (operator): the board is open — a passenger with no ride of his own sees all listed rides.
    const none = await shareBoard(d.id);
    expect(none.mine).toHaveLength(0);
    expect(none.others).toHaveLength(0);
    expect(none.all.map((r) => r.id).sort()).toEqual([ra.id, rb.id].sort());
    expect(JSON.stringify(none)).not.toMatch(/Secret Name|\+357|Eleftheria|Makariou/);
    expect((await shareBoard(a.id)).all.map((r) => r.id)).toEqual([rb.id]); // never my own ride
  });

  it('a driver (same phone as a driver account) gets no board and cannot propose', async () => {
    const d = await prisma.driver.findFirstOrThrow({ where: { publicName: 'Andreas' } });
    const asPax = await prisma.passenger.create({ data: { phone: d.phone, phoneVerifiedAt: new Date(), name: 'Driver as passenger' } }).catch(async () => prisma.passenger.findUniqueOrThrow({ where: { phone: d.phone } }));
    const b = await passenger();
    const rb = await ride(b.id, lca, nic1, 24);
    const v = await shareBoard(asPax.id);
    expect(v.driver).toBe(true);
    expect(v.all).toHaveLength(0);
    const mine = await ride(asPax.id, lcaNear, nic2, 25);
    const r = await proposeFromBoard(asPax.id, mine.id, rb.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('DRIVER_ACCOUNT');
  });

  it('a pre-booking with a co-rider must be at least 3 h ahead (admin setting)', async () => {
    const at = new Date(Date.now() + 2 * 3600_000).toLocaleString('sv-SE', { timeZone: 'Asia/Nicosia' }).slice(0, 16).replace(' ', 'T');
    const input = createBookingSchema.parse({ pickup: lca, dropoff: nic1, when: 'SCHEDULE', scheduledAt: at, vClass: 'COMFORT', passengerCount: 1, luggageCount: 1, passengerName: 'X', phone: '+35799123456', shareOptIn: true });
    const r = await createBooking(input, `sb-soon-${RUN}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SHARE_TOO_SOON');
    const plain = createBookingSchema.parse({ ...input, shareOptIn: false });
    expect((await createBooking(plain, `sb-soon2-${RUN}`)).ok).toBe(true); // without a co-rider 2 h ahead is fine (≥ 1 h)
  });

  it('«ride together» outside the other passenger’s terms is refused (TZ 2026-11-23: nobody is moved to the other’s time)', async () => {
    const a = await passenger(), b = await passenger();
    const ra = await ride(a.id, lca, nic1, 24);
    const rb = await ride(b.id, lcaNear, nic2, 26);
    const r = await proposeFromBoard(a.id, ra.id, rb.id);
    expect(r).toMatchObject({ ok: false, code: 'TOO_FAR' });
  });

  it('«ride together» inside both terms → matched at once; both keep their intervals; −30% for both; one «found» push each', async () => {
    const a = await passenger(), b = await passenger();
    const ra = await ride(a.id, lca, nic1, 24);
    const rb = await ride(b.id, lcaNear, nic2, 24 + 10 / 60, { early: 20 });
    const r = await proposeFromBoard(a.id, ra.id, rb.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const g = await prisma.shareGroup.findUniqueOrThrow({ where: { id: r.proposalId } });
    expect(g.status).toBe('MATCHED');
    // Nobody is asked; both hear «confirmed, −30%».
    expect(await prisma.notificationOutbox.count({ where: { title: 'A co-rider for your ride' } })).toBe(0);
    const conf = await prisma.notificationOutbox.findMany({ where: { audience: { in: [`PASSENGER:${ra.id}`, `PASSENGER:${rb.id}`] } } });
    expect(conf.map((n) => (n.msg as { k: string }).k)).toEqual(['share.found', 'share.found']);
    const [fa, fb] = await Promise.all([prisma.booking.findUniqueOrThrow({ where: { id: ra.id } }), prisma.booking.findUniqueOrThrow({ where: { id: rb.id } })]);
    expect(Math.abs(fa.scheduledAt!.getTime() - ra.scheduledAt!.getTime())).toBeLessThanOrEqual(10 * MIN); // I adapt a little
    expect(fb.scheduledAt!.getTime()).toBeLessThanOrEqual(rb.scheduledAt!.getTime()); // inside their interval
    expect(fb.scheduledAt!.getTime()).toBeGreaterThanOrEqual(rb.scheduledAt!.getTime() - 20 * MIN)
    expect(fa.fareCents).toBe(4200); // 30 % off for both
    expect(fb.fareCents).toBe(4200);
  });

  it('cannot use someone else’s ride as mine, nor pair a ride that is already paired', async () => {
    const a = await passenger(), b = await passenger();
    const ra = await ride(a.id, lca, nic1, 24);
    const rb = await ride(b.id, lcaNear, nic2, 24 + 10 / 60, { early: 20 });
    expect((await proposeFromBoard(a.id, rb.id, ra.id)).ok).toBe(false);
    const r = await proposeFromBoard(a.id, ra.id, rb.id);
    if (!r.ok) throw new Error('propose');
    expect((await proposeFromBoard(a.id, ra.id, rb.id)).ok).toBe(false);
  });
});
