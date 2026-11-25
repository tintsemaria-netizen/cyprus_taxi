import { Prisma } from '@prisma/client';
import { ensureAirportAreas } from '@/server/no-go';
import { blockedPassengerIdsForDriver, isPairBlocked } from './blocked-pairs';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { canWork } from '@/lib/eligibility-policy';
import { isAirportPoint } from '@/lib/airports';
import { createAssignment } from '@/server/assignments';
import { enqueueDriver, enqueuePassenger, enqueuePassengerDriverNews } from '@/server/push';
import { recordEvent, driverPseudo, bookingEventPayload } from '@/server/events';
import { stopSearchTx } from './search';
import { endPreAssignmentTx, protectedDriverIds, roughMin, PREBOOK_EARLY_MIN } from './preassign-core';
import { computeFreshness } from '@/lib/freshness';
import { haversineMeters } from '@/lib/geo';
import { googleConfigured, googleRoute } from '@/server/google';
import { attachMatchedGuestTx } from '@/server/share';
import { pairDetail, approxLabel } from '@/server/share-detail';
export { endPreAssignmentTx, protectedDriverIds };

// Pre-assignment of scheduled rides (airport transfers etc.).
//
// Policy (Task 012 §4.4; our own policy, not a claim about any competitor's algorithm):
//  - Drivers see a board of upcoming scheduled rides that fit their bound vehicle and COMMIT to one.
//    The future is not predictable enough to auto-match hours ahead, so the driver chooses.
//  - A commitment never makes the driver busy now; they keep taking immediate rides. Only within
//    PREASSIGN_PROTECT_MINUTES of a commitment do they stop receiving new immediate offers.
//  - PREASSIGN_CONVERT_MINUTES before pickup the worker turns the commitment into a real Assignment
//    (SYSTEM actor) if the driver is on duty and free; it retries every tick until the normal
//    scheduled-search lead (DISPATCH_SCHEDULE_LEAD_MINUTES) and otherwise LAPSES the commitment, so
//    the ride falls back to automatic search. Both parties are told; nothing is silently dropped.
//  - Limits per driver: PREASSIGN_MAX_PER_DRIVER live commitments, PREASSIGN_MIN_GAP_MINUTES apart,
//    checked under the driver row lock (lock order everywhere: booking row, then driver row).

type Tx = Prisma.TransactionClient;
export type PAResult = { ok: true; status: string } | { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): PAResult => ({ ok: false, status, code, message });
const MIN = 60_000;

const timeLabel = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Nicosia', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);

async function boundVehicle(db: Tx | typeof prisma, driverId: string) {
  const b = await db.driverVehicleBinding.findFirst({ where: { driverId, endedAt: null }, include: { vehicle: true } });
  return b && b.vehicle.active ? b.vehicle : null;
}

export interface BoardItem {
  bookingId: string; reference: string; pickupAt: string; pickupLabel: string; dropoffLabel: string; dropoffPostcode: string | null;
  vClass: string; passengerCount: number; fareCents: number | null; priceType: string | null;
  minCents?: number | null; // pre-booking minimum in Nicosia (2026-11-22)
  flightNumber: string | null; airport: boolean; conflict: boolean;
  note: string | null; // the passenger writes flight, meeting point and bags here
  share?: ShareBoardInfo | null; // ride-share pair (Task 022): one order, two passengers
  /** «Быть на месте с … до …» (2026-11-22): the passenger must ARRIVE inside this window. */
  arrive?: { from: string; by: string } | null;
  span?: { from: string; to: string } | null;
}

// A pre-booked ride-share pair as one order on the board: the second passenger's stops and time,
// the people/children/suitcases of both, and what the driver earns (both shared prices). Never names.
export interface ShareBoardInfo {
  guestPickupAt: string; guestPickupLabel: string; guestDropoffLabel: string;
  passengers: number; children: number; luggage: number;
  totalFareCents: number; extraMin: number; plan: { kind: string; who: string }[];
  hostArrive?: { from: string; by: string } | null; guestArrive?: { from: string; by: string } | null;
}

/** «Попутчик» departure hour (2026-11-25): the passenger expects the car 13:00–13:15. */
const spanOf = (b: { arriveFrom: Date | null; sharePickupFrom?: Date | null; sharePickupTo?: Date | null }) => (!b.arriveFrom && b.sharePickupFrom && b.sharePickupTo ? { from: b.sharePickupFrom.toISOString(), to: b.sharePickupTo.toISOString() } : null);
const arriveOf = (b: { arriveFrom: Date | null; arriveBy: Date | null }) => (b.arriveFrom && b.arriveBy ? { from: b.arriveFrom.toISOString(), by: b.arriveBy.toISOString() } : null);

async function sharePairs(bookingIds: string[]) {
  if (!bookingIds.length) return new Map<string, { hostId: string; info: ShareBoardInfo; guestId: string }>();
  const groups = await prisma.shareGroup.findMany({
    where: { status: 'MATCHED', OR: [{ activeHostBookingId: { in: bookingIds } }, { activeGuestBookingId: { in: bookingIds } }] },
    include: { host: true, guest: true },
  });
  const m = new Map<string, { hostId: string; info: ShareBoardInfo; guestId: string }>();
  for (const g of groups) {
    const v = {
      hostId: g.hostBookingId, guestId: g.guestBookingId,
      info: {
        guestPickupAt: g.guest.scheduledAt?.toISOString() ?? '', guestPickupLabel: approxLabel(g.guest.pickupLabel), guestDropoffLabel: approxLabel(g.guest.dropoffLabel),
        passengers: g.host.passengerCount + g.guest.passengerCount, children: g.host.childCount + g.guest.childCount,
        luggage: g.host.luggageCount + g.guest.luggageCount, totalFareCents: g.hostCents + g.guestCents,
        extraMin: g.extraMinDriver, plan: (g.plan as { kind: string; who: string }[]) ?? [],
        hostArrive: arriveOf(g.host), guestArrive: arriveOf(g.guest),
      },
    };
    m.set(g.hostBookingId, v); m.set(g.guestBookingId, v);
  }
  return m;
}

// The driver's view: rides they can still commit to, and their own live commitments.
export async function scheduledBoard(driverId: string, now: Date = new Date()) {
  await ensureAirportAreas(); // the airport = a territory marked «это аэропорт» (2026-11-25)
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  const vehicle = await boundVehicle(prisma, driverId);
  const mineRows = await prisma.preAssignment.findMany({
    where: { driverId, status: 'COMMITTED' },
    orderBy: { pickupAt: 'asc' },
    include: { booking: { select: { reference: true, pickupLabel: true, dropoffLabel: true, dropoffPostcode: true, pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true, passengerCount: true, vClass: true, fareCents: true, priceType: true, flightNumber: true, note: true, arriveFrom: true, arriveBy: true, sharePickupFrom: true, sharePickupTo: true, fareMinCents: true } } },
  });
  const minePairs = await sharePairs(mineRows.map((r) => r.bookingId));
  const mine = mineRows.map((p) => ({
    share: minePairs.get(p.bookingId)?.info ?? null,
    bookingId: p.bookingId, reference: p.booking.reference, pickupAt: p.pickupAt.toISOString(),
    pickupLabel: minePairs.get(p.bookingId) ? approxLabel(p.booking.pickupLabel) : p.booking.pickupLabel, dropoffLabel: minePairs.get(p.bookingId) ? approxLabel(p.booking.dropoffLabel) : p.booking.dropoffLabel, dropoffPostcode: p.booking.dropoffPostcode ?? null, vClass: p.booking.vClass,
    passengerCount: p.booking.passengerCount, fareCents: p.booking.fareCents, priceType: p.booking.priceType,
    minCents: p.booking.fareMinCents ?? null,
    flightNumber: p.booking.flightNumber, note: p.booking.note, arrive: arriveOf(p.booking), span: spanOf(p.booking),
    airport: isAirportPoint(p.booking.pickupLat, p.booking.pickupLng) || isAirportPoint(p.booking.dropoffLat, p.booking.dropoffLng),
    canReleaseFreely: p.pickupAt.getTime() - now.getTime() > config.dispatch.preassign.lateReleaseMinutes * MIN,
  }));

  if (!driver || !canWork(driver) || !vehicle) {
    return { available: [] as BoardItem[], mine, blocked: !driver || !canWork(driver) ? 'NOT_ELIGIBLE' : 'NO_VEHICLE' };
  }
  const p = config.dispatch.preassign;
  const rows = await prisma.booking.findMany({
    where: {
      status: 'REQUESTED',
      scheduledAt: { gt: new Date(now.getTime() + (p.convertMinutes + 5) * MIN), lt: new Date(now.getTime() + p.horizonHours * 3600_000) },
      vClass: vehicle.vClass,
      passengerCount: { lte: vehicle.seats },
      preAssignments: { none: { status: 'COMMITTED' } },
    },
    orderBy: { scheduledAt: 'asc' },
    take: 50,
    select: { id: true, passengerId: true, reference: true, scheduledAt: true, pickupLabel: true, dropoffLabel: true, dropoffPostcode: true, pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true, vClass: true, passengerCount: true, fareCents: true, priceType: true, flightNumber: true, note: true, arriveFrom: true, arriveBy: true, sharePickupFrom: true, sharePickupTo: true, fareMinCents: true },
  });
  const gap = p.minGapMinutes * MIN;
  // Never offer a passenger this driver is blocked with (1-star either way, blocked-pairs.ts).
  const blockedPax = await blockedPassengerIdsForDriver(driverId);
  // Ride-share pairs: the co-rider is never listed alone (it rides with whoever takes the host);
  // the pair is listed once — only to drivers who take co-riders and have the seats.
  const pairs = await sharePairs(rows.map((r) => r.id));
  const fitsPair = (id: string) => {
    const p = pairs.get(id);
    if (!p) return true;
    return p.hostId === id && driver.acceptsShared && vehicle.seats >= p.info.passengers;
  };
  const available: BoardItem[] = rows.filter((b) => (!b.passengerId || !blockedPax.has(b.passengerId)) && fitsPair(b.id)).map((b) => ({
    share: pairs.get(b.id)?.info ?? null,
    bookingId: b.id, reference: b.reference, pickupAt: b.scheduledAt!.toISOString(),
    // A ride-share pair shows approximate addresses until the ride starts (operator, 2026-11-19).
    pickupLabel: pairs.get(b.id) ? approxLabel(b.pickupLabel) : b.pickupLabel, dropoffLabel: pairs.get(b.id) ? approxLabel(b.dropoffLabel) : b.dropoffLabel, dropoffPostcode: b.dropoffPostcode ?? null, vClass: b.vClass, passengerCount: b.passengerCount,
    fareCents: b.fareCents, priceType: b.priceType, flightNumber: b.flightNumber, note: b.note, minCents: b.fareMinCents ?? null, arrive: arriveOf(b), span: spanOf(b),
    airport: isAirportPoint(b.pickupLat, b.pickupLng) || isAirportPoint(b.dropoffLat, b.dropoffLng),
    conflict: mineRows.length >= p.maxPerDriver || mineRows.some((m) => Math.abs(m.pickupAt.getTime() - b.scheduledAt!.getTime()) < gap),
  }));
  return { available, mine, blocked: null as string | null };
}

/**
 * How many minutes the driver needs to reach a point, with traffic (operator 2026-11-24). On a trip: via
 * that trip's drop-off. null = no live position from his phone (we cannot tell). Road time via Google when
 * configured (traffic-aware, departing now), else a rough estimate. Never called under a DB lock.
 */
export async function reachMinutes(driverId: string, target: { lat: number; lng: number }, now: Date = new Date()): Promise<number | null> {
  const loc = await prisma.latestDriverLocation.findUnique({ where: { driverId } });
  if (!loc || computeFreshness(loc.sampledAt, loc.receivedAt, now) !== 'fresh') return null;
  // On a trip: the time he will drop that passenger off counts (operator 2026-11-24) — via the pickup if he has
  // not picked him up yet, via a stop not yet made, then the drop-off, then on to the pre-booked pickup.
  const cur = await prisma.assignment.findFirst({ where: { activeDriverId: driverId }, select: { booking: { select: { status: true, pickupLat: true, pickupLng: true, stopLat: true, stopLng: true, stopDepartedAt: true, dropoffLat: true, dropoffLng: true } } } });
  type P = { lat: number; lng: number };
  const path: P[] = [loc];
  let total = 0;
  if (cur) {
    const c = cur.booking;
    if (c.status !== 'IN_PROGRESS') { path.push({ lat: c.pickupLat, lng: c.pickupLng }); total += 3; } // boarding
    if (c.stopLat != null && c.stopLng != null && !c.stopDepartedAt) { path.push({ lat: c.stopLat, lng: c.stopLng }); total += 3; }
    path.push({ lat: c.dropoffLat, lng: c.dropoffLng }); total += 2; // dropping off
  }
  path.push(target);
  const legs = path.slice(1).map((b, i) => [path[i], b] as [P, P]);
  for (const [a, b] of legs) {
    let m: number | null = null;
    if (googleConfigured()) {
      try { const r = await googleRoute(a, b, new Date(Math.max(now.getTime(), Date.now()) + MIN).toISOString(), { timeoutMs: 4000 }); m = r?.etaMinutes ?? null; } catch { m = null; }
    }
    total += m ?? roughMin(a, b);
  }
  return total;
}

export async function claimScheduled(driverId: string, bookingId: string, now: Date = new Date()): Promise<PAResult> {
  const p = config.dispatch.preassign;
  // Operator 2026-11-24: a ride starting within the hour is taken only by a driver who can reach the
  // pickup at least 5 minutes early, with traffic — otherwise «you are too far from the pickup».
  const soon = await prisma.booking.findUnique({ where: { id: bookingId }, select: { scheduledAt: true, pickupLat: true, pickupLng: true } });
  const left = soon?.scheduledAt ? soon.scheduledAt.getTime() - now.getTime() : Infinity;
  if (soon?.scheduledAt && left > (p.convertMinutes + 5) * MIN && left <= p.protectMinutes * MIN) {
    const need = await reachMinutes(driverId, { lat: soon.pickupLat, lng: soon.pickupLng }, now);
    if (need == null) return fail(409, 'NO_GPS', 'Turn on location: we need your position to check you can make it.');
    if (now.getTime() + (need + PREBOOK_EARLY_MIN) * MIN > soon.scheduledAt.getTime()) return fail(409, 'TOO_FAR_FROM_PICKUP', 'You are too far from the pickup.');
  }
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
      await tx.$executeRaw`SELECT 1 FROM "Driver" WHERE id = ${driverId} FOR UPDATE`;
      const b = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!b) return fail(404, 'BOOKING_NOT_FOUND', 'Ride not found.');
      if (b.status !== 'REQUESTED' || !b.scheduledAt) return fail(409, 'BOOKING_GONE', 'This ride is no longer available.');
      const t = b.scheduledAt.getTime();
      if (t <= now.getTime() + (p.convertMinutes + 5) * MIN) return fail(409, 'TOO_CLOSE', 'This ride starts too soon to pre-book; it will be offered automatically.');
      if (t >= now.getTime() + p.horizonHours * 3600_000) return fail(409, 'TOO_FAR', 'This ride is too far ahead to pre-book yet.');
      if (await tx.preAssignment.findUnique({ where: { activeBookingId: bookingId } })) return fail(409, 'TAKEN', 'Another driver already took this ride.');

      const driver = await tx.driver.findUnique({ where: { id: driverId }, include: { user: true } });
      if (!driver || !driver.active || !driver.user.active || !canWork(driver)) return fail(409, 'DRIVER_INELIGIBLE', 'Your account can’t take rides right now.');
      const vehicle = await boundVehicle(tx, driverId);
      if (!vehicle || vehicle.vClass !== b.vClass || vehicle.seats < b.passengerCount) return fail(409, 'VEHICLE_INELIGIBLE', 'Your vehicle doesn’t fit this ride.');
      if (await isPairBlocked(driverId, b.passengerId, tx)) return fail(409, 'BOOKING_GONE', 'This ride is no longer available.');
      // Ride-share pair (Task 022): only the host's ride is claimed; the driver must take co-riders
      // and have seats for both bookings.
      const pair = await tx.shareGroup.findFirst({ where: { status: 'MATCHED', OR: [{ activeHostBookingId: bookingId }, { activeGuestBookingId: bookingId }] }, include: { guest: true } });
      if (pair && pair.guestBookingId === bookingId) return fail(409, 'BOOKING_GONE', 'This ride is no longer available.');
      if (pair && (!driver.acceptsShared || vehicle.seats < b.passengerCount + pair.guest.passengerCount)) return fail(409, 'VEHICLE_INELIGIBLE', 'This shared ride needs a driver who takes co-riders and seats for everyone.');

      const mine = await tx.preAssignment.findMany({ where: { driverId, status: 'COMMITTED' }, select: { pickupAt: true } });
      if (mine.length >= p.maxPerDriver) return fail(409, 'LIMIT', `You can hold at most ${p.maxPerDriver} pre-booked rides.`);
      if (mine.some((m) => Math.abs(m.pickupAt.getTime() - t) < p.minGapMinutes * MIN)) return fail(409, 'OVERLAP', 'This ride is too close to another ride you pre-booked.');

      const pa = await tx.preAssignment.create({ data: { bookingId, driverId, vehicleId: vehicle.id, pickupAt: b.scheduledAt, activeBookingId: bookingId } });
      await tx.bookingEvent.create({ data: { bookingId, type: 'PREASSIGNED', actorType: 'DRIVER', actorId: driverId, beforeStatus: 'REQUESTED', afterStatus: 'REQUESTED' } });
      await recordEvent(tx, { eventType: 'preassign.committed', aggregateType: 'preassign', aggregateId: pa.id, aggregateVersion: 1, correlationId: bookingId, payload: { bookingId, driverPseudo: driverPseudo(driverId), minutesAhead: Math.round((t - now.getTime()) / MIN) } });
      await enqueuePassengerDriverNews(tx, bookingId, 'assigned', 'Driver confirmed', `${driver.publicName.split(' ')[0]} will pick you up ${timeLabel(b.scheduledAt)}.`, { k: 'pre.confirmed', p: { driver: driver.publicName.split(' ')[0], whenD: b.scheduledAt.toISOString() } });
      return { ok: true, status: 'COMMITTED' };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return fail(409, 'TAKEN', 'Another driver already took this ride.');
    throw e;
  }
}

export async function releaseScheduled(driverId: string, bookingId: string, now: Date = new Date()): Promise<PAResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const pa = await tx.preAssignment.findUnique({ where: { activeBookingId: bookingId } });
    if (!pa || pa.driverId !== driverId) return fail(404, 'NOT_FOUND', 'You have no pre-booking for this ride.');
    const late = pa.pickupAt.getTime() - now.getTime() < config.dispatch.preassign.lateReleaseMinutes * MIN;
    await endPreAssignmentTx(tx, bookingId, 'RELEASED', late ? 'driver released late' : 'driver released');
    await tx.bookingEvent.create({ data: { bookingId, type: 'PREASSIGN_RELEASED', actorType: 'DRIVER', actorId: driverId, beforeStatus: 'REQUESTED', afterStatus: 'REQUESTED', reason: late ? 'late release' : null } });
    if (late) await staffAlertTx(tx, 'ALERT_PREBOOK_LATE_RELEASE', bookingId, 'driver gave the pre-booking back late');
    // No push to the passenger (operator, 2026-11-22): a new driver is found automatically before pickup.
    return { ok: true, status: late ? 'RELEASED_LATE' : 'RELEASED' };
  });
}

// ---- worker step (runs every dispatch tick, BEFORE scheduled promotion) ----
const COUNTDOWN_MIN = 5; // the last minutes before the driver must be online (operator, 2026-11-22)

export async function runPreassignments(now: Date = new Date()): Promise<{ reminded: number; converted: number; lapsed: number }> {
  const p = config.dispatch.preassign;
  let reminded = 0, converted = 0, lapsed = 0;

  // 1) Driver reminders (operator, 2026-11-22):
  //    a) about an hour before: «Скоро предзаказ» (once);
  //    b) the last 5 minutes before the driver must be online (35 → 30 min before pickup, when the
  //       ride converts): a countdown «⏱ 5:00 … 1:00 — осталось до выхода на линию», one notification
  //       replaced every minute. Not sent to a driver who is already online.
  // 0) Operator 2026-11-24: from an hour before pickup, check every couple of minutes that the driver can
  //    still make it (live position, road time with traffic, ≥ 5 min early). If he cannot, the ride is taken
  //    off him («вы не успеваете на предзаказ») and goes back to the pre-bookings for other drivers; if
  //    nobody takes it, the usual automatic search starts. No position → nothing decided here (the hand-off
  //    at conversion handles a silent phone).
  await checkReach(now);

  const REMIND_AT = p.remindMinutes * MIN, GO_ONLINE_AT = p.convertMinutes * MIN;
  const soon = await prisma.preAssignment.findMany({ where: { status: 'COMMITTED', remindedAt: null, pickupAt: { gt: new Date(now.getTime() + GO_ONLINE_AT + COUNTDOWN_MIN * MIN), lte: new Date(now.getTime() + REMIND_AT) } }, include: { booking: { select: { pickupLabel: true, flightNumber: true } } }, take: 50 });
  for (const r of soon) {
    const upd = await prisma.preAssignment.updateMany({ where: { id: r.id, remindedAt: null, status: 'COMMITTED' }, data: { remindedAt: now } });
    if (upd.count !== 1) continue; // another worker reminded already (fencing)
    await enqueueDriver(prisma, r.driverId, 'Upcoming pre-booked ride', `Pickup ${timeLabel(r.pickupAt)} at ${r.booking.pickupLabel}${r.booking.flightNumber ? ` · flight ${r.booking.flightNumber}` : ''}. Go online in time.`,
      { tag: `pre-${r.bookingId}`, msg: { k: r.booking.flightNumber ? 'drv.preSoonFlight' : 'drv.preSoon', p: { timeT: r.pickupAt.toISOString(), place: r.booking.pickupLabel, flight: r.booking.flightNumber ?? '' } } });
    reminded++;
  }
  const cd = await prisma.preAssignment.findMany({ where: { status: 'COMMITTED', pickupAt: { gt: new Date(now.getTime() + GO_ONLINE_AT), lte: new Date(now.getTime() + GO_ONLINE_AT + COUNTDOWN_MIN * MIN) } }, include: { booking: { select: { pickupLabel: true } }, driver: { select: { onDuty: true } } }, take: 50 });
  for (const r of cd) {
    if (r.driver.onDuty) continue;
    const left = Math.min(COUNTDOWN_MIN, Math.ceil((r.pickupAt.getTime() - GO_ONLINE_AT - now.getTime()) / MIN));
    if (left < 1) continue;
    await prisma.preAssignment.updateMany({ where: { id: r.id, remind35At: null }, data: { remind35At: now } });
    // One per minute (dedupe), same tag → the phone replaces it: a 5-minute countdown.
    await enqueueDriver(prisma, r.driverId, `⏱ ${left}:00`, 'left to go online', { tag: `golive-${r.bookingId}`, dedupeKey: `golive:${r.id}:${left}`, msg: { k: 'drv.goOnline', p: { left, timeT: r.pickupAt.toISOString(), place: r.booking.pickupLabel } } });
    reminded++;
  }

  // 2) Convert (or lapse) commitments inside the conversion window.
  // Launch fixes §8 (ported 2026-11-24): earliest pickup first; one failing ride never stalls the others.
  const window = await prisma.preAssignment.findMany({ where: { status: 'COMMITTED', pickupAt: { lte: new Date(now.getTime() + p.convertMinutes * MIN) } }, select: { bookingId: true }, orderBy: { pickupAt: 'asc' }, take: 25 });
  for (const w of window) {
    try {
      const r = await convertOne(w.bookingId, now);
      if (r === 'converted') converted++;
      if (r === 'lapsed') lapsed++;
    } catch (e) {
      console.error('[preassign] conversion failed', w.bookingId, e instanceof Error ? e.message : e);
    }
  }
  return { reminded, converted, lapsed };
}

/** A driver's phone position older than this is not «live» for a pre-booked hand-off. */
const PREBOOK_GPS_FRESH_SEC = 90;
/** Rough minutes to drive to the pickup: straight line ×1.3 at 45 km/h (no road call under a lock). */
function reachMin(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return (haversineMeters(a, b) * 1.3) / 1000 / 45 * 60;
}

/** Staff alert (launch fixes §8, ported 2026-11-24): an audit row listed on admin «Надёжность»; no passenger data. */
export async function staffAlertTx(tx: Prisma.TransactionClient, action: `ALERT_${string}`, bookingId: string, detail: string): Promise<void> {
  await tx.auditEvent.create({ data: { actorRole: 'SYSTEM', action, target: bookingId, detail: detail.slice(0, 200) } });
}

const lastReach = new Map<string, number>();
const REACH_EVERY_MS = 2 * MIN;
async function checkReach(now: Date): Promise<void> {
  const p = config.dispatch.preassign;
  const due = await prisma.preAssignment.findMany({
    where: { status: 'COMMITTED', pickupAt: { gt: new Date(now.getTime() + p.convertMinutes * MIN), lte: new Date(now.getTime() + p.protectMinutes * MIN) } },
    select: { id: true, bookingId: true, driverId: true, pickupAt: true, booking: { select: { pickupLat: true, pickupLng: true } } }, take: 50,
  });
  for (const pa of due) {
    if (now.getTime() - (lastReach.get(pa.id) ?? 0) < REACH_EVERY_MS) continue;
    lastReach.set(pa.id, now.getTime());
    const need = await reachMinutes(pa.driverId, { lat: pa.booking.pickupLat, lng: pa.booking.pickupLng }, now);
    if (need == null || now.getTime() + (need + PREBOOK_EARLY_MIN) * MIN <= pa.pickupAt.getTime()) continue;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${pa.bookingId} FOR UPDATE`;
      const cur = await tx.preAssignment.findUnique({ where: { activeBookingId: pa.bookingId } });
      if (cur?.id !== pa.id) return; // released / converted meanwhile
      await endPreAssignmentTx(tx, pa.bookingId, 'RELEASED', `cannot make it in time (needs ~${Math.round(need)} min)`,
        { notifyDriver: 'You cannot make it to the pre-booked ride in time — it was taken off you and is back in the pre-bookings.', notifyDriverKey: 'drv.preTooLate' });
      await tx.bookingEvent.create({ data: { bookingId: pa.bookingId, type: 'PREASSIGN_RELEASED', actorType: 'SYSTEM', beforeStatus: 'REQUESTED', afterStatus: 'REQUESTED', reason: 'cannot make it in time' } });
      await staffAlertTx(tx, 'ALERT_PREBOOK_TOO_LATE', pa.bookingId, `driver cannot make it (needs ~${Math.round(need)} min)`);
    });
  }
  if (lastReach.size > 2000) for (const [k, v] of lastReach) if (now.getTime() - v > 3 * 3600_000) lastReach.delete(k);
}

async function convertOne(bookingId: string, now: Date): Promise<'converted' | 'lapsed' | 'waiting' | 'gone'> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const pa = await tx.preAssignment.findUnique({ where: { activeBookingId: bookingId } });
    if (!pa) return 'gone';
    await tx.$executeRaw`SELECT 1 FROM "Driver" WHERE id = ${pa.driverId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b || b.status !== 'REQUESTED') {
      await endPreAssignmentTx(tx, bookingId, 'RELEASED', 'booking no longer awaiting a driver');
      return 'gone';
    }
    const lapse = async (why: string, passengerMsg: string, driverMsg: string, keys: { pax: string; drv: string }) => {
      await endPreAssignmentTx(tx, bookingId, 'LAPSED', why, { notifyDriver: driverMsg, notifyDriverKey: keys.drv });
      await tx.bookingEvent.create({ data: { bookingId, type: 'PREASSIGN_LAPSED', actorType: 'SYSTEM', beforeStatus: 'REQUESTED', afterStatus: 'REQUESTED', reason: why } });
      await staffAlertTx(tx, 'ALERT_PREBOOK_LAPSED', bookingId, why);
      // Always told (operator, 2026-11-22), also on a pre-booking: «the driver did not make it, we assign another».
      await enqueuePassenger(tx, bookingId, 'Finding you a driver', passengerMsg, { msg: { k: keys.pax } });
      return 'lapsed' as const;
    };

    const driver = await tx.driver.findUnique({ where: { id: pa.driverId }, include: { user: true } });
    const vehicle = await tx.vehicle.findUnique({ where: { id: pa.vehicleId } });
    const binding = vehicle ? await tx.driverVehicleBinding.findFirst({ where: { driverId: pa.driverId, vehicleId: vehicle.id, endedAt: null } }) : null;
    if (!driver || !driver.active || !driver.user.active || !canWork(driver) || !vehicle || !vehicle.active || !binding || vehicle.vClass !== b.vClass || vehicle.seats < b.passengerCount) {
      return lapse('driver or vehicle no longer eligible', 'Your confirmed driver is no longer available. We are finding you another driver automatically.', 'Your pre-booked ride was released: your account or vehicle is not eligible right now.', { pax: 'pre.reassign', drv: 'drv.preReleasedIneligible' });
    }
    // Blocked since the claim (a 1-star rating either way): hand it to automatic search.
    if (await isPairBlocked(pa.driverId, b.passengerId, tx)) {
      return lapse('pair blocked by a 1-star rating', 'We are finding you another driver automatically.', 'Your pre-booked ride was released.', { pax: 'pre.reassign', drv: 'drv.preReleased' });
    }
    const busy = !driver.onDuty
      || !!(await tx.assignment.findFirst({ where: { activeDriverId: pa.driverId }, select: { id: true } }))
      || !!(await tx.driverOffer.findFirst({ where: { activeDriverId: pa.driverId }, select: { id: true } }));
    // Launch fixes §8 (ported 2026-11-24): hand the ride over only to a driver whose phone sends a live
    // position and who can still reach the pickup in time (straight line ×1.3 at 45 km/h, +10 min grace).
    // No road call under the row lock. Not ready → wait like a busy driver, then automatic search.
    const loc = busy ? null : await tx.latestDriverLocation.findUnique({ where: { driverId: pa.driverId }, select: { lat: true, lng: true, receivedAt: true } });
    const gpsStale = !busy && (!loc || now.getTime() - loc.receivedAt.getTime() > PREBOOK_GPS_FRESH_SEC * 1000);
    const tooFar = !busy && !gpsStale && !!loc && now.getTime() + reachMin(loc, { lat: b.pickupLat, lng: b.pickupLng }) * MIN > pa.pickupAt.getTime() + 10 * MIN;
    if (busy || gpsStale || tooFar) {
      // Keep trying until the normal scheduled-search lead; then fall back to automatic search.
      // A ride-share pair waits for its driver until pairLapseMinutes, other rides until the normal lead.
      const isPair = !!(await tx.shareGroup.findFirst({ where: { activeHostBookingId: bookingId, status: 'MATCHED' }, select: { id: true } }));
      const cutoff = isPair ? config.share.pairLapseMinutes : config.dispatch.scheduleLeadMinutes;
      if (pa.pickupAt.getTime() - now.getTime() > cutoff * MIN) return 'waiting';
      if (gpsStale) return lapse('no live GPS at conversion', 'Sorry, the driver did not get online in time. We are assigning you another driver now.',
        'Your pre-booked ride was handed to automatic dispatch: no live location from your phone.', { pax: 'pre.lapsedLate', drv: 'drv.preLapsedNoGps' });
      if (tooFar) return lapse('driver too far at conversion', 'Sorry, the driver could not make it in time. We are assigning you another driver now.',
        'Your pre-booked ride was handed to automatic dispatch: you were too far from the pickup to make it in time.', { pax: 'pre.lapsedLate', drv: 'drv.preLapsedFar' });
      return lapse(driver.onDuty ? 'driver busy at conversion' : 'driver offline at conversion',
        'Sorry, the driver did not get online in time. We are assigning you another driver now.',
        driver.onDuty ? 'Your pre-booked ride was handed to automatic dispatch because you were still on another trip.' : 'Your pre-booked ride was handed to automatic dispatch because you were offline.',
        { pax: 'pre.lapsedLate', drv: driver.onDuty ? 'drv.preLapsedBusy' : 'drv.preLapsedOffline' });
    }

    await createAssignment(tx, b, driver, vehicle, 'SYSTEM', 'pre-assignment conversion');
    await stopSearchTx(tx, bookingId);
    const u = await tx.booking.update({ where: { id: bookingId }, data: { status: 'ASSIGNED', revision: { increment: 1 } } });
    await tx.bookingEvent.create({ data: { bookingId, type: 'PREASSIGN_CONVERTED', actorType: 'SYSTEM', beforeStatus: 'REQUESTED', afterStatus: 'ASSIGNED' } });
    await recordEvent(tx, { eventType: 'booking.assigned', aggregateType: 'booking', aggregateId: bookingId, aggregateVersion: u.revision, correlationId: bookingId, payload: { ...bookingEventPayload({ ...b, status: 'ASSIGNED' }), driverPseudo: driverPseudo(pa.driverId), preassigned: true } });
    await endPreAssignmentTx(tx, bookingId, 'CONVERTED', 'converted to assignment');
    await attachMatchedGuestTx(tx, bookingId); // ride-share pair: the co-rider joins the same car
    await enqueuePassengerDriverNews(tx, bookingId, 'assigned', 'Driver assigned', `${driver.publicName.split(' ')[0]} is assigned to your ride — track them live.`, { k: 'pre.assigned', p: { driver: driver.publicName.split(' ')[0] } });
    await enqueueDriver(tx, pa.driverId, 'Pre-booked ride is now active', `Pickup ${timeLabel(pa.pickupAt)} at ${b.pickupLabel}. Head to the pickup in time.`, { tag: `pre-${bookingId}`, msg: { k: 'pre.active', p: { timeT: pa.pickupAt.toISOString(), place: b.pickupLabel } } });
    return 'converted';
  });
}

// Details of one pre-booking for the driver to review (2026-11-13): only a ride on this driver's
// board (available to them, or one they have accepted). Adds the passenger's name, the fare
// breakdown, map points and the trip route (pickup → destination; Google when configured, short
// timeout, else straight-line). Never the passenger's phone.
export async function scheduledRideDetail(bookingId: string, driverId: string, now: Date = new Date()) {
  const board = await scheduledBoard(driverId, now);
  const mine = board.mine.find((i) => i.bookingId === bookingId);
  const item = mine ?? board.available.find((i) => i.bookingId === bookingId);
  if (!item) return null;
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { passengerName: true, fareBreakdown: true, pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true, luggageCount: true },
  });
  if (!b) return null;
  let fareBreakdown: { label: string; cents: number }[] | null = null;
  try {
    const v = b.fareBreakdown ? JSON.parse(b.fareBreakdown) : null;
    if (Array.isArray(v)) fareBreakdown = v.filter((x) => x && typeof x.label === 'string' && typeof x.cents === 'number').map((x) => ({ label: x.label, cents: x.cents }));
  } catch { /* malformed snapshot → none */ }
  const pickup = { lat: b.pickupLat, lng: b.pickupLng, label: item.pickupLabel };
  const dropoff = { lat: b.dropoffLat, lng: b.dropoffLng, label: item.dropoffLabel, postcode: item.dropoffPostcode };
  let trip: { distanceM: number; etaSec: number; path: [number, number][] | null; roadRouted: boolean } = {
    distanceM: Math.round(haversineMeters(pickup, dropoff)), etaSec: 0, path: null, roadRouted: false,
  };
  trip.etaSec = Math.round((trip.distanceM / 1000 / 50) * 3600);
  if (googleConfigured()) {
    try {
      const r = await googleRoute(pickup, dropoff, undefined, { timeoutMs: 2500 });
      if (r) trip = { distanceM: Math.round(r.distanceKm * 1000), etaSec: r.etaMinutes * 60, path: r.path, roadRouted: true };
    } catch { /* keep the estimate */ }
  }
  // Ride-share pair: the whole trip through both passengers' stops, approximate addresses.
  const pair = item.share ? await pairDetail(bookingId) : null;
  if (pair) {
    const first = pair.stops[0];
    const last = pair.stops[pair.stops.length - 1];
    return {
      ...item,
      pickupLabel: approxLabel(item.pickupLabel), dropoffLabel: approxLabel(item.dropoffLabel),
      mine: !!mine,
      conflict: mine ? false : (item as BoardItem).conflict,
      passengerName: b.passengerName,
      luggageCount: b.luggageCount,
      fareBreakdown: null,
      pickup: { lat: first.lat, lng: first.lng, label: first.label },
      dropoff: { lat: last.lat, lng: last.lng, label: last.label, postcode: null },
      trip: { distanceM: Math.round(pair.totals.km * 1000), etaSec: pair.totals.min * 60, path: pair.path, roadRouted: pair.roadRouted },
      pair,
      blocked: mine ? null : board.blocked,
    };
  }
  return {
    ...item,
    mine: !!mine,
    conflict: mine ? false : (item as BoardItem).conflict,
    passengerName: b.passengerName,
    luggageCount: b.luggageCount,
    fareBreakdown,
    pickup, dropoff, trip,
    pair: null,
    blocked: mine ? null : board.blocked,
  };
}
