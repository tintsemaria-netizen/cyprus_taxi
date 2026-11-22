import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import { arriveAtPickup, startTrip, completeTrip, driverShareNoShow } from '@/server/dispatch/lifecycle';
import { tryLiveShare, answerShare, expireShares, matchPrebookings } from '@/server/share';
import { scheduledBoard, claimScheduled, runPreassignments } from '@/server/dispatch/preassign';
import { driverCurrentTrip, trackingView } from '@/server/views';
import { isShareRoute, sharedCents, bestSharePlan, approxLegMin } from '@/lib/share';
import { createBookingSchema } from '@/lib/validation';

// Ride-share «Попутчик» (Task 022).
const MIN = 60_000;
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const lcaNear = { lat: 34.8790, lng: 33.6200, label: 'Larnaca Airport parking' };
const marina = { lat: 35.1667, lng: 33.3667, label: 'Nicosia, Eleftheria Sq.' }; // "marina" = the host's destination
const limCentre = { lat: 35.1750, lng: 33.3500, label: 'Nicosia, Makariou' };
const limassol = { lat: 34.6786, lng: 33.0440, label: 'Limassol centre' };
const larnacaTown = { lat: 34.9182, lng: 33.6232, label: 'Larnaca town' };
const larnacaTown2 = { lat: 34.9120, lng: 33.6330, label: 'Larnaca Finikoudes' };

const RUN = `${Date.now()}`;
let n = 0;
const key = () => `share-${RUN}-${++n}`;

async function driver(name: 'Andreas' | 'Maria' | 'Petros', opts: { acceptsShared?: boolean; at?: { lat: number; lng: number }; onDuty?: boolean } = {}) {
  const d = await prisma.driver.findFirst({ where: { publicName: name }, include: { bindings: { where: { endedAt: null } } } });
  if (!d || !d.bindings[0]) throw new Error(`fixture ${name} missing`);
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: opts.onDuty ?? true, available: opts.onDuty ?? true, active: true, eligibility: 'LEGACY', acceptsShared: opts.acceptsShared ?? true } });
  const now = new Date();
  const at = opts.at ?? lca;
  await prisma.latestDriverLocation.upsert({
    where: { driverId: d.id },
    update: { lat: at.lat, lng: at.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `s-${RUN}`, sequence: ++n },
    create: { driverId: d.id, lat: at.lat, lng: at.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `s-${RUN}`, sequence: ++n },
  });
  return { driverId: d.id, vehicleId: d.bindings[0].vehicleId };
}

async function booking(from: typeof lca, to: typeof lca, o: { share?: boolean; pax?: number; bags?: number; kids?: number; maxExtra?: number; fare?: number; vClass?: 'COMFORT' | 'XL' } = {}) {
  const input = createBookingSchema.parse({
    pickup: from, dropoff: to, when: 'NOW', vClass: o.vClass ?? 'COMFORT', passengerCount: o.pax ?? 1, luggageCount: o.bags ?? 1,
    passengerName: `P${n}`, phone: '+35799123456', shareOptIn: o.share ?? true, shareMaxExtraMin: o.maxExtra ?? 20, childCount: o.kids ?? 0,
  });
  const r = await createBooking(input, key());
  if (!r.ok) throw new Error(`create: ${r.code}`);
  return prisma.booking.update({ where: { reference: r.body.reference }, data: { fareCents: o.fare ?? 6000, priceType: 'REGULATED_FIXED' } });
}

async function hostOnTrip(d: { driverId: string; vehicleId: string }, o: Parameters<typeof booking>[2] = {}) {
  const b = await booking(lca, marina, o);
  await prisma.dispatchJob.deleteMany({ where: { bookingId: b.id } });
  const a = await assignBooking({ bookingId: b.id, driverId: d.driverId, vehicleId: d.vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
  if (!a.ok) throw new Error(`assign ${a.code}`);
  const e = await changeStatus({ bookingId: b.id, to: 'EN_ROUTE', expectedRevision: a.revision, actor: 'DRIVER', driverId: d.driverId });
  if (!e.ok) throw new Error(`en route ${e.code}`);
  return (await prisma.booking.findUnique({ where: { id: b.id } }))!;
}

const fresh = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
});

beforeEach(async () => {
  await prisma.shareGroup.deleteMany({});
  await prisma.preAssignment.deleteMany({});
  await prisma.notificationOutbox.deleteMany({});
  await prisma.chatMessage.deleteMany({});
  await prisma.fare.deleteMany({});
  await prisma.receiptEmail.deleteMany({});
  await prisma.waitingSession.deleteMany({});
  await prisma.driverOffer.deleteMany({});
  await prisma.dispatchJob.deleteMany({});
  await prisma.bookingEvent.deleteMany({});
  await prisma.assignment.deleteMany({});
  await prisma.trackingGrant.deleteMany({});
  await prisma.idempotencyReceipt.deleteMany({});
  await prisma.passengerRating.deleteMany({});
  await prisma.tripRating.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.driver.updateMany({ data: { onDuty: false, available: false, acceptsShared: false } });
});

describe('ride-share pure rules', () => {
  it('approximate address: no house number, no country', async () => {
    const { approxLabel } = await import('@/server/share-detail');
    expect(approxLabel('Lisandrou 2, Lemesos 3066, Cyprus')).toBe('Lisandrou, Lemesos 3066');
    expect(approxLabel('12 Makariou Ave, Nicosia')).toBe('Makariou Ave, Nicosia');
    expect(approxLabel('Larnaca Airport (LCA)')).toBe('Larnaca Airport (LCA)');
  });
  it('only between the airports and the towns Larnaca, Nicosia, Paphos, Ayia Napa, Limassol', () => {
    expect(isShareRoute(lca, marina)).toBe(true); // LCA → Nicosia
    expect(isShareRoute(lca, larnacaTown)).toBe(true); // LCA → Larnaca town
    expect(isShareRoute({ lat: 34.718, lng: 32.4857 }, { lat: 34.776, lng: 32.424 })).toBe(true); // PFO → Paphos
    expect(isShareRoute(larnacaTown, marina)).toBe(true); // Larnaca → Nicosia
    expect(isShareRoute(larnacaTown, larnacaTown2)).toBe(false); // in town
    expect(isShareRoute(lca, limassol)).toBe(true); // Limassol added 2026-11-19
  });
  it('30 % off, rounded to 10 cents', () => {
    expect(sharedCents(6000, 30)).toBe(4200);
    expect(sharedCents(4555, 30)).toBe(3190);
  });
  it('rejects a plan over a passenger’s own extra-time limit', () => {
    const pts = { start: lca, Hp: lca, Hd: marina, Gp: lcaNear, Gd: limCentre };
    expect(bestSharePlan(pts, approxLegMin, { hostOnBoard: false, hostMaxExtra: 20, guestMaxExtra: 20 })).not.toBeNull();
    // Guest going the other way: Limassol → Larnaca town from the airport is a big detour.
    const away = { start: lca, Hp: lca, Hd: marina, Gp: larnacaTown, Gd: { lat: 35.0, lng: 33.9 } };
    expect(bestSharePlan(away, approxLegMin, { hostOnBoard: false, hostMaxExtra: 5, guestMaxExtra: 5 })).toBeNull();
  });
});

describe('live ride-share', () => {
  it('proposes a co-rider to the passenger in the car and the driver; both yes → same car, 30 % off each', async () => {
    const d = await driver('Andreas');
    const host = await hostOnTrip(d, { pax: 2, bags: 2 });
    const guest = await booking(lcaNear, limCentre, { pax: 1, kids: 0, bags: 1 });

    expect(await tryLiveShare(guest.id)).toBe(true);
    const g = (await prisma.shareGroup.findFirst({ where: { guestBookingId: guest.id } }))!;
    expect(g.status).toBe('PROPOSED');
    expect(g.guestAnswer).toBe('YES'); // opted in when ordering — not asked again
    expect(g.hostCents).toBe(4200);

    // The passenger in the car sees the proposal with counts only (no name/phone/address).
    const tv = (await trackingView(host.id))!;
    expect(tv.shareProposal).toMatchObject({ groupId: g.id, newFareCents: 4200, fullFareCents: 6000, coRider: { adults: 1, children: 0, luggage: 1 } });
    expect(JSON.stringify(tv.shareProposal)).not.toContain(guest.passengerName);
    // The driver sees "was → now" and the extra minutes.
    const dv = await driverCurrentTrip(d.driverId);
    expect(dv.shareProposal).toMatchObject({ groupId: g.id, earningsWasCents: 6000, earningsNowCents: 8400 });

    // While waiting, the worker makes no driver offer for the guest.
    expect(await tryLiveShare(guest.id)).toBe(true);
    expect(await answerShare(g.id, { kind: 'PASSENGER', bookingId: host.id }, true)).toEqual({ ok: true, status: 'PROPOSED' });
    expect(await answerShare(g.id, { kind: 'DRIVER', driverId: d.driverId }, true)).toEqual({ ok: true, status: 'ACCEPTED' });

    const [h2, g2] = await Promise.all([fresh(host.id), fresh(guest.id)]);
    expect(g2.status).toBe('EN_ROUTE');
    expect([h2.fareCents, h2.priceType, h2.shareFullCents]).toEqual([4200, 'SHARED_FIXED', 6000]);
    expect([g2.fareCents, g2.priceType, g2.shareFullCents]).toEqual([4200, 'SHARED_FIXED', 6000]);
    expect(await prisma.dispatchJob.findUnique({ where: { bookingId: guest.id } })).toBeNull();
    const ga = (await prisma.assignment.findFirst({ where: { activeBookingId: guest.id } }))!;
    expect([ga.driverId, ga.activeDriverId]).toEqual([d.driverId, null]);

    const dv2 = await driverCurrentTrip(d.driverId);
    expect(dv2.trip?.bookingId).toBe(host.id);
    expect(dv2.coRider).toMatchObject({ bookingId: guest.id, status: 'EN_ROUTE' });
    expect(dv2.share?.totalCents).toBe(8400);
  });

  it('host leg finishes first → the co-rider leg takes over and the driver stays busy; both done → free', async () => {
    const d = await driver('Andreas');
    const host = await hostOnTrip(d);
    const guest = await booking(lcaNear, limCentre);
    await tryLiveShare(guest.id);
    const g = (await prisma.shareGroup.findFirst({ where: { guestBookingId: guest.id } }))!;
    await answerShare(g.id, { kind: 'DRIVER', driverId: d.driverId }, true);
    await answerShare(g.id, { kind: 'PASSENGER', bookingId: host.id }, true);

    // Airport pickups are exempt from the GPS radius, so arrival works for both.
    for (const id of [host.id, guest.id]) {
      let b = await fresh(id);
      const ar = await arriveAtPickup(id, d.driverId, b.revision); expect(ar.ok).toBe(true);
      b = await fresh(id);
      const st = await startTrip(id, d.driverId, b.revision, ''); expect(st.ok).toBe(true);
    }
    const c1 = await completeTrip(host.id, d.driverId, (await fresh(host.id)).revision);
    expect(c1.ok).toBe(true);
    const promoted = (await prisma.assignment.findFirst({ where: { activeBookingId: guest.id } }))!;
    expect(promoted.activeDriverId).toBe(d.driverId);
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: d.driverId } })).available).toBe(false);
    expect((await driverCurrentTrip(d.driverId)).trip?.bookingId).toBe(guest.id);

    const c2 = await completeTrip(guest.id, d.driverId, (await fresh(guest.id)).revision);
    expect(c2.ok).toBe(true);
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: d.driverId } })).available).toBe(true);
    expect((await prisma.shareGroup.findUniqueOrThrow({ where: { id: g.id } })).status).toBe('ENDED');
    expect((await prisma.fare.findUniqueOrThrow({ where: { bookingId: guest.id } })).finalCents).toBe(4200);
  });

  it('a "no" or silence leaves everything as it was; the same car is not proposed again', async () => {
    const d = await driver('Andreas');
    const host = await hostOnTrip(d);
    const guest = await booking(lcaNear, limCentre);
    await tryLiveShare(guest.id);
    const g = (await prisma.shareGroup.findFirst({ where: { guestBookingId: guest.id } }))!;
    expect(await answerShare(g.id, { kind: 'PASSENGER', bookingId: host.id }, false)).toEqual({ ok: true, status: 'DECLINED' });
    expect((await fresh(host.id)).fareCents).toBe(6000);
    expect((await fresh(guest.id)).status).toBe('SEARCHING');
    expect(await tryLiveShare(guest.id)).toBe(false);

    // Silence: a second guest's proposal expires.
    const guest2 = await booking(lcaNear, limCentre);
    expect(await tryLiveShare(guest2.id)).toBe(true);
    expect(await expireShares(new Date(Date.now() + (config.share.answerSec + 1) * 1000))).toBe(1);
    expect((await prisma.shareGroup.findFirst({ where: { guestBookingId: guest2.id } }))!.status).toBe('EXPIRED');
    expect(await tryLiveShare(guest2.id)).toBe(false);
  });

  it('a co-rider ride cannot get an intermediate stop', async () => {
    const { passengerSetStop } = await import('@/server/passenger-stop');
    const b = await booking(lca, marina);
    const r = await passengerSetStop(b.id, { lat: 34.9, lng: 33.5, label: 'Somewhere' });
    expect(r).toMatchObject({ ok: false, code: 'SHARE_NO_STOP' });
  });

  it('never: driver switched co-riders off, a passenger did not opt in, too many people/bags, or a city ride', async () => {
    const d = await driver('Andreas', { acceptsShared: false });
    await hostOnTrip(d);
    expect(await tryLiveShare((await booking(lcaNear, limCentre)).id)).toBe(false);

    await prisma.driver.update({ where: { id: d.driverId }, data: { acceptsShared: true } });
    expect(await tryLiveShare((await booking(lcaNear, limCentre, { share: false })).id)).toBe(false);
    expect(await tryLiveShare((await booking(lcaNear, limCentre, { pax: 4 })).id)).toBe(false); // 1 + 4 > 4 seats
    expect(await tryLiveShare((await booking(lcaNear, limCentre, { bags: 4 })).id)).toBe(false); // 1 + 4 > boot
    const city = await booking(larnacaTown, larnacaTown2);
    expect(city.shareOptIn).toBe(false); // not stored outside airport/intercity
    expect(await tryLiveShare(city.id)).toBe(false);
  });

  it('a co-rider who cancels puts the other passenger back to the full price', async () => {
    const d = await driver('Andreas');
    const host = await hostOnTrip(d);
    const guest = await booking(lcaNear, limCentre);
    await tryLiveShare(guest.id);
    const g = (await prisma.shareGroup.findFirst({ where: { guestBookingId: guest.id } }))!;
    await answerShare(g.id, { kind: 'DRIVER', driverId: d.driverId }, true);
    await answerShare(g.id, { kind: 'PASSENGER', bookingId: host.id }, true);
    const c = await changeStatus({ bookingId: guest.id, to: 'CANCELED', expectedRevision: (await fresh(guest.id)).revision, actor: 'PASSENGER' });
    expect(c.ok).toBe(true);
    const h = await fresh(host.id);
    expect([h.fareCents, h.priceType, h.shareFullCents]).toEqual([6000, 'REGULATED_FIXED', null]);
    expect((await prisma.shareGroup.findUniqueOrThrow({ where: { id: g.id } })).status).toBe('ENDED');
    // The driver still has the host, and is still busy.
    expect((await prisma.assignment.findFirst({ where: { activeBookingId: host.id } }))!.activeDriverId).toBe(d.driverId);
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: d.driverId } })).available).toBe(false);
  });
});

describe('pre-booked ride-share', () => {
  async function scheduled(from: typeof lca, to: typeof lca, minutesAhead: number, o: Parameters<typeof booking>[2] & { wait?: number; early?: number } = {}) {
    const b = await booking(from, to, o);
    await prisma.dispatchJob.deleteMany({ where: { bookingId: b.id } });
    return prisma.booking.update({ where: { id: b.id }, data: { status: 'REQUESTED', scheduledAt: new Date(Date.now() + minutesAhead * MIN), shareWaitMin: o.wait ?? 15, shareEarlyMin: o.early ?? 0 } });
  }

  // «Быть на месте с … до …» (2026-11-22): pickup = latest departure; a co-rider may only move it
  // earlier by the window's width, and both must ARRIVE inside their windows.
  async function arriving(from: typeof lca, to: typeof lca, byMinAhead: number, widthMin: number) {
    const drive = Math.ceil(approxLegMin(from, to)) + 10;
    const b = await scheduled(from, to, byMinAhead - drive, { wait: 0, early: widthMin });
    return prisma.booking.update({ where: { id: b.id }, data: { arriveBy: new Date(Date.now() + byMinAhead * MIN), arriveFrom: new Date(Date.now() + (byMinAhead - widthMin) * MIN) } });
  }

  it('arrival windows that overlap → paired, and both arrive inside their windows', async () => {
    const a = await arriving(lca, marina, 300, 60); // be there 4:00–5:00 from now
    const b = await arriving(lcaNear, limCentre, 330, 60); // 4:30–5:30
    expect(await matchPrebookings()).toBe(1);
    const g = (await prisma.shareGroup.findFirst({ where: { OR: [{ hostBookingId: a.id }, { hostBookingId: b.id }] } }))!;
    const plan = { arrive: g.arrivals as { host: number; guest: number } };
    const host = g.hostBookingId === a.id ? a : b, guest = host === a ? b : a;
    const hostArr = g.startAt!.getTime() + plan.arrive.host * MIN, guestArr = g.startAt!.getTime() + plan.arrive.guest * MIN;
    expect(hostArr).toBeLessThanOrEqual(host.arriveBy!.getTime());
    expect(guestArr).toBeLessThanOrEqual(guest.arriveBy!.getTime());
    expect(hostArr).toBeGreaterThanOrEqual(host.arriveFrom!.getTime() - 5 * MIN);
    expect(guestArr).toBeGreaterThanOrEqual(guest.arriveFrom!.getTime() - 5 * MIN);
  });

  it('arrival windows that do not overlap → not paired', async () => {
    await arriving(lca, marina, 300, 30); // 4:30–5:00
    await arriving(lcaNear, limCentre, 380, 30); // 5:50–6:20
    expect(await matchPrebookings()).toBe(0);
  });

  it('booking with an arrival window: stored; earlier-only flexibility = window width; bad windows refused', async () => {
    const day = (m: number) => { const d = new Date(Date.now() + m * MIN); return d.toLocaleString('sv-SE', { timeZone: 'Asia/Nicosia' }).slice(0, 16).replace(' ', 'T'); };
    const base = { pickup: lca, dropoff: marina, when: 'SCHEDULE', vClass: 'COMFORT', passengerCount: 1, passengerName: 'P', phone: '+35799123456', shareOptIn: true, shareMaxExtraMin: 15 };
    const ok = await createBooking(createBookingSchema.parse({ ...base, scheduledAt: day(200), arriveFrom: day(220), arriveBy: day(280), shareWaitMin: 30, shareEarlyMin: 5 }), `arr-${Date.now()}`);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const b = await prisma.booking.findUniqueOrThrow({ where: { reference: ok.body.reference } });
    expect(b.arriveBy).not.toBeNull();
    expect(b.shareWaitMin).toBe(0);
    expect(b.shareEarlyMin).toBe(60);
    const narrow = await createBooking(createBookingSchema.parse({ ...base, scheduledAt: day(200), arriveFrom: day(270), arriveBy: day(280) }), `arr2-${Date.now()}`);
    expect(narrow.ok).toBe(false);
    const late = await createBooking(createBookingSchema.parse({ ...base, scheduledAt: day(278), arriveFrom: day(220), arriveBy: day(280) }), `arr3-${Date.now()}`);
    expect(late.ok).toBe(false);
  });

  it('pairs two pre-bookings, both passengers agree, one order for a co-rider driver, guest joins on conversion', async () => {
    const a = await scheduled(lca, marina, 180, { pax: 2, bags: 2 });
    const b = await scheduled(lcaNear, limCentre, 195, { pax: 1, kids: 0, bags: 1, fare: 5000 });
    expect(await matchPrebookings()).toBe(1);
    const g = (await prisma.shareGroup.findFirst({ where: { hostBookingId: a.id } }))!;
    expect([g.mode, g.guestBookingId]).toEqual(['PREBOOK', b.id]);
    // The car leaves when the co-rider can be picked up; the first passenger waits (they allowed 15 min).
    expect(g.startAt!.getTime()).toBeGreaterThan(a.scheduledAt!.getTime());
    // Both answer within 30 min, and at the latest an hour before the car leaves.
    expect(g.expiresAt.getTime()).toBeLessThanOrEqual(g.startAt!.getTime() - config.share.prebookAnswerBeforePickupMin * MIN);
    const wa = (await trackingView(a.id))!.shareProposal!;
    expect(wa.waitMin).toBeGreaterThan(0);
    expect(wa.waitMin).toBeLessThanOrEqual(15);
    expect(wa.pickupAt).toBe(g.startAt!.toISOString());
    expect(wa.arriveAt).not.toBeNull();
    // Each passenger is asked; no names or addresses in the proposal.
    const va = (await trackingView(a.id))!;
    expect(va.shareProposal).toMatchObject({ mode: 'PREBOOK', coRider: { adults: 1, children: 0, luggage: 1 } });
    expect(JSON.stringify(va.shareProposal)).not.toContain(b.pickupLabel);
    expect(await answerShare(g.id, { kind: 'PASSENGER', bookingId: a.id }, true)).toEqual({ ok: true, status: 'PROPOSED' });
    expect(await answerShare(g.id, { kind: 'PASSENGER', bookingId: b.id }, true)).toEqual({ ok: true, status: 'MATCHED' });
    expect((await fresh(a.id)).fareCents).toBe(4200);
    expect((await fresh(b.id)).fareCents).toBe(3500);
    // The first pickup moves to the shared departure; the booked time is kept for a break-up.
    const a2 = await fresh(a.id);
    expect([a2.scheduledAt!.getTime(), a2.shareOrigScheduledAt!.getTime()]).toEqual([g.startAt!.getTime(), a.scheduledAt!.getTime()]);

    // Board: one order, only for drivers who take co-riders.
    const no = await driver('Maria', { acceptsShared: false, onDuty: false });
    expect((await scheduledBoard(no.driverId)).available.map((i) => i.bookingId)).toEqual([]);
    const yes = await driver('Andreas', { acceptsShared: true, onDuty: false });
    const board = await scheduledBoard(yes.driverId);
    expect(board.available.map((i) => i.bookingId)).toEqual([a.id]);
    expect(board.available[0].share).toMatchObject({ passengers: 3, luggage: 3, totalFareCents: 7700 });
    // Detail: the whole trip in stop order, approximate addresses, per-stop info and totals.
    const { scheduledRideDetail } = await import('@/server/dispatch/preassign');
    const det = (await scheduledRideDetail(a.id, yes.driverId))!;
    expect(det.pair!.stops.map((s) => `${s.kind}:${s.passenger}`)).toEqual(['pickup:1', 'pickup:2', ...det.pair!.stops.slice(2).map((s) => `${s.kind}:${s.passenger}`)]);
    expect(det.pair!.stops).toHaveLength(4);
    expect(det.pair!.stops[1]).toMatchObject({ adults: 1, children: 0, luggage: 1, fareCents: 3500 });
    expect(det.pair!.stops[3].toNext).toBeNull();
    expect(det.pair!.stops[0].toNext!.min).toBeGreaterThanOrEqual(0);
    expect(det.pair!.totals).toMatchObject({ passengers: 3, luggage: 3, fareCents: 7700 });
    expect(det.pair!.totals.km).toBeGreaterThan(0);
    expect((await claimScheduled(yes.driverId, b.id)).ok).toBe(false); // the co-rider is never claimed alone
    expect(await claimScheduled(yes.driverId, a.id)).toEqual({ ok: true, status: 'COMMITTED' });

    // Conversion near pickup: host assigned, co-rider in the same car.
    await prisma.booking.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { scheduledAt: new Date(Date.now() + 20 * MIN) } });
    await prisma.preAssignment.updateMany({ where: { bookingId: a.id }, data: { pickupAt: new Date(Date.now() + 20 * MIN) } });
    await prisma.driver.update({ where: { id: yes.driverId }, data: { onDuty: true, available: true } });
    const r = await runPreassignments();
    expect(r.converted).toBe(1);
    expect((await fresh(a.id)).status).toBe('ASSIGNED');
    expect((await fresh(b.id)).status).toBe('ASSIGNED');
    expect((await prisma.assignment.findFirst({ where: { activeBookingId: b.id } }))!.driverId).toBe(yes.driverId);
    expect((await prisma.shareGroup.findUniqueOrThrow({ where: { id: g.id } })).status).toBe('ACCEPTED');
  });

  it('no-show on a pre-booked pair: a part of the no-show’s price, the other pays in full', async () => {
    const a = await scheduled(lca, marina, 180);
    const b = await scheduled(lcaNear, limCentre, 190);
    await matchPrebookings();
    const g = (await prisma.shareGroup.findFirst({ where: { hostBookingId: a.id } }))!;
    await answerShare(g.id, { kind: 'PASSENGER', bookingId: a.id }, true);
    await answerShare(g.id, { kind: 'PASSENGER', bookingId: b.id }, true);
    const d = await driver('Andreas');
    await claimScheduled(d.driverId, a.id);
    await prisma.booking.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { scheduledAt: new Date(Date.now() + 20 * MIN) } });
    await prisma.preAssignment.updateMany({ where: { bookingId: a.id }, data: { pickupAt: new Date(Date.now() + 20 * MIN) } });
    await runPreassignments();

    // Driver reaches the co-rider (airport: no GPS radius) and the free waiting time passes.
    let gb = await fresh(b.id);
    const e = await changeStatus({ bookingId: b.id, to: 'EN_ROUTE', expectedRevision: gb.revision, actor: 'DRIVER', driverId: d.driverId });
    expect(e.ok).toBe(true);
    gb = await fresh(b.id);
    expect((await arriveAtPickup(b.id, d.driverId, gb.revision)).ok).toBe(true);
    gb = await fresh(b.id);
    expect((await driverShareNoShow(b.id, d.driverId, gb.revision)).ok).toBe(false); // too early
    await prisma.waitingSession.update({ where: { bookingId: b.id }, data: { arrivedAt: new Date(Date.now() - 10 * MIN) } });
    const ns = await driverShareNoShow(b.id, d.driverId, gb.revision);
    expect(ns.ok && ns.extra).toEqual({ noShowFeeCents: 1000 }); // flat €10
    expect((await fresh(b.id)).status).toBe('CANCELED');
    const ha = await fresh(a.id);
    expect([ha.fareCents, ha.priceType]).toEqual([6000, 'REGULATED_FIXED']);
    const grp = await prisma.shareGroup.findUniqueOrThrow({ where: { id: g.id } });
    expect([grp.status, grp.noShowBookingId, grp.noShowFeeCents]).toEqual(['ENDED', b.id, 1000]);
    expect((await prisma.assignment.findFirst({ where: { activeBookingId: a.id } }))!.activeDriverId).toBe(d.driverId);
  });

  it('rides further apart than the passengers can wait are not paired', async () => {
    await scheduled(lca, marina, 180, { wait: 0 });
    await scheduled(lcaNear, limCentre, 200, { wait: 0 });
    expect(await matchPrebookings()).toBe(0);
  });

  it('2026-11-21: the later passenger agreed to leave earlier → the same two rides are paired, at the earlier time', async () => {
    const a = await scheduled(lca, marina, 180, { wait: 0 });
    const b = await scheduled(lcaNear, limCentre, 200, { wait: 0, early: 30 });
    expect(await matchPrebookings()).toBe(1);
    const g = (await prisma.shareGroup.findFirst({ where: { hostBookingId: a.id } }))!;
    expect(g.guestBookingId).toBe(b.id);
    expect(Math.abs(g.startAt!.getTime() - a.scheduledAt!.getTime())).toBeLessThan(MIN); // host on time
  });

  async function matchedPair() {
    const a = await scheduled(lca, marina, 180);
    const b = await scheduled(lcaNear, limCentre, 190);
    await matchPrebookings();
    const g = (await prisma.shareGroup.findFirst({ where: { hostBookingId: a.id } }))!;
    await answerShare(g.id, { kind: 'PASSENGER', bookingId: a.id }, true);
    await answerShare(g.id, { kind: 'PASSENGER', bookingId: b.id }, true);
    // Search time (30 min before): nobody pre-assigned the pair.
    await prisma.booking.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { scheduledAt: new Date(Date.now() + 25 * MIN) } });
    return { a, b, g };
  }

  it('an unclaimed pair is offered 30 min before to online drivers who take co-riders; the co-rider joins on accept', async () => {
    const { a, b, g } = await matchedPair();
    const no = await driver('Maria', { acceptsShared: false }); // nearer, but does not take co-riders
    const yes = await driver('Andreas', { acceptsShared: true, at: { lat: 34.88, lng: 33.63 } });
    const { promoteScheduled, runOnce } = await import('@/server/dispatch/worker');
    await promoteScheduled(new Date());
    expect((await fresh(a.id)).status).toBe('SEARCHING');
    expect((await fresh(b.id)).status).toBe('REQUESTED'); // rides with the host's driver
    await runOnce();
    const offer = (await prisma.driverOffer.findFirst({ where: { bookingId: a.id, status: 'OFFERED' } }))!;
    expect(offer.driverId).toBe(yes.driverId);
    expect(offer.driverId).not.toBe(no.driverId);
    const { acceptOffer } = await import('@/server/dispatch/offers');
    expect((await acceptOffer(offer.id, yes.driverId)).ok).toBe(true);
    expect((await fresh(b.id)).status).toBe('ASSIGNED');
    expect((await prisma.assignment.findFirst({ where: { activeBookingId: b.id } }))!.driverId).toBe(yes.driverId);
    expect((await prisma.shareGroup.findUniqueOrThrow({ where: { id: g.id } })).status).toBe('ACCEPTED');
  });

  it('only the pair goes online 30 min before; an ordinary pre-booking keeps the normal 15 min', async () => {
    const { a, b } = await matchedPair(); // pair at +25 min
    const plain = await scheduled(larnacaTown, marina, 25, { share: false });
    const { promoteScheduled } = await import('@/server/dispatch/worker');
    await promoteScheduled(new Date());
    expect((await fresh(a.id)).status).toBe('SEARCHING');
    expect((await fresh(b.id)).status).toBe('REQUESTED'); // rides with the host's driver
    expect((await fresh(plain.id)).status).toBe('REQUESTED'); // 25 min > 15 min lead
  });

  it('a pair’s pre-assigned driver who is busy is waited for until 20 min before, then online search', async () => {
    const a = await scheduled(lca, marina, 180);
    const b = await scheduled(lcaNear, limCentre, 190);
    await matchPrebookings();
    const g = (await prisma.shareGroup.findFirst({ where: { hostBookingId: a.id } }))!;
    await answerShare(g.id, { kind: 'PASSENGER', bookingId: a.id }, true);
    await answerShare(g.id, { kind: 'PASSENGER', bookingId: b.id }, true);
    const d = await driver('Andreas', { onDuty: false });
    expect((await claimScheduled(d.driverId, a.id)).ok).toBe(true);
    const at = async (min: number) => {
      await prisma.booking.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { scheduledAt: new Date(Date.now() + min * MIN) } });
      await prisma.preAssignment.updateMany({ where: { bookingId: a.id }, data: { pickupAt: new Date(Date.now() + min * MIN) } });
      return runPreassignments();
    };
    expect((await at(22)).lapsed).toBe(0); // still waiting for the offline driver
    expect((await at(19)).lapsed).toBe(1);
    const { promoteScheduled } = await import('@/server/dispatch/worker');
    await promoteScheduled(new Date());
    expect((await fresh(a.id)).status).toBe('SEARCHING');
    expect((await prisma.shareGroup.findUniqueOrThrow({ where: { id: g.id } })).status).toBe('MATCHED'); // still a pair, searched online
  });

  it('with no co-rider driver online the pair splits into two normal rides at the full price', async () => {
    const { a, b, g } = await matchedPair();
    await driver('Maria', { acceptsShared: false });
    const { promoteScheduled, runOnce } = await import('@/server/dispatch/worker');
    await promoteScheduled(new Date());
    await runOnce(); // no driver for the pair → split
    expect((await prisma.shareGroup.findUniqueOrThrow({ where: { id: g.id } })).status).toBe('ENDED');
    await promoteScheduled(new Date());
    const [ha, hb] = await Promise.all([fresh(a.id), fresh(b.id)]);
    // The host keeps searching; the co-rider is now an ordinary pre-booking (online at the normal 15 min).
    expect([ha.status, ha.fareCents, hb.status, hb.fareCents]).toEqual(['SEARCHING', 6000, 'REQUESTED', 6000]);
  });
});
