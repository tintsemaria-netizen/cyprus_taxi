import { prisma } from '@/lib/db';
import { pointInPolygon } from '@/lib/geo';
import { airportAreas } from '@/lib/airports';
import { ensureAirportAreas, taxiStands, pickupPoints, type Stand } from '@/server/no-go';
import { takesClasses } from '@/lib/vehicle-class';

// «Стоянка с очередью» (2026-11-25, operator). A stand is a NoGoZone of kind STAND, drawn in admin
// «Стоянки с очередью», tied to one pickup territory («Точки подачи»: an airport, a port …; older stands: an airport):
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

/** Where a stand's orders come from (2026-11-25): the pickup territory chosen for it («Точки подачи» — an airport,
 *  a port …), else (older stands) its airport's territory. Rounded outline, as passengers see it. */
async function sourceArea(s: Stand): Promise<[number, number][] | null> {
  if (s.forZoneId) return (await pickupPoints()).find((t) => t.id === s.forZoneId)?.polygon ?? null;
  if (!s.airport) return null;
  await ensureAirportAreas();
  return airportAreas().find((a) => a.code === s.airport)?.polygon ?? null;
}
const inPoly = (p: { lat: number; lng: number }, poly: [number, number][]) => poly.length >= 3 && pointInPolygon(p, poly.map(([lat, lng]) => ({ lat, lng })));

/** The switched-on stand(s) whose queue takes an order picked up here, or []. */
export async function standsForPickup(p: { lat: number; lng: number }): Promise<Stand[]> {
  const out: Stand[] = [];
  for (const s of await taxiStands()) {
    if (!s.active) continue;
    const area = await sourceArea(s);
    if (area && inPoly(p, area)) out.push(s);
  }
  return out;
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
  const b = await prisma.driverVehicleBinding.findMany({ where: { driverId: { in: rows.map((r) => r.driverId) }, endedAt: null }, select: { driverId: true, driver: { select: { takesComfort: true, takesXl: true } }, vehicle: { select: { vClass: true } } } });
  const cls = new Map(b.map((x) => [x.driverId, { vClass: x.vehicle.vClass as string, takes: takesClasses(x.vehicle.vClass, x.driver.takesComfort, x.driver.takesXl) }]));
  return rows.map((r) => ({ ...r, vClass: cls.get(r.driverId)?.vClass ?? 'COMFORT', takes: cls.get(r.driverId)?.takes ?? ['COMFORT'] }));
}

/** Rough wait (minutes) for the n-th car of a class: from the stand's orders of that class in the last 2 hours. */
async function waitMinutes(stand: Stand, vClass: string, nth: number, now = new Date()): Promise<number | null> {
  const area = await sourceArea(stand);
  if (!area) return null;
  const since = new Date(now.getTime() - 120 * 60_000);
  const rows = await prisma.booking.findMany({ where: { createdAt: { gte: since }, vClass: vClass as 'COMFORT' | 'XL' }, select: { pickupLat: true, pickupLng: true } });
  const n = rows.filter((r) => inPoly({ lat: r.pickupLat, lng: r.pickupLng }, area)).length;
  if (!n) return null;
  return Math.max(1, Math.round((nth * 120) / n));
}

/** For the driver's screen: the stand he is in and his place in its queue. */
export async function standStateFor(driverId: string, p: { lat: number; lng: number } | null): Promise<{ name: string; on: boolean; place: number | null; total: number; polygon: [number, number][]; ahead?: number; vClass?: string; waitMin?: number | null; leaveInMs?: number | null } | null> {
  const entry = await prisma.standQueue.findUnique({ where: { driverId } });
  const stand = entry ? (await taxiStands()).find((s) => s.id === entry.standId) ?? null : p ? await standAt(p) : null;
  if (!stand) return null;
  if (!stand.active || !entry) return { name: stand.name, on: stand.active, place: null, total: 0, polygon: stand.polygon };
  const q = await queueWithClass([stand.id]);
  // «Cars ahead» = those before him who take some of the same orders (an XL car takes Comfort too, 2026-11-25).
  const i = q.findIndex((r) => r.driverId === driverId), mine = q[i]?.vClass ?? 'COMFORT', myTakes = q[i]?.takes ?? ['COMFORT'];
  const ahead = q.slice(0, Math.max(0, i)).filter((r) => r.takes.some((c) => myTakes.includes(c))).length;
  // Drove out (2026-11-27, operator): the place is kept STAND_LEAVE_MS after he was last inside — the driver
  // sees that countdown and can turn back.
  const leaveInMs = p && !inStand(p, stand) ? Math.max(0, STAND_LEAVE_MS - (Date.now() - entry.lastInAt.getTime())) : null;
  return { name: stand.name, on: true, place: i + 1, total: q.length, polygon: stand.polygon, ahead, vClass: mine, waitMin: await waitMinutes(stand, mine, ahead + 1).catch(() => null), leaveInMs };
}
