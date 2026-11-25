import { Prisma } from '@prisma/client';
import { ensureAirportAreas } from '@/server/no-go';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { getSettings } from '@/lib/settings';
import { haversineMeters, type LatLng } from '@/lib/geo';
import { arrivalFits, isShareRoute, shareClassOk, SHARE_COMFORT_SEATS, sharedCents, approxLegMin, bestSharePlan, bestPrebookPlan, shareFits, prebookTiming, comparePairs, STOP_OF, type SharePlan, type LegFn } from '@/lib/share';
import { googleConfigured, googleRoute } from '@/server/google';
import { enqueueDriver, enqueuePassenger, enqueuePassengerDriverNews } from '@/server/push';
import { recordEvent, driverPseudo } from '@/server/events';
import { stopSearchTx } from '@/server/dispatch/search';

// Ride-share «Попутчик» (Task 022). See Tasks/022-RIDESHARE-POPUTCHIK.md and the ShareGroup model.
//
// Rules agreed with the operator (2026-11-19):
//  - airport / intercity trips only; at most two bookings in one car;
//  - LIVE (operator 2026-11-23, «Попутчик в дороге»): a new opted-in booking that fits a running opted-in
//    trip — inside the in-car passenger's own terms (≤ their extra minutes, «быть на месте» with a 10-min
//    buffer) — is offered to the DRIVER only, for config.share.answerSec (90 s); silence = no. The
//    passenger in the car is not asked: only after the driver takes it both passengers get ONE
//    notification (arrival, amount). If it would not fit their terms, it is not offered at all. The car's seats and boot must fit everyone,
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
  return b.shareOptIn && shareClassOk(b.vClass) && b.fareCents != null && b.stopLat == null
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
  await ensureAirportAreas(); // the airport = a territory marked «это аэропорт» (2026-11-25)
  const guest = await prisma.booking.findUnique({ where: { id: guestId } });
  if (!guest || guest.status !== 'SEARCHING' || guest.scheduledAt || !shareCapable(guest)) return false;
  // Offers out (operator 2026-11-23): settle any driver who said yes; wait while others may still answer.
  if (await decideLive(guestId, now)) return true;
  const open = await prisma.shareGroup.findMany({ where: { guestBookingId: guestId, mode: 'LIVE', status: 'PROPOSED' } });
  if (open.some((g) => g.driverAnswer === 'YES' || g.expiresAt > now)) return true;
  // Three passes 10 s apart (operator 2026-11-24: «три подхода по 10 секунд»): a car that comes along on the
  // way in those ~20 s still gets him; a driver who gets him keeps 60 s to answer. Then an ordinary car, no −30%.
  const startEv = await prisma.bookingEvent.findFirst({ where: { bookingId: guestId, type: 'SHARE_LIVE_SEARCH' }, orderBy: { createdAt: 'asc' } });
  if (!startEv) {
    if (await prisma.shareGroup.count({ where: { guestBookingId: guestId } })) return false; // searched before (old rule)
    await prisma.$transaction(async (tx) => {
      await tx.bookingEvent.create({ data: { bookingId: guestId, type: 'SHARE_LIVE_SEARCH', actorType: 'SYSTEM', reason: `co-rider search: ${LIVE_PASSES} passes, ${LIVE_PASS_GAP_SEC} s apart`, createdAt: now } });
      const job = await tx.dispatchJob.findUnique({ where: { bookingId: guestId } });
      if (job) await tx.dispatchJob.update({ where: { id: job.id }, data: { deadlineAt: new Date(Math.max(now.getTime(), job.deadlineAt.getTime()) + LIVE_SEARCH_SPAN_SEC * 1000) } });
    });
  }
  const startedAt = startEv?.createdAt.getTime() ?? now.getTime();
  const pass = livePass.get(guestId) ?? { n: 0, last: 0 };
  if (pass.n >= LIVE_PASSES) return false; // three passes done, nobody pending → ordinary car
  if (now.getTime() - startedAt > (LIVE_SEARCH_SPAN_SEC + 15) * 1000) return false; // e.g. after a restart: no endless search
  if (pass.n > 0 && now.getTime() - pass.last < LIVE_PASS_GAP_SEC * 1000) return true; // between passes
  pass.n += 1; pass.last = now.getTime();
  livePass.set(guestId, pass);
  if (livePass.size > 2000) for (const [k, v] of livePass) if (now.getTime() - v.last > 10 * MIN) livePass.delete(k);

  // Cars already offered this newcomer are not asked again.
  const asked = (await prisma.shareGroup.findMany({ where: { guestBookingId: guestId }, select: { hostBookingId: true } })).map((g) => g.hostBookingId);
  const hosts = await prisma.booking.findMany({
    where: {
      id: { notIn: asked },
      status: { in: [...LIVE_HOST_STATUSES] }, shareOptIn: true, vClass: guest.vClass, fareCents: { not: null }, stopLat: null,
      shareAsHost: { none: { activeHostBookingId: { not: null } } }, shareAsGuest: { none: { activeGuestBookingId: { not: null } } },
      // …and not a driver who already took his next ride (2026-11-25): a co-rider would make him late for it.
      assignments: { some: { activeDriverId: { not: null }, driver: { acceptsShared: true, onDuty: true, assignments: { none: { queuedDriverId: { not: null } } } } } },
    },
    include: { assignments: { where: { activeDriverId: { not: null } }, include: { vehicle: true, driver: { include: { location: true } } } } },
    take: 50,
  });

  const gp = pt(guest.pickupLat, guest.pickupLng);
  // 1) Straight-line prefilter with some slack, 2) road time for up to nine, best first.
  const SLACK = 10;
  const pre: { host: (typeof hosts)[number]; plan: SharePlan; pts: Parameters<typeof bestSharePlan>[0] }[] = [];
  for (const h of hosts) {
    if (!shareCapable(h)) continue;
    const a = h.assignments[0];
    if (!a || !shareFits(h, guest, Math.min(a.vehicle.seats, SHARE_COMFORT_SEATS), S().luggage[guest.vClass])) continue; // a Comfort pair stays ≤ 4 even in an XL car
    const loc = a.driver.location;
    const start = loc ? pt(loc.lat, loc.lng) : pt(h.pickupLat, h.pickupLng);
    if (haversineMeters(start, gp) > 40_000) continue; // far away: not "on the way"
    const pts = { start, Hp: pt(h.pickupLat, h.pickupLng), Hd: pt(h.dropoffLat, h.dropoffLng), Gp: gp, Gd: pt(guest.dropoffLat, guest.dropoffLng) };
    const plan = bestSharePlan(pts, approxLegMin, { hostOnBoard: h.status === 'IN_PROGRESS', hostMaxExtra: liveMax(h) + SLACK, guestMaxExtra: liveMax(guest) + SLACK });
    if (plan && !hostArrivesInTime(h, plan, now, SLACK)) continue;
    if (plan && plan.arrive.guestPickup > LIVE_PICKUP_MAX_MIN + SLACK) continue;
    if (plan) pre.push({ host: h, plan, pts });
  }
  pre.sort((a, b) => a.plan.extraHost + a.plan.extraGuest - (b.plan.extraHost + b.plan.extraGuest));
  const fits: LiveOffer[] = [];
  for (const c of pre.slice(0, 9)) {
    const { result: plan, routed } = await planWithRoads(
      (leg) => bestSharePlan(c.pts, leg, { hostOnBoard: c.host.status === 'IN_PROGRESS', hostMaxExtra: liveMax(c.host), guestMaxExtra: liveMax(guest) }), null);
    if (!plan || !hostArrivesInTime(c.host, plan, now)) continue; // «быть на месте до …» − 10 min is a hard deadline
    if (plan.arrive.guestPickup > LIVE_PICKUP_MAX_MIN) continue; // «сейчас + 15 минут»: the car must be with him within 15 min
    fits.push({ hostId: c.host.id, driverId: c.host.assignments[0].driverId, plan, routed });
  }
  if (!fits.length) return pass.n < LIVE_PASSES; // nobody on the way yet — the next pass in 10 s, after the third: an ordinary car
  if (await proposeLiveAll(guestId, fits.slice(0, LIVE_MAX_OFFERS), now)) return true;
  return pass.n < LIVE_PASSES;
}

/** «Попутчик» on a ride NOW (operator 2026-11-24): three passes 10 s apart for a car on the way, then an ordinary car. */
export const LIVE_PASSES = 3;
export const LIVE_PASS_GAP_SEC = 10;
const LIVE_SEARCH_SPAN_SEC = (LIVE_PASSES - 1) * LIVE_PASS_GAP_SEC;
const livePass = new Map<string, { n: number; last: number }>();
/** «Сейчас + 15 минут на попутчика»: the co-rider car must reach the newcomer within this. */
export const LIVE_PICKUP_MAX_MIN = 15;
/** Extra time on the road for a live co-rider ride: 15 min for everyone (operator 2026-11-24, no 10/30 choice). */
const liveMax = (b: { shareMaxExtraMin: number | null }) => Math.min(maxExtra(b), S().termsMaxExtraMin);
/** At most this many co-rider cars get the same newcomer at once. */
const LIVE_MAX_OFFERS = 5;
/** Two drivers who say yes within this of each other count as «at the same time» (operator 2026-11-23). */
export const LIVE_SAME_TIME_SEC = 1;
type LiveOffer = { hostId: string; driverId: string; plan: SharePlan; routed: boolean };

// «Быть на месте до …» (2026-11-22): a co-rider picked up on the way must never make a host with an
// arrival window late. Conservative: the trip cannot start before the booked pickup time.
function hostArrivesInTime(h: { arriveBy: Date | null; scheduledAt: Date | null; status: string }, plan: SharePlan, now: Date, slackMin = 0): boolean {
  if (!h.arriveBy) return true;
  const start = h.status === 'IN_PROGRESS' ? now.getTime() : Math.max(now.getTime(), h.scheduledAt?.getTime() ?? 0);
  // With the same 10-minute buffer as pre-bookings: no risk of being late (operator 2026-11-23).
  return start + plan.arrive.host * MIN <= h.arriveBy.getTime() + (slackMin - ARRIVE_BUFFER_MIN) * MIN;
}

/**
 * «Попутчик в дороге» (operator 2026-11-23): the newcomer is offered to EVERY fitting co-rider car at
 * once, for config.share.answerSec (60 s). Whoever takes it first gets it — but if several drivers say yes
 * at about the same time (LIVE_SAME_TIME_SEC), the one best for the passenger already in the car wins
 * (fewest extra minutes for him), then the earlier yes. Only ONE car ever gets the co-rider
 * (activeGuestBookingId is set on the winner alone, and it is unique). Nobody takes it → an ordinary car.
 */
async function proposeLiveAll(guestId: string, offers: LiveOffer[], now: Date): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBookings(tx, [guestId, ...offers.map((o) => o.hostId)]);
      const g = await tx.booking.findUnique({ where: { id: guestId } });
      if (!g || g.status !== 'SEARCHING' || (await activeGroupOf(tx, guestId))) return false;
      // The guest may not be offered to an ordinary driver at the same time.
      if (await tx.driverOffer.findFirst({ where: { activeBookingId: guestId } })) return false;
      const expiresAt = new Date(now.getTime() + S().answerSec * 1000); // the driver keeps his 60 s (operator 2026-11-24)
      let made = 0;
      for (const o of offers) {
        const h = await tx.booking.findUnique({ where: { id: o.hostId } });
        if (!h || !LIVE_HOST_STATUSES.includes(h.status as never) || (await activeGroupOf(tx, h.id))) continue;
        // The passenger in the car agreed to these terms when ordering: not asked. The guest slot is taken only by the winner.
        const group = await tx.shareGroup.create({ data: { ...groupData('LIVE', h, g, o.plan, expiresAt, { driverId: o.driverId, guestAnswer: 'YES', hostAnswer: 'YES', routed: o.routed }), activeGuestBookingId: null } });
        await tx.bookingEvent.create({ data: { bookingId: h.id, type: 'SHARE_PROPOSED', actorType: 'SYSTEM', reason: `co-rider ${g.reference}` } });
        await recordEvent(tx, { eventType: 'share.proposed', aggregateType: 'share', aggregateId: group.id, aggregateVersion: 1, correlationId: guestId, payload: { mode: 'LIVE', driverPseudo: driverPseudo(o.driverId), extraMinHost: o.plan.extraHost, extraMinGuest: o.plan.extraGuest, offers: offers.length } });
        await enqueueDriver(tx, o.driverId, 'Co-rider on your route', driverProposalBody(o.plan.extraDriver, earningsUpPct(group.hostCents + group.guestCents, h.fareCents ?? 0)), { tag: `share-d-${group.id}` });
        made++;
      }
      if (!made) return false;
      await tx.bookingEvent.create({ data: { bookingId: guestId, type: 'SHARE_PROPOSED', actorType: 'SYSTEM', reason: `offered to ${made} co-rider car(s)` } });
      // Give the newcomer's normal search the answer time back, so «nobody» still leaves time to search.
      const job = await tx.dispatchJob.findUnique({ where: { bookingId: guestId } });
      if (job) await tx.dispatchJob.update({ where: { id: job.id }, data: { deadlineAt: new Date(Math.max(now.getTime(), job.deadlineAt.getTime()) + (S().answerSec + LIVE_SAME_TIME_SEC) * 1000) } });
      return true;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false; // another group won the race
    throw e;
  }
}

/**
 * Settle the drivers who said yes to this newcomer. Waits while another driver may still answer within
 * LIVE_SAME_TIME_SEC of the first yes; then the best for the passenger in the car wins and every other
 * offer for this newcomer closes (their drivers are told). Returns true if a car got the co-rider.
 */
export async function decideLive(guestId: string, now: Date = new Date()): Promise<boolean> {
  const groups = await prisma.shareGroup.findMany({ where: { guestBookingId: guestId, mode: 'LIVE', status: 'PROPOSED' } });
  const yes = groups.filter((g) => g.driverAnswer === 'YES');
  if (!yes.length) return false;
  const firstYes = Math.min(...yes.map((g) => (g.decidedAt ?? g.createdAt).getTime()));
  const stillOpen = groups.some((g) => !g.driverAnswer && g.expiresAt > now);
  if (stillOpen && now.getTime() - firstYes < LIVE_SAME_TIME_SEC * 1000) return false; // «at the same time» window
  const ranked = [...yes].sort((a, b) => a.extraMinHost - b.extraMinHost || (a.decidedAt ?? a.createdAt).getTime() - (b.decidedAt ?? b.createdAt).getTime() || a.extraMinDriver - b.extraMinDriver);
  return prisma.$transaction(async (tx) => {
    await lockBookings(tx, [guestId, ...groups.map((g) => g.hostBookingId)]);
    let won: string | null = null;
    for (const c of ranked) {
      const cur = await tx.shareGroup.findUnique({ where: { id: c.id } });
      if (cur?.status !== 'PROPOSED' || cur.driverAnswer !== 'YES') continue;
      const r = await finalizeLiveTx(tx, c.id);
      if (r.ok) { won = c.id; break; }
    }
    // Close the rest; a driver who said yes (or still sees it) hears that someone else took it.
    for (const g of groups) {
      if (g.id === won) continue;
      const cur = await tx.shareGroup.findUnique({ where: { id: g.id } });
      if (cur?.status !== 'PROPOSED') continue;
      await closeGroupTx(tx, g.id, 'CANCELED', won ? 'another driver took the co-rider' : 'the co-rider is no longer available');
      if (g.driverId) await enqueueDriver(tx, g.driverId, 'Co-rider taken', 'Another driver took this co-rider.', { tag: `share-d-${g.id}`, msg: { k: 'share.taken', p: {} } });
    }
    return !!won;
  });
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

export async function answerShare(groupId: string, party: ShareParty, accept: boolean, now: Date = new Date(), variant?: number): Promise<ShareResult> {
  const pre = await prisma.shareGroup.findUnique({ where: { id: groupId } });
  if (!pre) return fail(404, 'NOT_FOUND', 'Proposal not found.');
  const res: ShareResult = await prisma.$transaction(async (tx) => {
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
    // An older booking's owner picks one of the offered pickup times (TZ 2026-11-23).
    const variants = (grp.variants ?? null) as PairVariant[] | null;
    let pick: Prisma.ShareGroupUpdateInput = {};
    if (accept && grp.mode === 'PREBOOK' && variants?.length) {
      const idx = variant ?? grp.chosenVariant ?? 0;
      if (!Number.isInteger(idx) || idx < 0 || idx >= variants.length) return fail(422, 'VALIDATION', 'Choose one of the offered times.');
      pick = { chosenVariant: idx, startAt: new Date(variants[idx].startAt) };
    }
    const g2 = await tx.shareGroup.update({ where: { id: grp.id }, data: { [field]: answer, ...pick, ...(grp.mode === 'LIVE' && accept ? { decidedAt: now } : {}) } });
    if (!accept) {
      await closeGroupTx(tx, grp.id, 'DECLINED', `${field.replace('Answer', '')} declined`);
      return { ok: true, status: 'DECLINED' };
    }
    const allYes = g2.mode === 'LIVE' ? g2.hostAnswer === 'YES' && g2.driverAnswer === 'YES' : g2.hostAnswer === 'YES' && g2.guestAnswer === 'YES';
    if (!allYes) return { ok: true, status: 'PROPOSED' };
    // LIVE: several cars may have the same newcomer — the winner is settled by decideLive (below).
    return g2.mode === 'LIVE' ? { ok: true, status: 'WAITING' } : finalizePrebookTx(tx, g2.id);
  });
  if (res.ok && res.status === 'WAITING') {
    // Nobody else can still answer → settle now; otherwise in LIVE_SAME_TIME_SEC (1 s) — a timer here,
    // and the worker (every 2 s) as the safety net.
    await decideLive(pre.guestBookingId, now);
    const t = setTimeout(() => { decideLive(pre.guestBookingId).catch(() => { /* the worker settles it */ }); }, LIVE_SAME_TIME_SEC * 1000 + 100);
    t.unref?.();
    const after = await prisma.shareGroup.findUnique({ where: { id: groupId }, select: { status: true } });
    return { ok: true, status: after?.status === 'PROPOSED' ? 'WAITING' : after?.status ?? 'WAITING' };
  }
  return res;
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
  await tx.shareGroup.update({ where: { id: g.id }, data: { status: 'ACCEPTED', activeGuestBookingId: guest.id } });
  await recordEvent(tx, { eventType: 'share.accepted', aggregateType: 'share', aggregateId: g.id, aggregateVersion: 2, correlationId: guest.id, payload: { mode: 'LIVE', driverPseudo: driverPseudo(hostAsg.driverId) } });
  // ONE notification each, only now that the driver took it (operator 2026-11-23): arrival and the amount.
  const arr = (g.arrivals ?? {}) as { host?: number; guest?: number; guestPickup?: number };
  const now = Date.now();
  const at = (m: number | undefined) => new Date(now + (m ?? 0) * MIN).toISOString();
  const eur = (c: number) => `€${(c / 100).toFixed(2)}`;
  await enqueuePassenger(tx, guest.id, 'Driver assigned — shared ride', `Pickup about ${at(arr.guestPickup).slice(11, 16)} UTC. You pay ${eur(g.guestCents)}.`,
    { url: '/track', msg: { k: 'share.liveGuest', p: { pickT: at(arr.guestPickup), etaT: at(arr.guest), payC: g.guestCents } } });
  await enqueuePassenger(tx, host.id, 'A co-rider joins your ride', `You arrive about ${at(arr.host).slice(11, 16)} UTC. You pay ${eur(g.hostCents)}.`,
    { url: '/track', msg: { k: 'share.liveHost', p: { etaT: at(arr.host), payC: g.hostCents } } });
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
  // ONE notification per passenger (TZ 2026-11-23): their own pickup time, estimated arrival and the amount they pay.
  if (g.startAt) {
    const arr = (g.arrivals ?? {}) as { host?: number; guest?: number; guestPickup?: number };
    const at = (min: number | undefined) => new Date(g.startAt!.getTime() + (min ?? 0) * MIN);
    const clock = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Nicosia', hour: '2-digit', minute: '2-digit' }).format(d);
    for (const [b, pick, eta, cents] of [[h, g.startAt, at(arr.host), g.hostCents], [gu, at(arr.guestPickup), at(arr.guest), g.guestCents]] as const) {
      await enqueuePassenger(tx, b.id, 'Co-rider found', `Pickup ${clock(pick)}, arrival about ${clock(eta)}. You pay €${(cents / 100).toFixed(2)}.`,
        { url: rideUrl(b), tag: `share-m-${g.id}`, msg: { k: 'share.found', p: { pickT: pick.toISOString(), etaT: eta.toISOString(), payC: cents } } });
    }
  } else {
    for (const [b, cents] of [[h, g.hostCents], [gu, g.guestCents]] as const) {
      await enqueuePassenger(tx, b.id, 'Co-rider found', `You pay €${(cents / 100).toFixed(2)}.`, { msg: { k: 'share.confirmed', p: { pct: g.discountPct } } });
    }
  }
  return { ok: true, status: 'MATCHED' };
}

/** Worker: proposals nobody answered in time count as "no". */
export async function expireShares(now: Date = new Date()): Promise<number> {
  // A live «yes» waiting to be settled is never expired: settle it (operator 2026-11-23). OR, not NOT: NOT skips NULL rows.
  const waiting = await prisma.shareGroup.findMany({ where: { status: 'PROPOSED', mode: 'LIVE', driverAnswer: 'YES' }, select: { guestBookingId: true }, distinct: ['guestBookingId'] });
  for (const w of waiting) await decideLive(w.guestBookingId, now);
  const due = await prisma.shareGroup.findMany({ where: { status: 'PROPOSED', expiresAt: { lte: now }, OR: [{ mode: 'PREBOOK' }, { driverAnswer: null }, { driverAnswer: { not: 'YES' } }] }, select: { id: true, hostBookingId: true, guestBookingId: true } });
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

type PairInput = ShareBooking & { id: string; arriveFrom?: Date | null; arriveBy?: Date | null };
export interface PairTiming { startAt: Date; lo: Date; hi: Date; hostWait: number; guestWait: number }
export type PairFit<T extends PairInput> = { host: T; guest: T; timing: PairTiming; plan: SharePlan };

/** Arrive this much before the end of a passenger's «быть на месте» window (operator 2026-11-23: «чуть запас»). */
export const ARRIVE_BUFFER_MIN = 10;
/** The share board shows rides whose window is within this of mine; joining one may move me up to this far (operator 2026-11-23). */
export const BOARD_REACH_MIN = 60;

/**
 * The start time window for a plan. With «быть на месте» windows (operator 2026-11-23) the whole route is
 * computed first, then the start is set so that each passenger arrives inside their own window, the later
 * one about ARRIVE_BUFFER_MIN before its end — the latest start that keeps everyone in. A passenger
 * without a window keeps their pickup interval instead. `flexId` = the passenger who chose this pair on the
 * board and agreed to the other's time: they may arrive up to BOARD_REACH_MIN outside their own window.
 */
function startRange(h: PairInput, g: PairInput, pl: SharePlan, slack: number, flexId?: string): { lo: number; hi: number } | null {
  let lo = -Infinity, hi = Infinity;
  const rows: [PairInput, number, number][] = [[h, pl.arrive.host, 0], [g, pl.arrive.guest, pl.arrive.guestPickup]];
  for (const [b, arr, pick] of rows) {
    if (b.arriveFrom && b.arriveBy) {
      const flex = b.id === flexId ? BOARD_REACH_MIN : 0;
      lo = Math.max(lo, b.arriveFrom.getTime() - (5 + flex + slack) * MIN - arr * MIN); // ≤5 min early is fine
      hi = Math.min(hi, b.arriveBy.getTime() + (flex ? flex : -ARRIVE_BUFFER_MIN + slack) * MIN - arr * MIN);
    } else {
      const flex = b.id === flexId ? BOARD_REACH_MIN : 0;
      lo = Math.max(lo, b.scheduledAt!.getTime() - (earlyMin(b) + flex + slack) * MIN - pick * MIN);
      hi = Math.min(hi, b.scheduledAt!.getTime() + (waitMin(b) + flex + slack) * MIN - pick * MIN);
    }
  }
  return lo <= hi ? { lo, hi } : null;
}

/**
 * The best way two co-rider pre-bookings can ride together, or null. Each passenger: at most
 * `shareMaxExtraMin` extra minutes in the car, arrival inside their own window (with the buffer).
 * Either can be picked up first; the better one wins by `comparePairs` (the larger of the two
 * «how far before the end of my window» first, then the smaller total detour). `slack` loosens every
 * limit for the quick straight-line pre-filter.
 */
export function fitPair<T extends PairInput>(a: T, b: T, leg: LegFn, slack = 0, flexId?: string): PairFit<T> | null {
  let best: PairFit<T> | null = null;
  for (const [h, g] of [[a, b], [b, a]] as const) {
    const pts = { Hp: pt(h.pickupLat, h.pickupLng), Hd: pt(h.dropoffLat, h.dropoffLng), Gp: pt(g.pickupLat, g.pickupLng), Gd: pt(g.dropoffLat, g.dropoffLng) };
    const plan = bestPrebookPlan(pts, leg, { hostMaxExtra: maxExtra(h) + slack, guestMaxExtra: maxExtra(g) + slack, accept: (pl) => !!startRange(h, g, pl, slack, flexId) });
    if (!plan) continue;
    const r = startRange(h, g, plan, slack, flexId)!;
    // The latest start (arrive near the end, with the buffer), on a whole minute when that stays inside.
    const startAt = new Date(Math.floor(r.hi / MIN) * MIN >= r.lo ? Math.floor(r.hi / MIN) * MIN : r.hi);
    // «Shift» for the choice: how far before the end of the window each arrives (pickup-based: from the booked time).
    const shift = (x: PairInput, arr: number, pick: number) => x.id === flexId ? 0 : x.arriveBy ? Math.round((x.arriveBy.getTime() - startAt.getTime()) / MIN - arr) : Math.round((startAt.getTime() + pick * MIN - x.scheduledAt!.getTime()) / MIN);
    const timing: PairTiming = { startAt, lo: new Date(r.lo), hi: new Date(r.hi), hostWait: shift(h, plan.arrive.host, 0), guestWait: shift(g, plan.arrive.guest, plan.arrive.guestPickup) };
    const cand = { host: h, guest: g, timing, plan };
    if (!best || comparePairs({ ...timing, ...plan }, { ...best.timing, ...best.plan }) < 0) best = cand;
  }
  return best;
}

export async function matchPrebookings(now: Date = new Date()): Promise<number> {
  await ensureAirportAreas(); // the airport = a territory marked «это аэропорт» (2026-11-25)
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
  // Older bookings (no terms version) are not paired automatically: they ride as booked (operator 2026-11-23).
  const cands = rows.filter(shareCapable).filter((r) => !!r.shareTermsVersion);
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
    type Fit = PairFit<(typeof cands)[number]>;
    const pre: Fit[] = [];
    for (let j = i + 1; j < cands.length; j++) {
      const g = cands[j];
      if (used.has(g.id) || g.vClass !== h.vClass || tried.has(`${h.id}|${g.id}`)) continue;
      if (h.passengerId && h.passengerId === g.passengerId) continue; // the same person's two rides
      // Sorted by time: once the gap is beyond what anyone could move (plus driving to the co-rider), later rides cannot fit either.
      if (g.scheduledAt!.getTime() - h.scheduledAt!.getTime() > (waitMin(h) + earlyMin(g) + 180) * MIN) break;
      const seats = settings.classes.find((c) => c.key === h.vClass)?.maxPassengers ?? 4;
      if (!shareFits(h, g, seats, S().luggage[h.vClass])) continue;
      const f = fitPair(h, g, approxLegMin, 5); // straight-line pre-filter with a little slack
      if (f) pre.push(f);
    }
    pre.sort((x, y) => comparePairs({ ...x.timing, ...x.plan }, { ...y.timing, ...y.plan }));
    let best: (Fit & { routed: boolean }) | null = null;
    for (const c of pre.slice(0, 3)) {
      // Road time with the traffic expected at the ride's own time; strict limits.
      const { result, routed } = await planWithRoads((leg) => fitPair(c.host, c.guest, leg), c.host.scheduledAt);
      if (result && (!best || comparePairs({ ...result.timing, ...result.plan }, { ...best.timing, ...best.plan }) < 0)) best = { ...result, routed };
    }
    if (!best) continue;
    const ok = await proposePrebook(best.host.id, best.guest.id, best.plan, best.timing.startAt, best.routed, now, undefined, best.timing);
    if (ok) { used.add(best.host.id); used.add(best.guest.id); made++; }
  }
  return made;
}

/** Where a co-rider push opens: an account holder's ride page straight away (the choice is there); a guest's tracking page. */
const rideUrl = (b: { id: string; passengerId: string | null }) => (b.passengerId ? `/prebookings?open=${b.id}` : '/track');

/** A pickup-time option for an older booking's owner (TZ 2026-11-23). */
export interface PairVariant { startAt: string; guestPickupAt: string; hostArriveAt: string; guestArriveAt: string }

/**
 * Up to three pickup times the pair can use: the best one, the earliest and the latest start that keep both
 * passengers inside their intervals and arrival windows (at least 10 min apart). Sorted by time.
 */
function pairVariants(h: PairInput, g: PairInput, plan: SharePlan, startAt: Date, range?: { lo: Date; hi: Date }): PairVariant[] {
  // Rounded to 5 minutes INSIDE the interval (the earliest up, the latest down); the best one as computed.
  const step = 5 * MIN;
  const starts = [startAt.getTime(), ...(range ? [Math.ceil(range.lo.getTime() / step) * step, Math.floor(range.hi.getTime() / step) * step] : [])];
  const out: number[] = [];
  for (const t of starts) {
    if (range && (t < range.lo.getTime() || t > range.hi.getTime())) continue;
    if (!arrivalFits(h, new Date(t + plan.arrive.host * MIN)) || !arrivalFits(g, new Date(t + plan.arrive.guest * MIN))) continue;
    if (out.some((o) => Math.abs(o - t) < 10 * MIN)) continue;
    out.push(t);
  }
  if (!out.length) out.push(startAt.getTime());
  return out.sort((a, b) => a - b).map((t) => ({
    startAt: new Date(t).toISOString(), guestPickupAt: new Date(t + plan.arrive.guestPickup * MIN).toISOString(),
    hostArriveAt: new Date(t + plan.arrive.host * MIN).toISOString(), guestArriveAt: new Date(t + plan.arrive.guest * MIN).toISOString(),
  }));
}

/**
 * Create a pre-booked pair. TZ «Попутчик −30%» (2026-11-23): a booking made under the shown terms
 * («при совпадении объединим автоматически», a version on the booking) needs no answer; nor does the
 * passenger who chose this pair on the share board (`fromBoard`). An OLDER booking (no terms version —
 * its owner was promised a separate question, or we cannot tell which terms he accepted) must answer:
 * he gets one card with pickup-time options, the price and «no». Up to 30 min, at the latest 1 h before
 * the first pickup; «no» or silence keeps both bookings separate at their full price.
 * Returns the group id, or null.
 */
export async function proposePrebook(hostId: string, guestId: string, plan: SharePlan, startAt: Date, routed: boolean, now: Date, fromBoard?: { byBookingId: string }, range?: { lo: Date; hi: Date }): Promise<string | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBookings(tx, [hostId, guestId]);
      const [h, g] = await Promise.all([tx.booking.findUnique({ where: { id: hostId } }), tx.booking.findUnique({ where: { id: guestId } })]);
      if (!h || !g || h.status !== 'REQUESTED' || g.status !== 'REQUESTED') return null;
      if ((await activeGroupOf(tx, hostId)) || (await activeGroupOf(tx, guestId))) return null;
      if (await tx.preAssignment.findFirst({ where: { activeBookingId: { in: [hostId, guestId] } } })) return null;
      const hostYes = !!h.shareTermsVersion || fromBoard?.byBookingId === h.id;
      const guestYes = !!g.shareTermsVersion || fromBoard?.byBookingId === g.id;
      const variants = hostYes && guestYes ? null : pairVariants(h, g, plan, startAt, range);
      const firstStart = variants ? new Date(variants[0].startAt) : startAt;
      // The answer window: 30 min, and at the latest 1 h before the first pickup.
      const expiresAt = new Date(Math.min(now.getTime() + S().prebookAnswerMin * MIN, firstStart.getTime() - S().prebookAnswerBeforePickupMin * MIN));
      if (expiresAt.getTime() - now.getTime() < 5 * MIN) return null;
      const group = await tx.shareGroup.create({
        data: { ...groupData('PREBOOK', h, g, plan, expiresAt, { routed, startAt, hostAnswer: hostYes ? 'YES' : undefined, guestAnswer: guestYes ? 'YES' : undefined }), ...(variants ? { variants: variants as unknown as Prisma.InputJsonValue } : {}) },
      });
      await recordEvent(tx, { eventType: 'share.proposed', aggregateType: 'share', aggregateId: group.id, aggregateVersion: 1, correlationId: hostId, payload: { mode: 'PREBOOK', extraMinHost: plan.extraHost, extraMinGuest: plan.extraGuest, by: fromBoard ? 'board' : 'auto', ask: variants ? [hostYes ? null : 'host', guestYes ? null : 'guest'].filter(Boolean) : [] } });
      if (hostYes && guestYes) {
        const r = await finalizePrebookTx(tx, group.id);
        return r.ok ? group.id : null;
      }
      // Ask only the older booking's owner (both, if both are older).
      for (const [b, other, yes, extra] of [[h, g, hostYes, plan.extraHost], [g, h, guestYes, plan.extraGuest]] as const) {
        if (yes) continue;
        await enqueuePassenger(tx, b.id, 'Co-rider found', proposalBody(other, extra, S().discountPct), { url: rideUrl(b), tag: `share-p-${group.id}` });
      }
      return group.id;
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
  // His next order (2026-11-25): the trip he was finishing ended → it becomes his active ride, he heads there.
  if (other.queuedDriverId) {
    if (!(await tx.assignment.findFirst({ where: { activeDriverId: ended.driverId }, select: { id: true } }))) await promoteQueuedTx(tx, other);
    await tx.driver.update({ where: { id: ended.driverId }, data: { available: false } });
    return;
  }
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

/** The next order (2026-11-25) becomes the driver's active ride: ASSIGNED → EN_ROUTE, the passenger hears the
 *  driver is now on the way. */
export async function promoteQueuedTx(tx: Tx, q: { id: string; bookingId: string; driverId: string; vehicleId: string }): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${q.bookingId} FOR UPDATE`;
  await tx.assignment.update({ where: { id: q.id }, data: { activeDriverId: q.driverId, activeVehicleId: q.vehicleId, queuedDriverId: null } });
  const b = await tx.booking.findUnique({ where: { id: q.bookingId }, select: { status: true } });
  if (b?.status !== 'ASSIGNED') return;
  const u = await tx.booking.update({ where: { id: q.bookingId }, data: { status: 'EN_ROUTE', revision: { increment: 1 } } });
  await tx.bookingEvent.create({ data: { bookingId: q.bookingId, type: 'STATUS_EN_ROUTE', actorType: 'SYSTEM', beforeStatus: 'ASSIGNED', afterStatus: 'EN_ROUTE', reason: 'previous trip finished' } });
  await recordEvent(tx, { eventType: 'booking.en_route', aggregateType: 'booking', aggregateId: q.bookingId, aggregateVersion: u.revision, correlationId: q.bookingId, payload: { bookingId: q.bookingId, status: 'EN_ROUTE', actorType: 'SYSTEM', reason: 'previous trip finished' } });
  await enqueuePassenger(tx, q.bookingId, 'Your driver is on the way', 'The driver has finished the previous ride and is heading to you.', { msg: { k: 'ride.nextOnWay' } });
}
