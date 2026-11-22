import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { getSettings } from '@/lib/settings';
import { haversineMeters, type LatLng } from '@/lib/geo';
import { arrivalFits, isShareRoute, sharedCents, approxLegMin, bestSharePlan, bestPrebookPlan, shareFits, prebookTiming, STOP_OF, type SharePlan, type LegFn } from '@/lib/share';
import { googleConfigured, googleRoute } from '@/server/google';
import { enqueueDriver, enqueuePassenger, enqueuePassengerDriverNews } from '@/server/push';
import { recordEvent, driverPseudo } from '@/server/events';
import { stopSearchTx } from '@/server/dispatch/search';

// Ride-share «Попутчик» (Task 022). See Tasks/022-RIDESHARE-POPUTCHIK.md and the ShareGroup model.
//
// Rules agreed with the operator (2026-11-19):
//  - airport / intercity trips only; at most two bookings in one car;
//  - LIVE: a new opted-in booking that fits a running opted-in trip is proposed to the passenger
//    already in that car and to the driver (the newcomer opted in when ordering). Both must say
//    yes within config.share.answerSec; silence = no. The car's seats and boot must fit everyone,
//    and neither passenger's extra time may exceed the limit they chose when ordering;
//  - PREBOOK: two opted-in pre-bookings that fit are proposed to both passengers (no names, phones
//    or addresses — only people, children and suitcases); once both agree, the pair is one order on
//    the drivers' pre-booking board for drivers who take co-riders;
//  - each passenger gets config.share.discountPct off only when the co-rider actually joins; the
//    driver earns the sum of both shared prices. If the pair breaks up (cancel / no-show) the other
//    passenger goes back to the full price; a pre-booked no-show owes noShowFeePct of their price.

type Tx = Prisma.TransactionClient;
const S = () => config.share;
const MIN = 60_000;
const LIVE_HOST_STATUSES = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] as const;

type ShareBooking = {
  id: string; status: string; vClass: 'COMFORT' | 'XL'; shareOptIn: boolean; shareMaxExtraMin: number | null;
  fareCents: number | null; priceType: string | null; passengerCount: number; childCount: number; luggageCount: number;
  pickupLat: number; pickupLng: number; dropoffLat: number; dropoffLng: number; stopLat: number | null;
  scheduledAt: Date | null; passengerId: string | null; shareWaitMin?: number | null; shareEarlyMin?: number | null;
};

const pt = (lat: number, lng: number): LatLng => ({ lat, lng });
const maxExtra = (b: { shareMaxExtraMin: number | null }) => b.shareMaxExtraMin ?? S().defaultMaxExtraMin;

/** Can this booking take part in ride-share at all? (opted in, priced, airport/intercity, no stop) */
export function shareCapable(b: ShareBooking): boolean {
  return b.shareOptIn && b.fareCents != null && b.stopLat == null
    && isShareRoute(pt(b.pickupLat, b.pickupLng), pt(b.dropoffLat, b.dropoffLng));
}
const waitMin = (b: { shareWaitMin?: number | null }) => b.shareWaitMin ?? S().defaultWaitMin;
const earlyMin = (b: { shareEarlyMin?: number | null }) => b.shareEarlyMin ?? 0; // how much earlier they can leave

// ---- Road time (Google Routes, traffic-aware) ----
// Every plan is first run with the straight-line estimate to learn which legs it needs; those legs
// are then road-routed (in parallel, short timeout, cached 10 min) and the plan is run again. So the
// minutes shown to the passengers and the driver — including who is dropped off first and when each
// arrives — are real road times with traffic whenever Google is configured.
const LEG_TTL_MS = 10 * MIN;
const legCache = new Map<string, { min: number; at: number }>();
const ck = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

export async function planWithRoads<T>(run: (leg: LegFn) => T, departure: Date | null): Promise<{ result: T; routed: boolean }> {
  if (!googleConfigured()) return { result: run(approxLegMin), routed: false };
  const pairs = new Map<string, [LatLng, LatLng]>();
  run((a, b) => { if (ck(a) !== ck(b)) pairs.set(`${ck(a)}>${ck(b)}`, [a, b]); return approxLegMin(a, b); });
  const now = Date.now();
  const when = departure && departure.getTime() > now ? departure : new Date(now);
  const slot = Math.round(when.getTime() / (15 * MIN)); // traffic differs by time of day
  const key = (k: string) => `${slot}|${k}`;
  await Promise.all([...pairs].map(async ([k, [a, b]]) => {
    const c = legCache.get(key(k));
    if (c && now - c.at < LEG_TTL_MS) return;
    try {
      const r = await googleRoute(a, b, when.toISOString(), { timeoutMs: 2500 });
      if (r) legCache.set(key(k), { min: r.etaMinutes, at: now });
    } catch { /* falls back to the estimate for this leg */ }
  }));
  if (legCache.size > 5000) for (const [k, v] of legCache) if (now - v.at > LEG_TTL_MS) legCache.delete(k);
  let routed = true;
  const leg: LegFn = (a, b) => {
    if (ck(a) === ck(b)) return 0;
    const c = legCache.get(key(`${ck(a)}>${ck(b)}`));
    if (c) return c.min;
    routed = false;
    return approxLegMin(a, b);
  };
  const result = run(leg);
  return { result, routed };
}

// Live matching runs every worker tick while a ride searches; road-route a newcomer at most every 15 s.
const lastLiveTry = new Map<string, number>();

async function lockBookings(tx: Tx, ids: string[]) {
  // One lock order everywhere (sorted ids) so two groups never deadlock each other.
  for (const id of [...ids].sort()) await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${id} FOR UPDATE`;
}

async function activeGroupOf(db: Tx | typeof prisma, bookingId: string) {
  return db.shareGroup.findFirst({ where: { OR: [{ activeHostBookingId: bookingId }, { activeGuestBookingId: bookingId }] } });
}

// ---------------------------------------------------------------------------------------------
// LIVE: propose a running trip to a new searching booking
// ---------------------------------------------------------------------------------------------

/**
 * Worker hook, called for a SEARCHING booking before normal driver offers. Returns true while a
 * share proposal for this booking is pending (the worker then waits instead of offering drivers).
 */
export async function tryLiveShare(guestId: string, now: Date = new Date()): Promise<boolean> {
  const guest = await prisma.booking.findUnique({ where: { id: guestId } });
  if (!guest || guest.status !== 'SEARCHING' || guest.scheduledAt || !shareCapable(guest)) return false;
  const pending = await prisma.shareGroup.findFirst({ where: { guestBookingId: guestId, status: 'PROPOSED' } });
  if (pending) return pending.expiresAt > now;
  const tried = await prisma.shareGroup.findMany({ where: { guestBookingId: guestId }, select: { hostBookingId: true } });

  const hosts = await prisma.booking.findMany({
    where: {
      id: { notIn: tried.map((t) => t.hostBookingId) },
      status: { in: [...LIVE_HOST_STATUSES] }, shareOptIn: true, vClass: guest.vClass, fareCents: { not: null }, stopLat: null,
      shareAsHost: { none: { activeHostBookingId: { not: null } } }, shareAsGuest: { none: { activeGuestBookingId: { not: null } } },
      assignments: { some: { activeDriverId: { not: null }, driver: { acceptsShared: true, onDuty: true } } },
    },
    include: { assignments: { where: { activeDriverId: { not: null } }, include: { vehicle: true, driver: { include: { location: true } } } } },
    take: 50,
  });

  const last = lastLiveTry.get(guestId) ?? 0;
  if (now.getTime() - last < 15_000) return false;
  lastLiveTry.set(guestId, now.getTime());
  if (lastLiveTry.size > 2000) for (const [k, v] of lastLiveTry) if (now.getTime() - v > 10 * MIN) lastLiveTry.delete(k);

  const gp = pt(guest.pickupLat, guest.pickupLng);
  // 1) Straight-line prefilter with some slack, 2) road time for the best three.
  const SLACK = 10;
  const pre: { host: (typeof hosts)[number]; plan: SharePlan; pts: Parameters<typeof bestSharePlan>[0] }[] = [];
  for (const h of hosts) {
    if (!shareCapable(h)) continue;
    const a = h.assignments[0];
    if (!a || !shareFits(h, guest, a.vehicle.seats, S().luggage[guest.vClass])) continue;
    const loc = a.driver.location;
    const start = loc ? pt(loc.lat, loc.lng) : pt(h.pickupLat, h.pickupLng);
    if (haversineMeters(start, gp) > 40_000) continue; // far away: not "on the way"
    const pts = { start, Hp: pt(h.pickupLat, h.pickupLng), Hd: pt(h.dropoffLat, h.dropoffLng), Gp: gp, Gd: pt(guest.dropoffLat, guest.dropoffLng) };
    const plan = bestSharePlan(pts, approxLegMin, { hostOnBoard: h.status === 'IN_PROGRESS', hostMaxExtra: maxExtra(h) + SLACK, guestMaxExtra: maxExtra(guest) + SLACK });
    if (plan && !hostArrivesInTime(h, plan, now, SLACK)) continue;
    if (plan) pre.push({ host: h, plan, pts });
  }
  pre.sort((a, b) => a.plan.extraHost + a.plan.extraGuest - (b.plan.extraHost + b.plan.extraGuest));
  let best: { host: (typeof hosts)[number]; plan: SharePlan; routed: boolean } | null = null;
  for (const c of pre.slice(0, 3)) {
    const { result: plan, routed } = await planWithRoads(
      (leg) => bestSharePlan(c.pts, leg, { hostOnBoard: c.host.status === 'IN_PROGRESS', hostMaxExtra: maxExtra(c.host), guestMaxExtra: maxExtra(guest) }), null);
    if (plan && !hostArrivesInTime(c.host, plan, now)) continue; // «быть на месте до …» is a hard deadline
    if (plan && (!best || plan.extraHost + plan.extraGuest < best.plan.extraHost + best.plan.extraGuest)) best = { host: c.host, plan, routed };
  }
  if (!best) return false;
  return proposeLive(best.host.id, guestId, best.host.assignments[0].driverId, best.plan, best.routed, now);
}

// «Быть на месте до …» (2026-11-22): a co-rider picked up on the way must never make a host with an
// arrival window late. Conservative: the trip cannot start before the booked pickup time.
function hostArrivesInTime(h: { arriveBy: Date | null; scheduledAt: Date | null; status: string }, plan: SharePlan, now: Date, slackMin = 0): boolean {
  if (!h.arriveBy) return true;
  const start = h.status === 'IN_PROGRESS' ? now.getTime() : Math.max(now.getTime(), h.scheduledAt?.getTime() ?? 0);
  return start + plan.arrive.host * MIN <= h.arriveBy.getTime() + slackMin * MIN;
}

async function proposeLive(hostId: string, guestId: string, driverId: string, plan: SharePlan, routed: boolean, now: Date): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBookings(tx, [hostId, guestId]);
      const [h, g] = await Promise.all([tx.booking.findUnique({ where: { id: hostId } }), tx.booking.findUnique({ where: { id: guestId } })]);
      if (!h || !g || g.status !== 'SEARCHING' || !LIVE_HOST_STATUSES.includes(h.status as never)) return false;
      if ((await activeGroupOf(tx, hostId)) || (await activeGroupOf(tx, guestId))) return false;
      // The guest may not be offered to a driver at the same time.
      if (await tx.driverOffer.findFirst({ where: { activeBookingId: guestId } })) return false;
      const expiresAt = new Date(now.getTime() + S().answerSec * 1000);
      const group = await tx.shareGroup.create({ data: groupData('LIVE', h, g, plan, expiresAt, { driverId, guestAnswer: 'YES', routed }) });
      // Give the newcomer's normal search the answer time back, so a "no" still leaves time to search.
      const job = await tx.dispatchJob.findUnique({ where: { bookingId: guestId } });
      if (job) await tx.dispatchJob.update({ where: { id: job.id }, data: { deadlineAt: new Date(Math.max(now.getTime(), job.deadlineAt.getTime()) + S().answerSec * 1000) } });
      await tx.bookingEvent.create({ data: { bookingId: hostId, type: 'SHARE_PROPOSED', actorType: 'SYSTEM', reason: `co-rider ${g.reference}` } });
      await tx.bookingEvent.create({ data: { bookingId: guestId, type: 'SHARE_PROPOSED', actorType: 'SYSTEM', reason: `joins ${h.reference}` } });
      await recordEvent(tx, { eventType: 'share.proposed', aggregateType: 'share', aggregateId: group.id, aggregateVersion: 1, correlationId: guestId, payload: { mode: 'LIVE', driverPseudo: driverPseudo(driverId), extraMinHost: plan.extraHost, extraMinGuest: plan.extraGuest } });
      // No prices in notifications (operator, 2026-11-22): the passenger sees «−30 %», the driver «+N % earnings».
      await enqueuePassenger(tx, hostId, 'A co-rider wants to join', proposalBody(g, plan.extraHost, group.discountPct), { tag: `share-p-${group.id}`, url: '/track' });
      await enqueueDriver(tx, driverId, 'Co-rider on your route', driverProposalBody(plan.extraDriver, earningsUpPct(group.hostCents + group.guestCents, h.fareCents ?? 0)), { tag: `share-d-${group.id}` });
      return true;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false; // another group won the race
    throw e;
  }
}

// Proposal notifications (2026-11-19): shown on top of other apps / the lock screen and kept until
// answered. public/sw.js parses these exact English formats to show them in the app's language.
function proposalBody(other: { passengerCount: number; childCount: number; luggageCount: number }, extraMin: number, discountPct: number): string {
  return `${peopleText(other)} · +${extraMin} min · −${discountPct}% — tap to answer`;
}
function driverProposalBody(extraMin: number, upPct: number): string {
  return `+${extraMin} min · +${upPct}% earnings — tap to answer`;
}
/** How much more the driver earns with the co-rider, in whole percent (€84 instead of €60 → 40). */
export function earningsUpPct(nowCents: number, wasCents: number): number {
  return wasCents > 0 ? Math.max(0, Math.round((nowCents / wasCents - 1) * 100)) : 0;
}

function peopleText(b: { passengerCount: number; childCount: number; luggageCount: number }): string {
  const adults = b.passengerCount - b.childCount;
  return `${adults} adult${adults === 1 ? '' : 's'}${b.childCount ? `, ${b.childCount} child${b.childCount === 1 ? '' : 'ren'}` : ''}, ${b.luggageCount} suitcase${b.luggageCount === 1 ? '' : 's'}`;
}

function groupData(
  mode: 'LIVE' | 'PREBOOK', h: ShareBooking & { fareCents: number | null }, g: ShareBooking, plan: SharePlan, expiresAt: Date,
  extra: { driverId?: string; guestAnswer?: string; hostAnswer?: string; routed?: boolean; startAt?: Date },
): Prisma.ShareGroupUncheckedCreateInput {
  const pct = S().discountPct;
  return {
    mode, status: 'PROPOSED', hostBookingId: h.id, guestBookingId: g.id, driverId: extra.driverId ?? null, discountPct: pct,
    extraMinHost: plan.extraHost, extraMinGuest: plan.extraGuest, extraMinDriver: plan.extraDriver,
    hostFullCents: h.fareCents!, guestFullCents: g.fareCents!, hostCents: sharedCents(h.fareCents!, pct), guestCents: sharedCents(g.fareCents!, pct),
    plan: plan.order.map((k) => STOP_OF[k]), arrivals: plan.arrive, roadRouted: !!extra.routed, startAt: extra.startAt ?? null,
    guestAnswer: extra.guestAnswer ?? null, hostAnswer: extra.hostAnswer ?? null, expiresAt,
    activeHostBookingId: h.id, activeGuestBookingId: g.id,
  };
}

// ---------------------------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------------------------

export type ShareParty = { kind: 'PASSENGER'; bookingId: string } | { kind: 'DRIVER'; driverId: string };
export type ShareResult = { ok: true; status: string } | { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): ShareResult => ({ ok: false, status, code, message });

export async function answerShare(groupId: string, party: ShareParty, accept: boolean, now: Date = new Date()): Promise<ShareResult> {
  const pre = await prisma.shareGroup.findUnique({ where: { id: groupId } });
  if (!pre) return fail(404, 'NOT_FOUND', 'Proposal not found.');
  return prisma.$transaction(async (tx) => {
    await lockBookings(tx, [pre.hostBookingId, pre.guestBookingId]);
    const grp = await tx.shareGroup.findUnique({ where: { id: groupId } });
    if (!grp) return fail(404, 'NOT_FOUND', 'Proposal not found.');
    let field: 'hostAnswer' | 'guestAnswer' | 'driverAnswer';
    if (party.kind === 'DRIVER') {
      if (grp.mode !== 'LIVE' || grp.driverId !== party.driverId) return fail(403, 'FORBIDDEN', 'Not your proposal.');
      field = 'driverAnswer';
    } else if (party.bookingId === grp.hostBookingId) field = 'hostAnswer';
    else if (party.bookingId === grp.guestBookingId && grp.mode === 'PREBOOK') field = 'guestAnswer';
    else return fail(403, 'FORBIDDEN', 'Not your proposal.');
    if (grp.status !== 'PROPOSED') return fail(409, 'GONE', 'This proposal is no longer open.');
    if (grp.expiresAt <= now) {
      await closeGroupTx(tx, grp.id, 'EXPIRED', 'no answer in time');
      return fail(409, 'EXPIRED', 'Time to answer is over.');
    }
    if (grp[field]) return { ok: true, status: grp.status }; // already answered (double tap)
    const answer = accept ? 'YES' : 'NO';
    const g2 = await tx.shareGroup.update({ where: { id: grp.id }, data: { [field]: answer } });
    if (!accept) {
      await closeGroupTx(tx, grp.id, 'DECLINED', `${field.replace('Answer', '')} declined`);
      return { ok: true, status: 'DECLINED' };
    }
    const allYes = g2.mode === 'LIVE' ? g2.hostAnswer === 'YES' && g2.driverAnswer === 'YES' : g2.hostAnswer === 'YES' && g2.guestAnswer === 'YES';
    if (!allYes) return { ok: true, status: 'PROPOSED' };
    return g2.mode === 'LIVE' ? finalizeLiveTx(tx, g2.id) : finalizePrebookTx(tx, g2.id);
  });
}

async function closeGroupTx(tx: Tx, groupId: string, status: 'DECLINED' | 'EXPIRED' | 'CANCELED' | 'ENDED', reason: string) {
  const g = await tx.shareGroup.update({ where: { id: groupId }, data: { status, endReason: reason, endedAt: new Date(), activeHostBookingId: null, activeGuestBookingId: null } });
  await recordEvent(tx, { eventType: `share.${status.toLowerCase()}`, aggregateType: 'share', aggregateId: g.id, aggregateVersion: 2, correlationId: g.guestBookingId, payload: { mode: g.mode, reason } });
  return g;
}

/** Driver + vehicle of the host's car; the guest leg gets its own Assignment row (no active driver/vehicle slot). */
async function attachGuestTx(tx: Tx, guestId: string, hostAssignment: { driverId: string; vehicleId: string; driverPublicName: string; driverPhone: string; vehiclePlate: string; vehicleMake: string; vehicleModel: string; vehicleColor: string; vehicleClass: 'COMFORT' | 'XL' }, reason: string) {
  await tx.assignment.create({
    data: {
      bookingId: guestId, driverId: hostAssignment.driverId, vehicleId: hostAssignment.vehicleId,
      driverPublicName: hostAssignment.driverPublicName, driverPhone: hostAssignment.driverPhone,
      vehiclePlate: hostAssignment.vehiclePlate, vehicleMake: hostAssignment.vehicleMake, vehicleModel: hostAssignment.vehicleModel,
      vehicleColor: hostAssignment.vehicleColor, vehicleClass: hostAssignment.vehicleClass,
      actor: 'SYSTEM', reason, activeBookingId: guestId, // activeDriverId/activeVehicleId stay on the primary leg
    },
  });
}

async function applySharedPriceTx(tx: Tx, bookingId: string, cents: number) {
  const b = await tx.booking.findUnique({ where: { id: bookingId }, select: { fareCents: true, priceType: true, shareFullCents: true } });
  if (!b || b.fareCents == null) return;
  await tx.booking.update({
    where: { id: bookingId },
    data: { shareFullCents: b.shareFullCents ?? b.fareCents, shareFullPriceType: b.shareFullCents != null ? undefined : b.priceType, fareCents: cents, priceType: 'SHARED_FIXED', revision: { increment: 1 } },
  });
}

/** Undo the discount (the co-rider is gone): back to the price the passenger booked. */
async function restoreFullPriceTx(tx: Tx, bookingId: string) {
  const b = await tx.booking.findUnique({ where: { id: bookingId }, select: { status: true, shareFullCents: true, shareFullPriceType: true, shareOrigScheduledAt: true, shareOrigPickupLat: true, shareOrigPickupLng: true, shareOrigPickupLabel: true } });
  if (!b || ['COMPLETED', 'CANCELED'].includes(b.status)) return false;
  // Not picked up yet: the passenger's own pickup point comes back (a pair matched while the airport
  // meeting point was live, 2026-11-19 18:30–19:10, had it moved; the feature is off until airports are set up).
  if (b.shareOrigPickupLabel != null && b.shareOrigPickupLat != null && b.shareOrigPickupLng != null && ['REQUESTED', 'SEARCHING', 'ASSIGNED', 'EN_ROUTE'].includes(b.status)) {
    await tx.booking.update({ where: { id: bookingId }, data: { pickupLat: b.shareOrigPickupLat, pickupLng: b.shareOrigPickupLng, pickupLabel: b.shareOrigPickupLabel, shareOrigPickupLat: null, shareOrigPickupLng: null, shareOrigPickupLabel: null } });
  }
  // A pre-booking that has not started yet also gets its own pickup time back.
  if (b.shareOrigScheduledAt && b.status === 'REQUESTED') {
    await tx.booking.update({ where: { id: bookingId }, data: { scheduledAt: b.shareOrigScheduledAt, shareOrigScheduledAt: null } });
  }
  if (b.shareFullCents == null) return false;
  await tx.booking.update({ where: { id: bookingId }, data: { fareCents: b.shareFullCents, priceType: b.shareFullPriceType, shareFullCents: null, shareFullPriceType: null, revision: { increment: 1 } } });
  return true;
}

async function finalizeLiveTx(tx: Tx, groupId: string): Promise<ShareResult> {
  const g = (await tx.shareGroup.findUnique({ where: { id: groupId } }))!;
  const host = await tx.booking.findUnique({ where: { id: g.hostBookingId } });
  const guest = await tx.booking.findUnique({ where: { id: g.guestBookingId } });
  const hostAsg = await tx.assignment.findFirst({ where: { activeBookingId: g.hostBookingId, activeDriverId: g.driverId } });
  if (!host || !guest || !hostAsg || !LIVE_HOST_STATUSES.includes(host.status as never) || guest.status !== 'SEARCHING') {
    await closeGroupTx(tx, g.id, 'CANCELED', 'trip changed before everyone agreed');
    return fail(409, 'GONE', 'The trip changed — the co-rider was not added.');
  }
  await stopSearchTx(tx, guest.id);
  await attachGuestTx(tx, guest.id, hostAsg, 'ride-share: joined a running trip');
  await applySharedPriceTx(tx, host.id, g.hostCents);
  await applySharedPriceTx(tx, guest.id, g.guestCents);
  // Like a normal accept: ASSIGNED (audit) then EN_ROUTE in the same transaction.
  await tx.booking.update({ where: { id: guest.id }, data: { status: 'ASSIGNED', revision: { increment: 1 } } });
  await tx.bookingEvent.create({ data: { bookingId: guest.id, type: 'SHARE_ASSIGNED', actorType: 'SYSTEM', beforeStatus: 'SEARCHING', afterStatus: 'ASSIGNED' } });
  await tx.booking.update({ where: { id: guest.id }, data: { status: 'EN_ROUTE', revision: { increment: 1 } } });
  await tx.bookingEvent.create({ data: { bookingId: guest.id, type: 'STATUS_EN_ROUTE', actorType: 'SYSTEM', beforeStatus: 'ASSIGNED', afterStatus: 'EN_ROUTE', reason: 'ride-share' } });
  await tx.bookingEvent.create({ data: { bookingId: host.id, type: 'SHARE_JOINED', actorType: 'SYSTEM', reason: `co-rider ${guest.reference}` } });
  await tx.shareGroup.update({ where: { id: g.id }, data: { status: 'ACCEPTED', decidedAt: new Date() } });
  await recordEvent(tx, { eventType: 'share.accepted', aggregateType: 'share', aggregateId: g.id, aggregateVersion: 2, correlationId: guest.id, payload: { mode: 'LIVE', driverPseudo: driverPseudo(hostAsg.driverId) } });
  await enqueuePassenger(tx, guest.id, 'Driver assigned — shared ride', `You share the car with a co-rider: −${g.discountPct}%.`, { msg: { k: 'share.joinGuest', p: { pct: g.discountPct } } });
  await enqueuePassenger(tx, host.id, 'Co-rider joins', `Your ride is now −${g.discountPct}%.`, { msg: { k: 'share.joinHost', p: { pct: g.discountPct } } });
  return { ok: true, status: 'ACCEPTED' };
}

async function finalizePrebookTx(tx: Tx, groupId: string): Promise<ShareResult> {
  const g = (await tx.shareGroup.findUnique({ where: { id: groupId } }))!;
  const [h, gu] = await Promise.all([tx.booking.findUnique({ where: { id: g.hostBookingId } }), tx.booking.findUnique({ where: { id: g.guestBookingId } })]);
  const committed = await tx.preAssignment.findFirst({ where: { activeBookingId: { in: [g.hostBookingId, g.guestBookingId] } } });
  if (!h || !gu || h.status !== 'REQUESTED' || gu.status !== 'REQUESTED' || committed) {
    await closeGroupTx(tx, g.id, 'CANCELED', 'a ride changed before both agreed');
    return fail(409, 'GONE', 'One of the rides changed — the match was cancelled.');
  }
  await applySharedPriceTx(tx, h.id, g.hostCents);
  await applySharedPriceTx(tx, gu.id, g.guestCents);
  // The pair leaves together: the first pickup at startAt, the co-rider when the car gets to them.
  // Each passenger agreed to wait that long; the booked times come back if the pair breaks up.
  if (g.startAt) {
    const arr = (g.arrivals ?? {}) as { guestPickup?: number };
    const guestAt = new Date(g.startAt.getTime() + (arr.guestPickup ?? 0) * MIN);
    for (const [b, at] of [[h, g.startAt], [gu, guestAt]] as const) {
      if (b.scheduledAt && b.scheduledAt.getTime() !== at.getTime()) {
        await tx.booking.update({ where: { id: b.id }, data: { shareOrigScheduledAt: b.shareOrigScheduledAt ?? b.scheduledAt, scheduledAt: at } });
      }
    }
  }
  await tx.shareGroup.update({ where: { id: g.id }, data: { status: 'MATCHED', decidedAt: new Date() } });
  for (const id of [h.id, gu.id]) await tx.bookingEvent.create({ data: { bookingId: id, type: 'SHARE_MATCHED', actorType: 'SYSTEM', beforeStatus: 'REQUESTED', afterStatus: 'REQUESTED' } });
  await recordEvent(tx, { eventType: 'share.matched', aggregateType: 'share', aggregateId: g.id, aggregateVersion: 2, correlationId: h.id, payload: { mode: 'PREBOOK' } });
  await enqueuePassenger(tx, h.id, 'Shared ride confirmed', `Your ride is now −${g.discountPct}%.`, { msg: { k: 'share.confirmed', p: { pct: g.discountPct } } });
  await enqueuePassenger(tx, gu.id, 'Shared ride confirmed', `Your ride is now −${g.discountPct}%.`, { msg: { k: 'share.confirmed', p: { pct: g.discountPct } } });
  return { ok: true, status: 'MATCHED' };
}

/** Worker: proposals nobody answered in time count as "no". */
export async function expireShares(now: Date = new Date()): Promise<number> {
  const due = await prisma.shareGroup.findMany({ where: { status: 'PROPOSED', expiresAt: { lte: now } }, select: { id: true, hostBookingId: true, guestBookingId: true } });
  for (const d of due) {
    await prisma.$transaction(async (tx) => {
      await lockBookings(tx, [d.hostBookingId, d.guestBookingId]);
      const g = await tx.shareGroup.findUnique({ where: { id: d.id } });
      if (g?.status === 'PROPOSED') await closeGroupTx(tx, g.id, 'EXPIRED', 'no answer in time');
    });
  }
  return due.length;
}

// ---------------------------------------------------------------------------------------------
// PREBOOK: match two pre-bookings
// ---------------------------------------------------------------------------------------------

export async function matchPrebookings(now: Date = new Date()): Promise<number> {
  const settings = await getSettings();
  // Leave room for both answers (≤ prebookAnswerMin) to end ≥ prebookAnswerBeforePickupMin before pickup.
  const earliest = new Date(now.getTime() + (S().prebookAnswerBeforePickupMin + 5) * MIN);
  const rows = await prisma.booking.findMany({
    where: {
      status: 'REQUESTED', shareOptIn: true, fareCents: { not: null }, stopLat: null,
      scheduledAt: { gt: earliest, lt: new Date(now.getTime() + config.dispatch.preassign.horizonHours * 3600_000) },
      preAssignments: { none: { status: 'COMMITTED' } },
      shareAsHost: { none: { activeHostBookingId: { not: null } } }, shareAsGuest: { none: { activeGuestBookingId: { not: null } } },
    },
    orderBy: { scheduledAt: 'asc' },
    take: 60,
  });
  const cands = rows.filter(shareCapable);
  if (cands.length < 2) return 0;
  const pastPairs = await prisma.shareGroup.findMany({
    where: { mode: 'PREBOOK', OR: [{ hostBookingId: { in: cands.map((c) => c.id) } }, { guestBookingId: { in: cands.map((c) => c.id) } }] },
    select: { hostBookingId: true, guestBookingId: true },
  });
  const tried = new Set(pastPairs.flatMap((p) => [`${p.hostBookingId}|${p.guestBookingId}`, `${p.guestBookingId}|${p.hostBookingId}`]));
  const used = new Set<string>();
  let made = 0;
  for (let i = 0; i < cands.length; i++) {
    const h = cands[i];
    if (used.has(h.id)) continue;
    type Pick = { g: (typeof cands)[number]; plan: SharePlan; timing: NonNullable<ReturnType<typeof prebookTiming>>; routed: boolean };
    const pre: Omit<Pick, 'routed'>[] = [];
    for (let j = i + 1; j < cands.length; j++) {
      const g = cands[j];
      if (used.has(g.id) || g.vClass !== h.vClass || tried.has(`${h.id}|${g.id}`)) continue;
      if (h.passengerId && h.passengerId === g.passengerId) continue; // the same person's two rides
      // Sorted by time: once the gap is beyond what anyone could wait (plus driving to the
      // co-rider), later rides cannot fit either.
      if (g.scheduledAt!.getTime() - h.scheduledAt!.getTime() > (waitMin(h) + earlyMin(g) + 180) * MIN) break;
      const seats = settings.classes.find((c) => c.key === h.vClass)?.maxPassengers ?? 4;
      if (!shareFits(h, g, seats, S().luggage[h.vClass])) continue;
      const pts = { Hp: pt(h.pickupLat, h.pickupLng), Hd: pt(h.dropoffLat, h.dropoffLng), Gp: pt(g.pickupLat, g.pickupLng), Gd: pt(g.dropoffLat, g.dropoffLng) };
      const timing = prebookTiming(h.scheduledAt!, g.scheduledAt!, approxLegMin(pts.Hp, pts.Gp), waitMin(h) + 5, waitMin(g) + 5, earlyMin(h) + 5, earlyMin(g) + 5);
      const plan = timing && bestPrebookPlan(pts, approxLegMin, { hostMaxExtra: maxExtra(h) + 5, guestMaxExtra: maxExtra(g) + 5 });
      const arrOk = (t: NonNullable<typeof timing>, pl: SharePlan, slack: number) => arrivalFits(h, new Date(t.startAt.getTime() + pl.arrive.host * MIN), slack) && arrivalFits(g, new Date(t.startAt.getTime() + pl.arrive.guest * MIN), slack);
      if (timing && plan && arrOk(timing, plan, 10)) pre.push({ g, plan, timing });
    }
    pre.sort((a, b) => a.plan.extraHost + a.plan.extraGuest - (b.plan.extraHost + b.plan.extraGuest));
    let best: Pick | null = null;
    for (const c of pre.slice(0, 3)) {
      const pts = { Hp: pt(h.pickupLat, h.pickupLng), Hd: pt(h.dropoffLat, h.dropoffLng), Gp: pt(c.g.pickupLat, c.g.pickupLng), Gd: pt(c.g.dropoffLat, c.g.dropoffLng) };
      // Road time with the traffic expected at the ride's own time.
      const { result, routed } = await planWithRoads((leg) => {
        const timing = prebookTiming(h.scheduledAt!, c.g.scheduledAt!, leg(pts.Hp, pts.Gp), waitMin(h), waitMin(c.g), earlyMin(h), earlyMin(c.g));
        const plan = timing && bestPrebookPlan(pts, leg, { hostMaxExtra: maxExtra(h), guestMaxExtra: maxExtra(c.g) });
        // Everyone with an arrival window must arrive inside it (2026-11-22).
        if (!timing || !plan) return null;
        if (!arrivalFits(h, new Date(timing.startAt.getTime() + plan.arrive.host * MIN)) || !arrivalFits(c.g, new Date(timing.startAt.getTime() + plan.arrive.guest * MIN))) return null;
        return { timing, plan };
      }, h.scheduledAt);
      if (result && (!best || result.plan.extraHost + result.plan.extraGuest < best.plan.extraHost + best.plan.extraGuest)) best = { g: c.g, ...result, routed };
    }
    if (!best) continue;
    const ok = await proposePrebook(h.id, best.g.id, best.plan, best.timing.startAt, best.routed, now);
    if (ok) { used.add(h.id); used.add(best.g.id); made++; }
  }
  return made;
}

/**
 * `fromBoard` (share board, 2026-11-21): a passenger chose this co-rider himself — his own answer is
 * already «yes» and only the other passenger is notified. Returns the proposal id, or null.
 */
export async function proposePrebook(hostId: string, guestId: string, plan: SharePlan, startAt: Date, routed: boolean, now: Date, fromBoard?: { byBookingId: string }): Promise<string | null> {
  // Both answer within prebookAnswerMin, and at the latest prebookAnswerBeforePickupMin before the car leaves.
  const expiresAt = new Date(Math.min(now.getTime() + S().prebookAnswerMin * MIN, startAt.getTime() - S().prebookAnswerBeforePickupMin * MIN));
  if (expiresAt.getTime() - now.getTime() < 5 * MIN) return null;
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBookings(tx, [hostId, guestId]);
      const [h, g] = await Promise.all([tx.booking.findUnique({ where: { id: hostId } }), tx.booking.findUnique({ where: { id: guestId } })]);
      if (!h || !g || h.status !== 'REQUESTED' || g.status !== 'REQUESTED') return null;
      if ((await activeGroupOf(tx, hostId)) || (await activeGroupOf(tx, guestId))) return null;
      if (await tx.preAssignment.findFirst({ where: { activeBookingId: { in: [hostId, guestId] } } })) return null;
      // No question for pre-bookings (operator, 2026-11-22): both passengers already chose «Попутчик»
      // with their own arrival window, and the pair keeps both inside it — so the pair is confirmed
      // at once and each hears only «confirmed, −30 %». Live rides still ask (the passenger in the car).
      const group = await tx.shareGroup.create({ data: groupData('PREBOOK', h, g, plan, expiresAt, { routed, startAt, hostAnswer: 'YES', guestAnswer: 'YES' }) });
      await recordEvent(tx, { eventType: 'share.proposed', aggregateType: 'share', aggregateId: group.id, aggregateVersion: 1, correlationId: hostId, payload: { mode: 'PREBOOK', extraMinHost: plan.extraHost, extraMinGuest: plan.extraGuest, by: fromBoard ? 'board' : 'auto' } });
      const r = await finalizePrebookTx(tx, group.id);
      return r.ok ? group.id : null;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
    throw e;
  }
}

/** Pre-assignment conversion of a matched host: put the guest into the same car (same transaction). */
export async function attachMatchedGuestTx(tx: Tx, hostId: string): Promise<boolean> {
  const g = await tx.shareGroup.findFirst({ where: { activeHostBookingId: hostId, status: 'MATCHED' } });
  if (!g) return false;
  await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${g.guestBookingId} FOR UPDATE`;
  const guest = await tx.booking.findUnique({ where: { id: g.guestBookingId } });
  const hostAsg = await tx.assignment.findFirst({ where: { activeBookingId: hostId, activeDriverId: { not: null } } });
  if (!guest || guest.status !== 'REQUESTED' || !hostAsg) {
    await restoreFullPriceTx(tx, hostId);
    await closeGroupTx(tx, g.id, 'CANCELED', 'co-rider ride no longer waiting');
    return false;
  }
  await stopSearchTx(tx, guest.id);
  await attachGuestTx(tx, guest.id, hostAsg, 'ride-share: pre-booked pair');
  await tx.booking.update({ where: { id: guest.id }, data: { status: 'ASSIGNED', revision: { increment: 1 } } });
  await tx.bookingEvent.create({ data: { bookingId: guest.id, type: 'SHARE_ASSIGNED', actorType: 'SYSTEM', beforeStatus: 'REQUESTED', afterStatus: 'ASSIGNED' } });
  await tx.shareGroup.update({ where: { id: g.id }, data: { status: 'ACCEPTED', driverId: hostAsg.driverId } });
  await enqueuePassengerDriverNews(tx, guest.id, 'assigned', 'Driver assigned', `${hostAsg.driverPublicName.split(' ')[0]} is assigned to your shared ride — track them live.`, { k: 'share.assigned', p: { driver: hostAsg.driverPublicName.split(' ')[0] } });
  return true;
}

/** True when this pre-booking is the co-rider of a matched pair (it rides with the host's driver). */
export async function isMatchedGuest(db: Tx | typeof prisma, bookingId: string): Promise<boolean> {
  return !!(await db.shareGroup.findFirst({ where: { activeGuestBookingId: bookingId, status: 'MATCHED' }, select: { id: true } }));
}

// ---------------------------------------------------------------------------------------------
// Break-ups and leg hand-over
// ---------------------------------------------------------------------------------------------

/**
 * A booking in a group is cancelled, rematched or otherwise leaves the car before its trip ends.
 * The other passenger goes back to the full price (unless already finished). Call under the
 * booking lock, in the transaction that changes the booking.
 */
export async function leaveShareTx(tx: Tx, bookingId: string, reason: string, opts: { noShowFeeCents?: number } = {}): Promise<void> {
  const g = await activeGroupOf(tx, bookingId);
  if (!g) return;
  const otherId = g.hostBookingId === bookingId ? g.guestBookingId : g.hostBookingId;
  await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${otherId} FOR UPDATE`;
  if (g.status === 'PROPOSED') { await closeGroupTx(tx, g.id, 'CANCELED', reason); return; }
  // The leaver's own discount goes too (their booking is ending; a no-show is charged separately).
  await restoreFullPriceTx(tx, bookingId);
  const restored = await restoreFullPriceTx(tx, otherId);
  await tx.shareGroup.update({ where: { id: g.id }, data: opts.noShowFeeCents != null ? { noShowBookingId: bookingId, noShowFeeCents: opts.noShowFeeCents } : {} });
  await closeGroupTx(tx, g.id, 'ENDED', reason);
  if (restored) await enqueuePassenger(tx, otherId, 'Your co-rider is not coming', 'You ride alone at the normal price — no discount.', { msg: { k: 'share.notComing' } });
  // No push to the driver (operator, 2026-11-22): the co-rider simply disappears from the trip screen.
}

/**
 * After a leg's assignment ended: if the driver still carries the other leg, that leg becomes the
 * primary one (it takes the active driver/vehicle slot) and the driver stays busy; otherwise the
 * driver is free again. Replaces the plain `available: true` everywhere an assignment ends.
 */
export async function afterLegEndedTx(tx: Tx, ended: { driverId: string }): Promise<void> {
  const other = await tx.assignment.findFirst({ where: { driverId: ended.driverId, activeBookingId: { not: null } } });
  if (!other) { await tx.driver.update({ where: { id: ended.driverId }, data: { available: true } }); return; }
  if (!other.activeDriverId) {
    await tx.assignment.update({ where: { id: other.id }, data: { activeDriverId: ended.driverId, activeVehicleId: other.vehicleId } });
  }
  await tx.driver.update({ where: { id: ended.driverId }, data: { available: false } });
}

/** A leg finished normally: when both legs are done the group is closed. */
export async function legCompletedTx(tx: Tx, bookingId: string): Promise<void> {
  const g = await activeGroupOf(tx, bookingId);
  if (!g || g.status !== 'ACCEPTED') return;
  const otherId = g.hostBookingId === bookingId ? g.guestBookingId : g.hostBookingId;
  const other = await tx.booking.findUnique({ where: { id: otherId }, select: { status: true } });
  if (other && ['COMPLETED', 'CANCELED'].includes(other.status)) await closeGroupTx(tx, g.id, 'ENDED', 'both legs done');
}

/** The driver waited at a shared pre-booking's pickup and the passenger never came: a flat fee (€10), never more than their price. */
export function noShowFeeCents(sharedPriceCents: number): number {
  return Math.min(S().noShowFeeCents, sharedPriceCents);
}

/** Pre-booked pair that no driver claimed by search time: split back into two normal rides. */
export async function dissolveUnclaimedTx(tx: Tx, bookingId: string): Promise<boolean> {
  const g = await tx.shareGroup.findFirst({ where: { OR: [{ activeHostBookingId: bookingId }, { activeGuestBookingId: bookingId }], status: { in: ['MATCHED', 'PROPOSED'] } } });
  if (!g) return false;
  await lockBookings(tx, [g.hostBookingId, g.guestBookingId].filter((id) => id !== bookingId));
  await restoreFullPriceTx(tx, g.hostBookingId);
  await restoreFullPriceTx(tx, g.guestBookingId);
  await closeGroupTx(tx, g.id, g.status === 'PROPOSED' ? 'CANCELED' : 'ENDED', 'no driver for the shared pair');
  if (g.status === 'MATCHED') {
    for (const id of [g.hostBookingId, g.guestBookingId]) await enqueuePassenger(tx, id, 'Shared ride not possible', 'No driver took the shared ride, so you ride alone at the normal price.', { msg: { k: 'share.notPossible' } });
  }
  return true;
}

export const shareInternals = { closeGroupTx, restoreFullPriceTx, activeGroupOf, peopleText, proposalBody, driverProposalBody };
export const SHARE_MIN = MIN;
