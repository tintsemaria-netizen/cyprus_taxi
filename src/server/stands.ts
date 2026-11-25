import { prisma } from '@/lib/db';
import { pointInPolygon } from '@/lib/geo';
import { airportAt } from '@/lib/airports';
import { ensureAirportAreas, taxiStands, type Stand } from '@/server/no-go';

// «Стоянка с очередью» (2026-11-25, operator). A stand is a NoGoZone of kind STAND, drawn in admin
// «Стоянки с очередью», tied to one airport:
//  • switched ON: a driver on duty who drives in gets a place in its queue (by the time he entered). An order
//    from that airport is offered to the queue first, in order; nobody there / all refused → the usual search
//    outside. A refusal or a missed offer keeps his place (he is first again for the next order).
//  • switched OFF: drivers standing in it get no orders at all; the airport's orders go to drivers outside.
// He loses the place 10 s after leaving the stand, when he goes off duty or when he gets a ride.

export const STAND_LEAVE_MS = 10_000;

export const inStand = (p: { lat: number; lng: number }, s: Stand) => s.polygon.length >= 3 && pointInPolygon(p, s.polygon.map(([lat, lng]) => ({ lat, lng })));

export async function standAt(p: { lat: number; lng: number }): Promise<Stand | null> {
  for (const s of await taxiStands()) if (inStand(p, s)) return s;
  return null;
}

/** After every accepted GPS sample: join / keep / lose the place in a stand's queue. Never throws. */
export async function updateStandQueue(driverId: string, p: { lat: number; lng: number }, now = new Date()): Promise<void> {
  try {
    const stand = await standAt(p);
    const entry = await prisma.standQueue.findUnique({ where: { driverId } });
    if (stand?.active) {
      if (entry && entry.standId === stand.id) {
        await prisma.standQueue.updateMany({ where: { driverId, standId: stand.id }, data: { lastInAt: now } });
        return;
      }
      // Only a free driver joins (one bringing a passenger to the airport joins after the drop-off).
      const busy = await prisma.assignment.findFirst({ where: { OR: [{ activeDriverId: driverId }, { queuedDriverId: driverId }] }, select: { id: true } });
      if (busy) { if (entry) await prisma.standQueue.deleteMany({ where: { driverId } }); return; }
      await prisma.standQueue.upsert({ where: { driverId }, create: { driverId, standId: stand.id, enteredAt: now, lastInAt: now }, update: { standId: stand.id, enteredAt: now, lastInAt: now } });
      return;
    }
    if (entry && now.getTime() - entry.lastInAt.getTime() > STAND_LEAVE_MS) await prisma.standQueue.deleteMany({ where: { driverId } });
  } catch { /* the queue never breaks GPS ingestion */ }
}

export async function leaveStandQueue(driverId: string, tx: { standQueue: { deleteMany: typeof prisma.standQueue.deleteMany } } = prisma): Promise<void> {
  await tx.standQueue.deleteMany({ where: { driverId } });
}

/** The switched-on stand(s) whose queue takes an order picked up here (the order's airport), or []. */
export async function standsForPickup(p: { lat: number; lng: number }): Promise<Stand[]> {
  await ensureAirportAreas();
  const code = airportAt(p.lat, p.lng);
  if (!code) return [];
  return (await taxiStands()).filter((s) => s.active && s.airport === code);
}

/** The queue of these stands, first first. Whether each one is still there is checked against his position
 *  by the caller (inside the stand, or left it less than 10 s ago). */
export async function standQueueOrder(standIds: string[]): Promise<{ driverId: string; standId: string; lastInAt: Date }[]> {
  if (!standIds.length) return [];
  return prisma.standQueue.findMany({ where: { standId: { in: standIds } }, orderBy: [{ enteredAt: 'asc' }, { driverId: 'asc' }], select: { driverId: true, standId: true, lastInAt: true } });
}

/** Queue entries with each driver's car class (orders are matched by class, so «cars ahead» counts his class). */
async function queueWithClass(standIds: string[]) {
  const rows = await prisma.standQueue.findMany({ where: { standId: { in: standIds } }, orderBy: [{ enteredAt: 'asc' }, { driverId: 'asc' }] });
  const b = await prisma.driverVehicleBinding.findMany({ where: { driverId: { in: rows.map((r) => r.driverId) }, endedAt: null }, select: { driverId: true, vehicle: { select: { vClass: true } } } });
  const cls = new Map(b.map((x) => [x.driverId, x.vehicle.vClass as string]));
  return rows.map((r) => ({ ...r, vClass: cls.get(r.driverId) ?? 'COMFORT' }));
}

/** Rough wait (minutes) for the n-th car of a class: from the airport's orders of that class in the last 2 hours. */
async function waitMinutes(airport: string | null, vClass: string, nth: number, now = new Date()): Promise<number | null> {
  if (!airport) return null;
  await ensureAirportAreas();
  const since = new Date(now.getTime() - 120 * 60_000);
  const rows = await prisma.booking.findMany({ where: { createdAt: { gte: since }, vClass: vClass as 'COMFORT' | 'XL' }, select: { pickupLat: true, pickupLng: true } });
  const n = rows.filter((r) => airportAt(r.pickupLat, r.pickupLng) === airport).length;
  if (!n) return null;
  return Math.max(1, Math.round((nth * 120) / n));
}

/** Every stand for the drivers' map (2026-11-25, like Bolt's waiting area): its outline, on/off and how many wait. */
export async function standsOverview(): Promise<{ id: string; name: string; polygon: [number, number][]; on: boolean; waiting: number }[]> {
  const stands = await taxiStands();
  if (!stands.length) return [];
  const q = await prisma.standQueue.groupBy({ by: ['standId'], _count: { _all: true } });
  const cnt = new Map(q.map((x) => [x.standId, x._count._all]));
  return stands.map((s) => ({ id: s.id, name: s.name, polygon: s.polygon, on: s.active, waiting: s.active ? cnt.get(s.id) ?? 0 : 0 }));
}

/** For the driver's screen: the stand he is in and his place in its queue. */
export async function standStateFor(driverId: string, p: { lat: number; lng: number } | null): Promise<{ name: string; on: boolean; place: number | null; total: number; polygon: [number, number][]; ahead?: number; vClass?: string; waitMin?: number | null } | null> {
  const entry = await prisma.standQueue.findUnique({ where: { driverId } });
  const stand = entry ? (await taxiStands()).find((s) => s.id === entry.standId) ?? null : p ? await standAt(p) : null;
  if (!stand) return null;
  if (!stand.active || !entry) return { name: stand.name, on: stand.active, place: null, total: 0, polygon: stand.polygon };
  const q = await queueWithClass([stand.id]);
  const i = q.findIndex((r) => r.driverId === driverId), mine = q[i]?.vClass ?? 'COMFORT';
  const ahead = q.slice(0, Math.max(0, i)).filter((r) => r.vClass === mine).length;
  return { name: stand.name, on: true, place: i + 1, total: q.length, polygon: stand.polygon, ahead, vClass: mine, waitMin: await waitMinutes(stand.airport, mine, ahead + 1).catch(() => null) };
}
