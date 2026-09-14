import { prisma } from '@/lib/db';
import { resolveFinal } from './earnings';
import { currentSettlement, settlementHistory } from './settlement';

// Driver trip history (Task 017 §4). Scoped strictly to the signed-in driver's OWN assignments.
// A driver reassigned away before pickup sees the trip only as RELEASED — never the later passenger
// movements, chat, or the final driver earnings that another driver produced. Passenger phone is
// NEVER exposed in history lists.

export interface TripCard {
  bookingId: string;
  reference: string;
  at: string; // the driver's assignment time (anchor)
  pickupLabel: string;
  dropoffLabel: string;
  vClass: string;
  passengerCount: number;
  driverStatus: 'COMPLETED' | 'IN_PROGRESS' | 'ASSIGNED' | 'EN_ROUTE' | 'ARRIVED' | 'RELEASED';
  fare: { label: 'Final' | 'Estimate' | 'Pending' | '—'; cents: number | null; currency: string };
  payment: 'received' | 'pending' | null;
}

function driverStatus(reason: string | null, endedAt: Date | null, bookingStatus: string): TripCard['driverStatus'] {
  if (!endedAt) {
    if (bookingStatus === 'IN_PROGRESS') return 'IN_PROGRESS';
    if (['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(bookingStatus)) return bookingStatus as TripCard['driverStatus'];
    return 'ASSIGNED';
  }
  if (reason === 'completed') return 'COMPLETED';
  return 'RELEASED';
}

export async function listDriverTrips(driverId: string, opts: { from?: Date; to?: Date; limit?: number; cursor?: string }): Promise<{ items: TripCard[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const where = { driverId, ...(opts.from && opts.to ? { assignedAt: { gte: opts.from, lt: opts.to } } : {}) };
  const rows = await prisma.assignment.findMany({
    where,
    orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true, assignedAt: true, endedAt: true, reason: true, bookingId: true,
      booking: { select: { reference: true, status: true, pickupLabel: true, dropoffLabel: true, vClass: true, passengerCount: true, fareCents: true, fare: { select: { finalCents: true, currency: true, paymentStatus: true } } } },
    },
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const settle = await settlementsFor(page.filter((r) => r.reason === 'completed').map((r) => r.bookingId));

  const items: TripCard[] = page.map((r) => {
    const ds = driverStatus(r.reason, r.endedAt, r.booking.status);
    let fare: TripCard['fare'] = { label: '—', cents: null, currency: r.booking.fare?.currency ?? 'EUR' };
    let payment: TripCard['payment'] = null;
    if (ds === 'COMPLETED') {
      const rf = resolveFinal(r.booking.fare, settle.get(r.bookingId) ?? null);
      if (rf.finalCents != null) { fare = { label: 'Final', cents: rf.finalCents, currency: rf.currency }; payment = rf.collected ? 'received' : 'pending'; }
      else fare = { label: 'Pending', cents: null, currency: rf.currency };
    } else if (['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(ds)) {
      fare = { label: 'Estimate', cents: r.booking.fareCents ?? null, currency: r.booking.fare?.currency ?? 'EUR' };
    }
    return {
      bookingId: r.bookingId, reference: r.booking.reference, at: r.assignedAt.toISOString(),
      pickupLabel: r.booking.pickupLabel, dropoffLabel: r.booking.dropoffLabel,
      vClass: r.booking.vClass, passengerCount: r.booking.passengerCount, driverStatus: ds, fare, payment,
    };
  });
  return { items, nextCursor: hasMore ? page[page.length - 1].id : null };
}

async function settlementsFor(bookingIds: string[]) {
  const m = new Map<string, { reportedFinalCents: number; currency: string; paymentReceived: boolean }>();
  if (!bookingIds.length) return m;
  const rows = await prisma.driverSettlement.findMany({ where: { bookingId: { in: bookingIds } }, orderBy: { revision: 'asc' }, select: { bookingId: true, reportedFinalCents: true, currency: true, paymentReceived: true } });
  for (const r of rows) m.set(r.bookingId, r);
  return m;
}

export interface TripDetail extends TripCard {
  timestamps: { assignedAt: string; endedAt: string | null };
  fareBreakdown: unknown | null;
  releaseReason: string | null;
  settlement: { current: unknown | null; history: unknown[] } | null;
  canResume: boolean;
  canSettle: boolean;
}

export async function driverTripDetail(driverId: string, bookingId: string): Promise<TripDetail | null> {
  // Authorize by the driver's OWN assignment (most recent for this booking).
  const asg = await prisma.assignment.findFirst({
    where: { driverId, bookingId }, orderBy: { assignedAt: 'desc' },
    select: { id: true, assignedAt: true, endedAt: true, reason: true, booking: { select: { reference: true, status: true, pickupLabel: true, dropoffLabel: true, vClass: true, passengerCount: true, fareCents: true, fareBreakdown: true, fare: { select: { finalCents: true, currency: true, paymentStatus: true } } } } },
  });
  if (!asg) return null;
  const ds = driverStatus(asg.reason, asg.endedAt, asg.booking.status);
  const completed = ds === 'COMPLETED';
  const active = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(ds);

  let fare: TripCard['fare'] = { label: '—', cents: null, currency: asg.booking.fare?.currency ?? 'EUR' };
  let payment: TripCard['payment'] = null;
  const settle = completed ? await currentSettlement(bookingId) : null;
  if (completed) {
    const rf = resolveFinal(asg.booking.fare, settle ? { reportedFinalCents: settle.reportedFinalCents, currency: settle.currency, paymentReceived: settle.paymentReceived } : null);
    if (rf.finalCents != null) { fare = { label: 'Final', cents: rf.finalCents, currency: rf.currency }; payment = rf.collected ? 'received' : 'pending'; }
    else fare = { label: 'Pending', cents: null, currency: rf.currency };
  } else if (active) {
    fare = { label: 'Estimate', cents: asg.booking.fareCents ?? null, currency: asg.booking.fare?.currency ?? 'EUR' };
  }

  // Upfront prices are fixed and cannot be settled by the driver.
  const canSettle = completed && asg.booking.fare?.finalCents == null; // regulated meter → driver settles

  return {
    bookingId, reference: asg.booking.reference, at: asg.assignedAt.toISOString(),
    pickupLabel: asg.booking.pickupLabel, dropoffLabel: asg.booking.dropoffLabel,
    vClass: asg.booking.vClass, passengerCount: asg.booking.passengerCount, driverStatus: ds, fare, payment,
    timestamps: { assignedAt: asg.assignedAt.toISOString(), endedAt: asg.endedAt?.toISOString() ?? null },
    fareBreakdown: completed && asg.booking.fareBreakdown ? safeParse(asg.booking.fareBreakdown) : null,
    releaseReason: ds === 'RELEASED' ? (asg.reason ?? null) : null,
    settlement: completed ? { current: settle, history: await settlementHistory(bookingId) } : null,
    canResume: active,
    canSettle,
  };
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
