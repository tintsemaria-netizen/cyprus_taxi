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
async function ride(pid: string, from: typeof lca, to: typeof lca, hoursAhead: number, o: { wait?: number; early?: number; pax?: number; old?: boolean } = {}) {
  const input = createBookingSchema.parse({ pickup: from, dropoff: to, when: 'NOW', vClass: 'COMFORT', passengerCount: o.pax ?? 1, luggageCount: 1, passengerName: 'Secret Name', phone: '+35799123456', shareOptIn: true, shareMaxExtraMin: 20 });
  const r = await createBooking(input, `sb-${RUN}-${++n}`);
  if (!r.ok) throw new Error(r.code);
  const b = await prisma.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
  await prisma.dispatchJob.deleteMany({ where: { bookingId: b.id } });
  return prisma.booking.update({ where: { id: b.id }, data: { passengerId: pid, status: 'REQUESTED', fareCents: 6000, priceType: 'REGULATED_FIXED', scheduledAt: new Date(Date.now() + hoursAhead * 3600_000), shareWaitMin: o.wait ?? 0, shareEarlyMin: o.early ?? 0, shareTermsVersion: o.old ? null : config.share.termsVersion } });
}

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
    const rb = await ride(b.id, lcaNear, nic2, 26); // 2 h apart, nobody flexible → nobody is moved to the other's time
    expect(await matchPrebookings()).toBe(0);
    const v0 = await shareBoard(a.id);
    expect(v0.mine.map((m) => m.id)).toEqual([ra.id]);
    expect(v0.others).toHaveLength(0);
    expect(v0.all.map((r) => r.id)).toEqual([rb.id]); // still visible in the open list
    // 10 min later, and that passenger can be picked up up to 20 min earlier: fits both, I keep my time.
    const rc = await ride(c.id, lcaNear, nic2, 24 + 10 / 60, { early: 20 });
    const v = await shareBoard(a.id);
    expect(v.others.map((o) => o.id)).toEqual([rc.id]);
    expect(v.others[0].myShiftMin).toBe(0);
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/Secret Name|\+357|Eleftheria|Makariou/); // no names, phones or streets
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
    expect(fa.scheduledAt!.getTime()).toBe(ra.scheduledAt!.getTime()); // my time kept (no flexibility)
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
