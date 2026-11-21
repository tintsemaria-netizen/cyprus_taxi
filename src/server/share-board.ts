// Share board («Табло попутчиков», operator 2026-11-21): pre-booked rides that opted in to a
// co-rider and have no pair yet are listed for other such passengers on the same corridor
// (same pickup place → same drop-off place, same class). A passenger can pick one himself and
// propose to ride together AT THE OTHER PASSENGER'S TIME — he is the one who moves. The other one
// gets the usual co-rider proposal and answers yes / no. Automatic matching keeps running for
// listed rides at the same time.
//
// Listed until SHARE_BOARD_HIDE_HOURS (10 h) before pickup; after that the ride stays a normal
// co-rider pre-booking (the system may still pair it) and goes at full price if nobody is found.
// Privacy: no names, phones or exact addresses — only the district, time, people and bags.
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { approxLegMin, bestPrebookPlan, shareFits, shareZone, sharedCents, type SharePlan } from '@/lib/share';
import { shareCapable, planWithRoads, proposePrebook } from '@/server/share';
import { approxLabel } from '@/server/share-detail';
import { config } from '@/lib/config';

const MIN = 60_000;
const S = () => config.share;
export const BOARD_HIDE_HOURS = config.share.boardHideHours;

const SEL = {
  id: true, passengerId: true, status: true, vClass: true, shareOptIn: true, shareMaxExtraMin: true, fareCents: true, priceType: true,
  passengerCount: true, childCount: true, luggageCount: true, pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true,
  stopLat: true, scheduledAt: true, shareWaitMin: true, shareEarlyMin: true, pickupLabel: true, dropoffLabel: true,
} as const;

/** Open (listable) co-rider pre-bookings: no proposal or pair, no pre-accepted driver, far enough ahead. */
async function openRides(now: Date, where: object = {}) {
  const rows = await prisma.booking.findMany({
    where: {
      status: 'REQUESTED', shareOptIn: true, fareCents: { not: null }, stopLat: null,
      scheduledAt: { gt: new Date(now.getTime() + BOARD_HIDE_HOURS * 3600_000) },
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
// Only the area (town / postcode), never the street: «12 Eleftheria Sq, Nicosia 1011» → «Nicosia 1011».
const district = (label: string) => { const p = approxLabel(label).split(',').map((x) => x.trim()).filter(Boolean); return (p.length > 1 ? p[1] : p[0]) ?? ''; };

export interface BoardRide {
  id: string; mine: boolean; at: string; from: string; to: string; fromArea: string; toArea: string;
  adults: number; children: number; bags: number; early: number; wait: number;
  /** For another passenger's ride: the price of MY matching ride if we pair (and its full price). */
  myBookingId?: string; myFullCents?: number; mySharedCents?: number; myShiftMin?: number;
}
export interface BoardView { hideHours: number; mine: (BoardRide & { waiting: { until: string } | null })[]; others: BoardRide[] }

function view(r: Ride, mine: boolean): BoardRide {
  const z = zones(r);
  return {
    id: r.id, mine, at: r.scheduledAt!.toISOString(), from: z.from, to: z.to,
    fromArea: district(r.pickupLabel), toArea: district(r.dropoffLabel),
    adults: r.passengerCount - r.childCount, children: r.childCount, bags: r.luggageCount,
    early: r.shareEarlyMin ?? 0, wait: r.shareWaitMin ?? 0,
  };
}

/** Who is picked up first and when the car leaves, so that `keep` keeps its booked time. */
function pairAtTheirTime(me: Ride, them: Ride): { host: Ride; guest: Ride; startAt: Date; plan: SharePlan; myShiftMin: number } | null {
  const host = me.scheduledAt!.getTime() <= them.scheduledAt!.getTime() ? me : them;
  const guest = host === me ? them : me;
  const pts = { Hp: { lat: host.pickupLat, lng: host.pickupLng }, Hd: { lat: host.dropoffLat, lng: host.dropoffLng }, Gp: { lat: guest.pickupLat, lng: guest.pickupLng }, Gd: { lat: guest.dropoffLat, lng: guest.dropoffLng } };
  const plan = bestPrebookPlan(pts, approxLegMin, { hostMaxExtra: host.shareMaxExtraMin ?? 15, guestMaxExtra: guest.shareMaxExtraMin ?? 15 });
  if (!plan) return null;
  const leg = plan.arrive.guestPickup;
  const startAt = them === host ? them.scheduledAt! : new Date(them.scheduledAt!.getTime() - leg * MIN);
  const myPickup = me === host ? startAt : new Date(startAt.getTime() + leg * MIN);
  return { host, guest, startAt, plan, myShiftMin: Math.round((myPickup.getTime() - me.scheduledAt!.getTime()) / MIN) };
}

export async function shareBoard(passengerId: string, now: Date = new Date()): Promise<BoardView> {
  const settings = await getSettings();
  const mineAll = await prisma.booking.findMany({
    where: { passengerId, status: 'REQUESTED', shareOptIn: true, scheduledAt: { gt: now } }, orderBy: { scheduledAt: 'asc' }, select: SEL,
  });
  const open = await openRides(now);
  const openIds = new Set(open.map((r) => r.id));
  // My rides waiting for the other passenger's answer (I proposed from the board).
  const pending = await prisma.shareGroup.findMany({
    where: { status: 'PROPOSED', mode: 'PREBOOK', OR: [{ hostBookingId: { in: mineAll.map((r) => r.id) } }, { guestBookingId: { in: mineAll.map((r) => r.id) } }] },
    select: { hostBookingId: true, guestBookingId: true, expiresAt: true, hostAnswer: true, guestAnswer: true },
  });
  const mine = mineAll.filter(shareCapable).filter((r) => openIds.has(r.id) || pending.some((g) => g.hostBookingId === r.id || g.guestBookingId === r.id)).map((r) => {
    const g = pending.find((x) => x.hostBookingId === r.id || x.guestBookingId === r.id);
    const myAnswer = g ? (g.hostBookingId === r.id ? g.hostAnswer : g.guestAnswer) : null;
    return { ...view(r, true), waiting: g && myAnswer === 'YES' ? { until: g.expiresAt.toISOString() } : null };
  });
  // Others are shown against my listed rides — also while I wait for an answer (buttons then wait).
  const mineOpen = mineAll.filter((r) => mine.some((m) => m.id === r.id));
  const others: BoardRide[] = [];
  for (const o of open) {
    if (o.passengerId === passengerId) continue;
    const oz = zones(o);
    // Show it against the first of my open rides it can actually pair with.
    for (const m of mineOpen) {
      const mz = zones(m);
      if (mz.from !== oz.from || mz.to !== oz.to || m.vClass !== o.vClass) continue;
      const seats = settings.classes.find((c) => c.key === m.vClass)?.maxPassengers ?? 4;
      if (!shareFits(m, o, seats, S().luggage[m.vClass])) continue;
      const p = pairAtTheirTime(m, o);
      if (!p || Math.abs(p.myShiftMin) > S().boardMaxShiftMin) continue; // too far apart in time
      others.push({ ...view(o, false), myBookingId: m.id, myFullCents: m.fareCents!, mySharedCents: sharedCents(m.fareCents!, S().discountPct), myShiftMin: p.myShiftMin });
      break;
    }
  }
  return { hideHours: BOARD_HIDE_HOURS, mine, others };
}

export type BoardResult = { ok: true; proposalId: string } | { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): BoardResult => ({ ok: false, status, code, message });

/** «Поехать вместе»: propose a pair at the other passenger's time; my answer counts as «yes». */
export async function proposeFromBoard(passengerId: string, myBookingId: string, otherBookingId: string, now: Date = new Date()): Promise<BoardResult> {
  if (myBookingId === otherBookingId) return fail(422, 'SAME_RIDE', 'Choose another passenger’s ride.');
  const open = await openRides(now, { id: { in: [myBookingId, otherBookingId] } });
  const me = open.find((r) => r.id === myBookingId);
  const them = open.find((r) => r.id === otherBookingId);
  if (!me || me.passengerId !== passengerId) return fail(404, 'NOT_FOUND', 'Your ride is no longer on the board.');
  if (!them || them.passengerId === passengerId) return fail(409, 'GONE', 'This ride is no longer on the board.');
  const mz = zones(me), oz = zones(them);
  if (mz.from !== oz.from || mz.to !== oz.to || me.vClass !== them.vClass) return fail(422, 'NOT_SAME_ROUTE', 'These rides do not go the same way.');
  const settings = await getSettings();
  const seats = settings.classes.find((c) => c.key === me.vClass)?.maxPassengers ?? 4;
  if (!shareFits(me, them, seats, S().luggage[me.vClass])) return fail(422, 'NO_ROOM', 'Everyone would not fit in one car.');
  const declined = await prisma.shareGroup.findFirst({ where: { OR: [{ hostBookingId: me.id, guestBookingId: them.id }, { hostBookingId: them.id, guestBookingId: me.id }], status: 'DECLINED' } });
  if (declined) return fail(409, 'DECLINED_BEFORE', 'This passenger already said no to riding together.');
  // Road times with the traffic expected at that time; the other passenger keeps their time.
  const base = pairAtTheirTime(me, them);
  if (!base) return fail(422, 'TOO_FAR', 'The detour would be longer than you both allow.');
  if (Math.abs(base.myShiftMin) > S().boardMaxShiftMin) return fail(422, 'TOO_FAR_IN_TIME', 'These rides are too far apart in time.');
  const pts = { Hp: { lat: base.host.pickupLat, lng: base.host.pickupLng }, Hd: { lat: base.host.dropoffLat, lng: base.host.dropoffLng }, Gp: { lat: base.guest.pickupLat, lng: base.guest.pickupLng }, Gd: { lat: base.guest.dropoffLat, lng: base.guest.dropoffLng } };
  const { result, routed } = await planWithRoads((leg) => bestPrebookPlan(pts, leg, { hostMaxExtra: base.host.shareMaxExtraMin ?? 15, guestMaxExtra: base.guest.shareMaxExtraMin ?? 15 }), them.scheduledAt);
  const plan = result ?? base.plan;
  const startAt = them === base.host ? them.scheduledAt! : new Date(them.scheduledAt!.getTime() - plan.arrive.guestPickup * MIN);
  const id = await proposePrebook(base.host.id, base.guest.id, plan, startAt, routed && !!result, now, { byBookingId: me.id });
  if (!id) return fail(409, 'BUSY', 'One of the rides already has a proposal — try again later.');
  return { ok: true, proposalId: id };
}
