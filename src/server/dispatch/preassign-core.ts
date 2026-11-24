import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { enqueueDriver } from '@/server/push';
import { recordEvent, driverPseudo } from '@/server/events';
import { haversineMeters } from '@/lib/geo';

type Tx = Prisma.TransactionClient;

// End the live commitment of a booking (if any). Used by driver release, passenger/staff cancel,
// manual assignment and the worker. Notifies the driver unless they are the one releasing.
export async function endPreAssignmentTx(tx: Tx, bookingId: string, status: 'RELEASED' | 'LAPSED' | 'CONVERTED', reason: string, opts: { notifyDriver?: string; notifyDriverKey?: string } = {}): Promise<{ driverId: string; pickupAt: Date } | null> {
  const pa = await tx.preAssignment.findUnique({ where: { activeBookingId: bookingId } });
  if (!pa) return null;
  await tx.preAssignment.update({ where: { id: pa.id }, data: { status, endedAt: new Date(), endReason: reason, activeBookingId: null } });
  await recordEvent(tx, { eventType: `preassign.${status.toLowerCase()}`, aggregateType: 'preassign', aggregateId: pa.id, aggregateVersion: 2, correlationId: bookingId, payload: { bookingId, driverPseudo: driverPseudo(pa.driverId), reason } });
  if (opts.notifyDriver) await enqueueDriver(tx, pa.driverId, 'Pre-booked ride update', opts.notifyDriver, { tag: `pre-${bookingId}`, msg: opts.notifyDriverKey ? { k: opts.notifyDriverKey } : undefined });
  return { driverId: pa.driverId, pickupAt: pa.pickupAt };
}

const MIN = 60_000;

// Drivers within the protection window of a live commitment get no new immediate offers.
export async function protectedDriverIds(now: Date = new Date()): Promise<string[]> {
  const rows = await prisma.preAssignment.findMany({
    where: { status: 'COMMITTED', pickupAt: { lte: new Date(now.getTime() + config.dispatch.preassign.protectMinutes * MIN) } },
    select: { driverId: true },
  });
  return [...new Set(rows.map((r) => r.driverId))];
}

// ---- Getting to a pre-booked pickup in time (operator 2026-11-24) ----
// From PREASSIGN_PROTECT_MINUTES (60) before a ride he pre-booked, a driver gets a new order ONLY if it
// takes him towards that pickup (drops off closer to it than he is now) and he still arrives ≥ 5 min early.
export interface PrebookHold { pickupAt: Date; lat: number; lng: number }
type Pt = { lat: number; lng: number };
const ROUGH_KMH = 40;
/** Rough driving minutes (straight line ×1.3 at 40 km/h) — for screening, never under a long lock. */
export const roughMin = (a: Pt, b: Pt) => (haversineMeters(a, b) * 1.3) / 1000 / ROUGH_KMH * 60;
export const PREBOOK_EARLY_MIN = 5;

export async function prebookHolds(now: Date = new Date()): Promise<Map<string, PrebookHold>> {
  const rows = await prisma.preAssignment.findMany({
    where: { status: 'COMMITTED', pickupAt: { lte: new Date(now.getTime() + config.dispatch.preassign.protectMinutes * MIN) } },
    select: { driverId: true, pickupAt: true, booking: { select: { pickupLat: true, pickupLng: true } } },
    orderBy: { pickupAt: 'asc' },
  });
  const m = new Map<string, PrebookHold>();
  for (const r of rows) if (!m.has(r.driverId)) m.set(r.driverId, { pickupAt: r.pickupAt, lat: r.booking.pickupLat, lng: r.booking.pickupLng });
  return m;
}

/** May a driver holding `hold` take this ride? `approachMin` = his time to the ride's pickup (road if known). */
export function fitsBeforePrebook(hold: PrebookHold, now: Date, driver: Pt, ride: { pickup: Pt; dropoff: Pt }, approachMin?: number): boolean {
  const towards = haversineMeters(ride.dropoff, hold) < haversineMeters(driver, hold);
  if (!towards) return false;
  const total = (approachMin ?? roughMin(driver, ride.pickup)) + roughMin(ride.pickup, ride.dropoff) + 2 + roughMin(ride.dropoff, hold);
  return now.getTime() + (total + PREBOOK_EARLY_MIN) * MIN <= hold.pickupAt.getTime();
}
