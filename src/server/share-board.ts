// Co-rider picked in the hour list (operator 2026-11-25; the «Табло попутчиков» page was removed the same day):
// open co-rider pre-bookings with no pair yet, and «Ехать» with one of them — proposed AT THE OTHER PASSENGER'S
// time with the same road-time check as the hour list. The other passenger answers yes / no as before.
// Automatic matching keeps running for all open rides.
import { prisma } from '@/lib/db';
import { ensureAirportAreas } from '@/server/no-go';
import { getSettings } from '@/lib/settings';
import { approxLegMin, arrivalFits, shareFits, shareZone, type LegFn } from '@/lib/share';
import { shareCapable, planWithRoads, proposePrebook, fitPair, BOARD_REACH_MIN } from '@/server/share';
import { config } from '@/lib/config';

const MIN = 60_000;
const S = () => config.share;

const SEL = {
  id: true, passengerId: true, status: true, vClass: true, shareOptIn: true, shareMaxExtraMin: true, fareCents: true, priceType: true,
  passengerCount: true, childCount: true, luggageCount: true, pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true,
  stopLat: true, scheduledAt: true, shareWaitMin: true, shareEarlyMin: true, pickupLabel: true, dropoffLabel: true, arriveFrom: true, arriveBy: true, shareTermsVersion: true, sharePickupFrom: true, sharePickupTo: true,
} as const;

/** Open co-rider pre-bookings: no proposal or pair, no pre-accepted driver, at least the pre-booking minimum ahead. */
export async function openRides(now: Date, where: object = {}) {
  const hideMin = (await getSettings()).scheduleMinMinutes;
  const rows = await prisma.booking.findMany({
    where: {
      status: 'REQUESTED', shareOptIn: true, fareCents: { not: null }, stopLat: null,
      scheduledAt: { gt: new Date(now.getTime() + hideMin * MIN) },
      preAssignments: { none: { status: 'COMMITTED' } },
      shareAsHost: { none: { activeHostBookingId: { not: null } } }, shareAsGuest: { none: { activeGuestBookingId: { not: null } } },
      ...where,
    },
    orderBy: { scheduledAt: 'asc' }, take: 200, select: SEL,
  });
  return rows.filter(shareCapable);
}
type Ride = Awaited<ReturnType<typeof openRides>>[number];
const zones = (r: Ride) => ({ from: shareZone({ lat: r.pickupLat, lng: r.pickupLng })!, to: shareZone({ lat: r.dropoffLat, lng: r.dropoffLng })! });

/**
 * The pair as both passengers agreed to ride (TZ «Попутчик −30%» 2026-11-23): the same planner as the
 * automatic search — each keeps their own pickup interval, extra-minutes limit and arrival window; nobody is
 * moved to the other's time. `myShiftMin` = my pickup minus my booked time (negative = earlier).
 */
function boardPair(me: Ride, them: Ride, leg: LegFn = approxLegMin) {
  // Operator 2026-11-23: the one who taps «Ехать вместе» adapts to the other's time (up to BOARD_REACH_MIN
  // outside their own window); the other keeps their window. The whole route is computed first.
  const f = fitPair(me, them, leg, 0, me.id);
  if (!f) return null;
  const start = f.timing.startAt.getTime();
  const isHost = f.host.id === me.id;
  const myPickup = isHost ? start : start + f.plan.arrive.guestPickup * MIN;
  const myArrive = new Date(start + (isHost ? f.plan.arrive.host : f.plan.arrive.guest) * MIN);
  const myOutside = !!(me.arriveFrom && me.arriveBy) && !arrivalFits(me, myArrive);
  return { ...f, myShiftMin: Math.round((myPickup - me.scheduledAt!.getTime()) / MIN), myArrive, myOutside };
}
/** Arrival windows within BOARD_REACH_MIN of each other (no windows: pickup times within that). */
function near(a: Ride, b: Ride): boolean {
  const R = BOARD_REACH_MIN * MIN;
  if (a.arriveFrom && a.arriveBy && b.arriveFrom && b.arriveBy) return b.arriveFrom.getTime() <= a.arriveBy.getTime() + R && b.arriveBy.getTime() >= a.arriveFrom.getTime() - R;
  return Math.abs(a.scheduledAt!.getTime() - b.scheduledAt!.getTime()) <= R + 60 * MIN;
}

/** A driver (same phone as a driver account) does not ride as a passenger co-rider (operator question 2026-11-22). */
async function isDriverPassenger(passengerId: string): Promise<boolean> {
  const p = await prisma.passenger.findUnique({ where: { id: passengerId }, select: { phone: true } });
  if (!p?.phone) return false;
  return !!(await prisma.driver.findFirst({ where: { phone: p.phone }, select: { id: true } }));
}

export type BoardResult = { ok: true; proposalId: string; arriveAt: string } | { ok: false; status: number; code: string; message: string; arriveAt?: string };
const fail = (status: number, code: string, message: string): BoardResult => ({ ok: false, status, code, message });

/** «Ехать» with an order from the hour list: propose a pair at the other passenger's time; my answer counts as «yes». */
export async function proposeFromBoard(passengerId: string, myBookingId: string, otherBookingId: string, now: Date = new Date(), confirmOutside = false): Promise<BoardResult> {
  await ensureAirportAreas(); // the airport = a territory marked «это аэропорт» (2026-11-25)
  if (myBookingId === otherBookingId) return fail(422, 'SAME_RIDE', 'Choose another passenger’s ride.');
  const open = await openRides(now, { id: { in: [myBookingId, otherBookingId] } });
  const me = open.find((r) => r.id === myBookingId);
  const them = open.find((r) => r.id === otherBookingId);
  if (await isDriverPassenger(passengerId)) return fail(403, 'DRIVER_ACCOUNT', 'Co-rider rides are for passengers.');
  if (!me || me.passengerId !== passengerId) return fail(404, 'NOT_FOUND', 'Your ride is no longer open for a co-rider.');
  if (!them || them.passengerId === passengerId) return fail(409, 'GONE', 'This ride is no longer open for a co-rider.');
  const mz = zones(me), oz = zones(them);
  if (mz.from !== oz.from || mz.to !== oz.to || me.vClass !== them.vClass) return fail(422, 'NOT_SAME_ROUTE', 'These rides do not go the same way.');
  const settings = await getSettings();
  const seats = settings.classes.find((c) => c.key === me.vClass)?.maxPassengers ?? 4;
  if (!shareFits(me, them, seats, S().luggage[me.vClass])) return fail(422, 'NO_ROOM', 'Everyone would not fit in one car.');
  const declined = await prisma.shareGroup.findFirst({ where: { OR: [{ hostBookingId: me.id, guestBookingId: them.id }, { hostBookingId: them.id, guestBookingId: me.id }], status: 'DECLINED' } });
  if (declined) return fail(409, 'DECLINED_BEFORE', 'This passenger already said no to riding together.');
  // Same terms as the automatic search, then road times with the traffic expected at that time.
  if (!near(me, them) || !boardPair(me, them)) return fail(422, 'TOO_FAR', 'The times or the detour do not fit.');
  const { result: p, routed } = await planWithRoads((leg) => boardPair(me, them, leg), me.scheduledAt);
  if (!p) return fail(422, 'TOO_FAR', 'The times or the detour do not fit.');
  // Arriving outside my own window: only after I confirmed it (operator 2026-11-23).
  if (p.myOutside && !confirmOutside) return { ok: false, status: 409, code: 'OUTSIDE_WINDOW', message: 'You would arrive outside your window.', arriveAt: p.myArrive.toISOString() };
  const id = await proposePrebook(p.host.id, p.guest.id, p.plan, p.timing.startAt, routed, now, { byBookingId: me.id }, p.timing);
  if (!id) return fail(409, 'BUSY', 'One of the rides already has a proposal — try again later.');
  if (p.myOutside && me.arriveFrom && me.arriveBy) {
    // He agreed to the new time: his window now covers it, so later checks do not flag his own choice.
    const at = p.myArrive.getTime();
    await prisma.booking.update({ where: { id: me.id }, data: { arriveFrom: new Date(Math.min(me.arriveFrom.getTime(), at - 10 * MIN)), arriveBy: new Date(Math.max(me.arriveBy.getTime(), at + 10 * MIN)) } });
  }
  return { ok: true, proposalId: id, arriveAt: p.myArrive.toISOString() };
}
