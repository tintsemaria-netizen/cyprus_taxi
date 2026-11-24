import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { saveDocument, deleteDocumentFile } from '@/server/storage';
import { scanFile } from '@/server/scan';
import { findDuplicateVehicle, normPlate, normVin } from '@/server/vehicle-dupes';

// «Мои машины» (2026-11-24, operator):
//  - a driver works only on a car that is in the system and that he is allowed on;
//  - his own car always (Vehicle.ownerDriverId); a fleet car once the FLEET OWNER says yes; another
//    driver's car once THAT DRIVER and the ADMIN say yes; a car with neither owner nor fleet — the admin;
//  - a new car: details + registration, insurance, taxi licence, front and rear photos (no roadworthiness);
//    the admin compares and approves → a car he owns;
//  - he switches car himself, only offline and with no ride; never onto a car another driver is online in.

export type R<T = unknown> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };
const ok = <T>(data: T): R<T> => ({ ok: true, data });
const no = (status: number, code: string, message: string): R<never> => ({ ok: false, status, code, message });

export const CAR_DOC_SLOTS = ['vehicle_reg', 'insurance', 'taxi_licence', 'vehicle_front', 'vehicle_rear'] as const;
/** The admin types the expiry of these when accepting; an expired one stops the car being chosen. */
export const CAR_EXPIRY_SLOTS = new Set(['insurance', 'taxi_licence']);
const CAR_FIELDS = ['plate', 'vin', 'make', 'model', 'year', 'color', 'seats', 'vClass'] as const;

type Push = { audience: string; title: string; body: string; msg: { k: string; p: Record<string, string | number> }; dedupeKey: string; url?: string };
async function push(p: Push) {
  const { enqueue } = await import('@/server/outbox');
  await enqueue(prisma, { audience: p.audience, title: p.title, body: p.body, url: p.url ?? '/driver', tag: 'cars', dedupeKey: p.dedupeKey, msg: p.msg }).catch((e) => console.error('[cars] push', e));
}
async function pushDriver(driverId: string, p: Omit<Push, 'audience'>) {
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { userId: true } });
  if (d) await push({ ...p, audience: `DRIVER:${d.userId}` });
}
async function pushAdmins(p: Omit<Push, 'audience'>) {
  for (const a of await prisma.staffUser.findMany({ where: { role: 'ADMIN', active: true }, select: { id: true } })) await push({ ...p, audience: `STAFF:${a.id}`, dedupeKey: `${p.dedupeKey}:${a.id}`, url: '/admin/vehicles' });
}

// ---------- Who may use which car ----------

/** Cars this driver may work on: his own, allowed ones, and the one he is on now (cars set up by the admin). */
export async function allowedVehicleIds(driverId: string): Promise<Set<string>> {
  const [own, access, bound] = await Promise.all([
    prisma.vehicle.findMany({ where: { ownerDriverId: driverId }, select: { id: true } }),
    prisma.carAccess.findMany({ where: { driverId, status: 'APPROVED' }, select: { vehicleId: true } }),
    prisma.driverVehicleBinding.findMany({ where: { activeDriverId: driverId }, select: { vehicleId: true } }),
  ]);
  return new Set([...own.map((v) => v.id), ...access.map((a) => a.vehicleId), ...bound.map((b) => b.vehicleId)]);
}

/** An accepted insurance / taxi licence of a car added through «Мои машины» that has expired. */
async function expiredCarDoc(vehicleId: string, now = new Date()): Promise<string | null> {
  const docs = await prisma.carDocument.findMany({ where: { vehicleId, decision: 'ACCEPTED', slot: { in: [...CAR_EXPIRY_SLOTS] } }, orderBy: { createdAt: 'desc' } });
  const seen = new Set<string>();
  for (const d of docs) {
    if (seen.has(d.slot)) continue; // newest per slot
    seen.add(d.slot);
    if (d.expiresAt && d.expiresAt < now) return d.slot;
  }
  return null;
}

export interface MyCar { id: string; plate: string; make: string; model: string; color: string; vClass: string; seats: number; current: boolean; own: boolean; busy: boolean; expired: string | null }

export async function myCars(driverId: string) {
  const ids = await allowedVehicleIds(driverId);
  const vehicles = await prisma.vehicle.findMany({ where: { id: { in: [...ids] }, active: true }, include: { bindings: { where: { endedAt: null }, include: { driver: { select: { id: true, onDuty: true } } } } } });
  const cars: MyCar[] = [];
  for (const v of vehicles) {
    const b = v.bindings[0];
    cars.push({
      id: v.id, plate: v.plate, make: v.make, model: v.model, color: v.color, vClass: v.vClass, seats: v.seats,
      current: b?.driverId === driverId, own: v.ownerDriverId === driverId,
      busy: !!b && b.driverId !== driverId && b.driver.onDuty,
      expired: await expiredCarDoc(v.id),
    });
  }
  cars.sort((a, b) => Number(b.current) - Number(a.current) || a.plate.localeCompare(b.plate));
  const requests = await prisma.carAccess.findMany({ where: { driverId, status: { in: ['PENDING', 'REJECTED'] } }, orderBy: { createdAt: 'desc' }, take: 10 });
  const reqCars = await prisma.vehicle.findMany({ where: { id: { in: requests.map((r) => r.vehicleId) } }, select: { id: true, plate: true, make: true, model: true } });
  const newCars = await prisma.carRequest.findMany({ where: { driverId, status: { in: ['DRAFT', 'SUBMITTED', 'CHANGES', 'REJECTED'] } }, orderBy: { createdAt: 'desc' }, take: 5, include: { documents: true } });
  // Others asking to drive HIS car (he is the owner) — his yes is needed.
  const asks = await prisma.carAccess.findMany({ where: { status: 'PENDING', needOwner: true, ownerOkAt: null, vehicleId: { in: (await prisma.vehicle.findMany({ where: { ownerDriverId: driverId }, select: { id: true } })).map((v) => v.id) } } });
  const askDrivers = await prisma.driver.findMany({ where: { id: { in: asks.map((a) => a.driverId) } }, select: { id: true, publicName: true } });
  const askCars = await prisma.vehicle.findMany({ where: { id: { in: asks.map((a) => a.vehicleId) } }, select: { id: true, plate: true } });
  const me = await prisma.driver.findUnique({ where: { id: driverId }, select: { onDuty: true } });
  const onTrip = !!(await prisma.assignment.findFirst({ where: { activeDriverId: driverId }, select: { id: true } }));
  return {
    online: !!me?.onDuty, onTrip, cars,
    access: requests.map((r) => ({ id: r.id, status: r.status, vehicle: reqCars.find((c) => c.id === r.vehicleId) ?? null, waitingFor: [r.needFleet && !r.fleetOkAt ? 'FLEET' : null, r.needOwner && !r.ownerOkAt ? 'OWNER' : null, r.needAdmin && !r.adminOkAt ? 'ADMIN' : null].filter(Boolean) as string[] })),
    newCars: newCars.map((c) => ({ id: c.id, status: c.status, vehicle: JSON.parse(c.vehicle), note: c.decisionNote, documents: latestDocs(c.documents).map((d) => ({ id: d.id, slot: d.slot, decision: d.decision, note: d.decisionNote })) })),
    asks: asks.map((a) => ({ id: a.id, driverName: askDrivers.find((d) => d.id === a.driverId)?.publicName ?? '', plate: askCars.find((c) => c.id === a.vehicleId)?.plate ?? '' })),
  };
}

function latestDocs<T extends { slot: string; createdAt: Date }>(docs: T[]): T[] {
  const m = new Map<string, T>();
  for (const d of [...docs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) if (!m.has(d.slot)) m.set(d.slot, d);
  return [...m.values()];
}

/** Switch to another allowed car: only offline, no ride, no pre-booking held; never a car someone is online in. */
export async function switchCar(driverId: string, vehicleId: string): Promise<R<{ vehicleId: string }>> {
  if (!(await allowedVehicleIds(driverId)).has(vehicleId)) return no(403, 'CAR_NOT_ALLOWED', 'You are not allowed on this car.');
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { onDuty: true } });
  if (d?.onDuty) return no(409, 'GO_OFFLINE_FIRST', 'Go offline to change the car.');
  if (await prisma.preAssignment.findFirst({ where: { driverId, status: 'COMMITTED' }, select: { id: true } })) return no(409, 'PREBOOK_ON_CAR', 'You have a pre-booking on your current car.');
  const exp = await expiredCarDoc(vehicleId);
  if (exp) return no(409, 'CAR_DOCS_EXPIRED', `This car's ${exp} has expired.`);
  let res: R<{ vehicleId: string }> = ok({ vehicleId });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Driver" WHERE id = ${driverId} FOR UPDATE`;
    await tx.$executeRaw`SELECT 1 FROM "Vehicle" WHERE id = ${vehicleId} FOR UPDATE`;
    const v = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { active: true } });
    if (!v?.active) { res = no(409, 'CAR_INACTIVE', 'This car is switched off.'); return; }
    if (await tx.assignment.findFirst({ where: { OR: [{ activeDriverId: driverId }, { activeVehicleId: vehicleId }] } })) { res = no(409, 'ON_TRIP', 'Finish the ride first.'); return; }
    const other = await tx.driverVehicleBinding.findFirst({ where: { activeVehicleId: vehicleId }, include: { driver: { select: { id: true, onDuty: true } } } });
    if (other && other.driverId === driverId) return; // already on it
    if (other?.driver.onDuty) { res = no(409, 'CAR_IN_USE', 'Another driver is online in this car.'); return; }
    if (other && await tx.preAssignment.findFirst({ where: { vehicleId, status: 'COMMITTED' }, select: { id: true } })) { res = no(409, 'CAR_IN_USE', 'This car is held for another driver’s pre-booking.'); return; }
    await tx.driverVehicleBinding.updateMany({ where: { OR: [{ activeDriverId: driverId }, { activeVehicleId: vehicleId }] }, data: { endedAt: new Date(), activeDriverId: null, activeVehicleId: null } });
    await tx.driverVehicleBinding.create({ data: { driverId, vehicleId, activeDriverId: driverId, activeVehicleId: vehicleId } });
    await tx.auditEvent.create({ data: { actorId: driverId, actorRole: 'DRIVER', action: 'SWITCH_CAR', target: vehicleId } });
  });
  return res;
}

// ---------- Asking for a car that is already in the system ----------

export async function requestAccess(driverId: string, plate: string): Promise<R<{ id: string; waitingFor: string[] }>> {
  const p = normPlate(plate);
  if (!p) return no(422, 'VALIDATION', 'Plate required.');
  const [v] = await prisma.$queryRaw<{ id: string; fleetId: string | null; ownerDriverId: string | null }[]>`
    SELECT id, "fleetId", "ownerDriverId" FROM "Vehicle" WHERE active AND upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g')) = ${p} LIMIT 1`;
  if (!v) return no(404, 'CAR_NOT_IN_SYSTEM', 'This car is not in the system — add it as a new car.');
  if ((await allowedVehicleIds(driverId)).has(v.id)) return no(409, 'CAR_ALREADY_YOURS', 'You can already use this car.');
  const needFleet = !!v.fleetId;
  const needOwner = !needFleet && !!v.ownerDriverId && v.ownerDriverId !== driverId;
  const needAdmin = !needFleet; // a fleet car: the owner alone; otherwise the admin (and the owner driver if any)
  const existing = await prisma.carAccess.findUnique({ where: { driverId_vehicleId: { driverId, vehicleId: v.id } } });
  if (existing?.status === 'PENDING') return ok({ id: existing.id, waitingFor: waiting(existing) });
  const a = existing
    ? await prisma.carAccess.update({ where: { id: existing.id }, data: { status: 'PENDING', needFleet, needOwner, needAdmin, fleetOkAt: null, ownerOkAt: null, adminOkAt: null, decidedAt: null, decidedBy: null, createdAt: new Date() } })
    : await prisma.carAccess.create({ data: { driverId, vehicleId: v.id, needFleet, needOwner, needAdmin } });
  const me = await prisma.driver.findUnique({ where: { id: driverId }, select: { publicName: true } });
  const car = await prisma.vehicle.findUnique({ where: { id: v.id }, select: { plate: true, fleet: { select: { ownerId: true } } } });
  if (needOwner) await pushDriver(v.ownerDriverId!, { title: 'A driver asks for your car', body: `${me?.publicName} asks to drive ${car?.plate}`, msg: { k: 'drv.carAsk', p: { who: me?.publicName ?? '', plate: car?.plate ?? '' } }, dedupeKey: `carask:${a.id}:${a.createdAt.getTime()}` });
  if (needFleet && car?.fleet) await push({ audience: `DRIVER:${car.fleet.ownerId}`, title: 'A driver asks for a fleet car', body: `${me?.publicName} asks to drive ${car.plate}`, url: '/fleet', msg: { k: 'drv.carAsk', p: { who: me?.publicName ?? '', plate: car.plate } }, dedupeKey: `caraskf:${a.id}:${a.createdAt.getTime()}` });
  if (needAdmin) await pushAdmins({ title: 'Car access to approve', body: `${me?.publicName} asks to drive ${car?.plate}`, msg: { k: 'staff.carAsk', p: { who: me?.publicName ?? '', plate: car?.plate ?? '' } }, dedupeKey: `caraska:${a.id}:${a.createdAt.getTime()}` });
  return ok({ id: a.id, waitingFor: waiting(a) });
}

function waiting(a: { needFleet: boolean; fleetOkAt: Date | null; needOwner: boolean; ownerOkAt: Date | null; needAdmin: boolean; adminOkAt: Date | null }): string[] {
  return [a.needFleet && !a.fleetOkAt ? 'FLEET' : null, a.needOwner && !a.ownerOkAt ? 'OWNER' : null, a.needAdmin && !a.adminOkAt ? 'ADMIN' : null].filter(Boolean) as string[];
}

export type Approver = { kind: 'FLEET'; fleetId: string; userId: string } | { kind: 'OWNER'; driverId: string } | { kind: 'ADMIN'; userId: string };

/** One yes / no. A no from anyone closes it; the last needed yes approves it. */
export async function decideAccess(accessId: string, who: Approver, yes: boolean): Promise<R<{ status: string }>> {
  const a = await prisma.carAccess.findUnique({ where: { id: accessId } });
  if (!a || a.status !== 'PENDING') return no(404, 'NOT_FOUND', 'No such request.');
  const v = await prisma.vehicle.findUnique({ where: { id: a.vehicleId }, select: { fleetId: true, ownerDriverId: true, plate: true } });
  if (!v) return no(404, 'NOT_FOUND', 'No such car.');
  const field = who.kind === 'FLEET' ? 'fleetOkAt' : who.kind === 'OWNER' ? 'ownerOkAt' : 'adminOkAt';
  if (who.kind === 'FLEET' && (!a.needFleet || v.fleetId !== who.fleetId)) return no(403, 'FORBIDDEN', 'Not your fleet’s car.');
  if (who.kind === 'OWNER' && (!a.needOwner || v.ownerDriverId !== who.driverId)) return no(403, 'FORBIDDEN', 'Not your car.');
  if (who.kind === 'ADMIN' && !a.needAdmin) return no(403, 'FORBIDDEN', 'The admin is not asked here.');
  const by = who.kind === 'OWNER' ? who.driverId : who.userId;
  if (!yes) {
    await prisma.carAccess.update({ where: { id: a.id }, data: { status: 'REJECTED', decidedAt: new Date(), decidedBy: `${who.kind}:${by}` } });
    await pushDriver(a.driverId, { title: 'Car not allowed', body: `You were not allowed on ${v.plate}.`, msg: { k: 'drv.carNo', p: { plate: v.plate } }, dedupeKey: `carno:${a.id}:${Date.now()}` });
    return ok({ status: 'REJECTED' });
  }
  const upd = await prisma.carAccess.update({ where: { id: a.id }, data: { [field]: new Date() } });
  const done = waiting(upd).length === 0;
  if (done) {
    await prisma.carAccess.update({ where: { id: a.id }, data: { status: 'APPROVED', decidedAt: new Date(), decidedBy: `${who.kind}:${by}` } });
    await pushDriver(a.driverId, { title: 'Car allowed', body: `You may now drive ${v.plate}: menu → My cars.`, msg: { k: 'drv.carOk', p: { plate: v.plate } }, dedupeKey: `carok:${a.id}` });
  }
  return ok({ status: done ? 'APPROVED' : 'PENDING' });
}

/** An owner (or the admin) takes the permission back; never while that driver is on it. */
export async function revokeAccess(accessId: string, who: Approver): Promise<R<{ status: string }>> {
  const a = await prisma.carAccess.findUnique({ where: { id: accessId } });
  if (!a || a.status !== 'APPROVED') return no(404, 'NOT_FOUND', 'No such permission.');
  const v = await prisma.vehicle.findUnique({ where: { id: a.vehicleId }, select: { fleetId: true, ownerDriverId: true } });
  const allowed = who.kind === 'ADMIN' || (who.kind === 'FLEET' && v?.fleetId === who.fleetId) || (who.kind === 'OWNER' && v?.ownerDriverId === who.driverId);
  if (!allowed) return no(403, 'FORBIDDEN', 'Not yours.');
  if (await prisma.driverVehicleBinding.findFirst({ where: { activeDriverId: a.driverId, activeVehicleId: a.vehicleId } })) return no(409, 'CAR_IN_USE', 'The driver is on this car now.');
  await prisma.carAccess.update({ where: { id: a.id }, data: { status: 'REVOKED', decidedAt: new Date() } });
  return ok({ status: 'REVOKED' });
}

// ---------- A new car ----------

export async function createCarRequest(driverId: string, vehicle: Record<string, unknown>): Promise<R<{ id: string }>> {
  const ve: Record<string, string> = {};
  for (const f of CAR_FIELDS) ve[f] = String(vehicle[f] ?? '').trim().slice(0, 60);
  const missing = CAR_FIELDS.filter((f) => !ve[f]);
  if (missing.length) return no(422, 'VALIDATION', `Missing: ${missing.join(', ')}`);
  if (!['COMFORT', 'XL'].includes(ve.vClass)) return no(422, 'VALIDATION', 'Class: COMFORT or XL.');
  const seats = Number(ve.seats);
  if (!Number.isInteger(seats) || seats < 1 || seats > 16) return no(422, 'VALIDATION', 'Seats 1–16.');
  ve.vin = normVin(ve.vin);
  if (await findDuplicateVehicle(ve)) return no(409, 'DUPLICATE_VEHICLE', 'This car is already registered.');
  if (await otherCarRequest(ve, null)) return no(409, 'DUPLICATE_VEHICLE', 'This car is already being added.');
  if (await prisma.carRequest.count({ where: { driverId, status: { in: ['DRAFT', 'SUBMITTED', 'CHANGES'] } } }) >= 3) return no(409, 'TOO_MANY', 'Finish the cars you already started.');
  const r = await prisma.carRequest.create({ data: { driverId, vehicle: JSON.stringify(ve) } });
  return ok({ id: r.id });
}

async function otherCarRequest(ve: Record<string, unknown>, exceptId: string | null): Promise<boolean> {
  const open = await prisma.carRequest.findMany({ where: { status: { in: ['DRAFT', 'SUBMITTED', 'CHANGES'] }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { vehicle: true } });
  return open.some((o) => { const x = JSON.parse(o.vehicle); return normPlate(x.plate) === normPlate(ve.plate) || (!!normVin(ve.vin) && normVin(x.vin) === normVin(ve.vin)); });
}

async function ownRequest(driverId: string, requestId: string) {
  const r = await prisma.carRequest.findUnique({ where: { id: requestId } });
  return r && r.driverId === driverId ? r : null;
}

export async function uploadCarDoc(driverId: string, requestId: string, slot: string, buf: Buffer): Promise<R<{ id: string; scanStatus: string }>> {
  if (!(CAR_DOC_SLOTS as readonly string[]).includes(slot)) return no(422, 'BAD_SLOT', 'Unknown document.');
  const r = await ownRequest(driverId, requestId);
  if (!r || !['DRAFT', 'CHANGES'].includes(r.status)) return no(409, 'NOT_EDITABLE', 'This car can’t be changed now.');
  const scanStatus = await scanFile(buf);
  if (scanStatus === 'INFECTED') return no(422, 'INFECTED', 'This file failed a malware scan and was rejected.');
  const id = randomUUID();
  const stored = await saveDocument(`cars/${r.id}`, id, buf);
  if ('error' in stored) return no(422, 'BAD_FILE', stored.error);
  const old = await prisma.carDocument.findMany({ where: { requestId: r.id, slot, decision: { not: 'ACCEPTED' } } });
  await prisma.carDocument.create({ data: { id, requestId: r.id, slot, storageKey: stored.storageKey, mime: stored.mime, sizeBytes: stored.sizeBytes, sha256: stored.sha256, scanStatus } });
  for (const o of old) { await prisma.carDocument.delete({ where: { id: o.id } }); await deleteDocumentFile(o.storageKey); }
  return ok({ id, scanStatus });
}

export async function submitCarRequest(driverId: string, requestId: string): Promise<R<{ status: string }>> {
  const r = await ownRequest(driverId, requestId);
  if (!r || !['DRAFT', 'CHANGES'].includes(r.status)) return no(409, 'NOT_EDITABLE', 'Already sent.');
  const docs = latestDocs(await prisma.carDocument.findMany({ where: { requestId: r.id } }));
  const missing = CAR_DOC_SLOTS.filter((s) => !docs.some((d) => d.slot === s && d.decision !== 'CHANGES'));
  if (missing.length) return no(422, 'INCOMPLETE', `Missing: ${missing.join(', ')}`);
  await prisma.carRequest.update({ where: { id: r.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
  const ve = JSON.parse(r.vehicle);
  const me = await prisma.driver.findUnique({ where: { id: driverId }, select: { publicName: true } });
  await pushAdmins({ title: 'New car to check', body: `${me?.publicName}: ${ve.plate} ${ve.make} ${ve.model}`, msg: { k: 'staff.carNew', p: { who: me?.publicName ?? '', plate: ve.plate } }, dedupeKey: `carnew:${r.id}:${Date.now()}` });
  return ok({ status: 'SUBMITTED' });
}

export async function decideCarDoc(docId: string, decision: 'ACCEPTED' | 'CHANGES', note: string | undefined, expiresAt: string | undefined): Promise<R<{ decision: string }>> {
  const d = await prisma.carDocument.findUnique({ where: { id: docId }, include: { request: true } });
  if (!d?.request || d.request.status !== 'SUBMITTED') return no(409, 'BAD_STATE', 'Not under review.');
  if (decision === 'ACCEPTED') {
    if (d.scanStatus !== 'CLEAN') return no(422, 'DOC_NOT_SCANNED', 'Only a file that passed the malware scan can be accepted.');
    const exp = expiresAt ? new Date(expiresAt) : null;
    if (CAR_EXPIRY_SLOTS.has(d.slot) && (!exp || Number.isNaN(exp.getTime()) || exp <= new Date())) return no(422, 'EXPIRY_REQUIRED', 'Enter a future expiry date.');
    await prisma.carDocument.update({ where: { id: d.id }, data: { decision, decisionNote: null, expiresAt: exp && !Number.isNaN(exp.getTime()) ? exp : null } });
  } else {
    if (!note || note.trim().length < 3) return no(422, 'VALIDATION', 'Say what to change.');
    await prisma.carDocument.update({ where: { id: d.id }, data: { decision, decisionNote: note.trim().slice(0, 500) } });
  }
  return ok({ decision });
}

/** The admin: approve (every document accepted and clean) → his car; or send back with a note; or refuse. */
export async function decideCarRequest(requestId: string, adminId: string, action: 'APPROVE' | 'RETURN' | 'REJECT', note?: string): Promise<R<{ status: string; vehicleId?: string }>> {
  const r = await prisma.carRequest.findUnique({ where: { id: requestId }, include: { documents: true } });
  if (!r || r.status !== 'SUBMITTED') return no(409, 'BAD_STATE', 'Not under review.');
  const ve = JSON.parse(r.vehicle);
  if (action !== 'APPROVE') {
    if (!note || note.trim().length < 3) return no(422, 'VALIDATION', 'Say why.');
    const status = action === 'RETURN' ? 'CHANGES' : 'REJECTED';
    await prisma.carRequest.update({ where: { id: r.id }, data: { status, decisionNote: note.trim().slice(0, 500), decidedAt: new Date() } });
    await pushDriver(r.driverId, { title: action === 'RETURN' ? 'Your car: changes needed' : 'Your car was not approved', body: `${ve.plate}: ${note.trim().slice(0, 120)}`, msg: { k: action === 'RETURN' ? 'drv.carReturned' : 'drv.carRefused', p: { plate: ve.plate } }, dedupeKey: `carret:${r.id}:${Date.now()}` });
    return ok({ status });
  }
  const docs = latestDocs(r.documents);
  if (CAR_DOC_SLOTS.some((s) => !docs.some((d) => d.slot === s && d.decision === 'ACCEPTED' && d.scanStatus === 'CLEAN'))) return no(422, 'DOCS_NOT_ACCEPTED', 'Accept every document first.');
  if (await findDuplicateVehicle(ve)) return no(409, 'DUPLICATE_VEHICLE', 'This car is already registered.');
  const vehicle = await prisma.$transaction(async (tx) => {
    const v = await tx.vehicle.create({ data: { plate: ve.plate, vin: normVin(ve.vin) || null, make: ve.make, model: ve.model, color: ve.color || 'Unknown', vClass: ve.vClass, seats: Number(ve.seats), active: true, ownerDriverId: r.driverId } });
    await tx.carDocument.updateMany({ where: { id: { in: docs.map((d) => d.id) } }, data: { vehicleId: v.id } });
    await tx.carRequest.update({ where: { id: r.id }, data: { status: 'APPROVED', vehicleId: v.id, decidedAt: new Date(), decisionNote: null } });
    await tx.carAccess.upsert({ where: { driverId_vehicleId: { driverId: r.driverId, vehicleId: v.id } }, update: { status: 'APPROVED', decidedAt: new Date(), decidedBy: `ADMIN:${adminId}` }, create: { driverId: r.driverId, vehicleId: v.id, status: 'APPROVED', decidedAt: new Date(), decidedBy: `ADMIN:${adminId}` } });
    await tx.auditEvent.create({ data: { actorId: adminId, actorRole: 'ADMIN', action: 'APPROVE_CAR', target: v.id } });
    return v;
  });
  await pushDriver(r.driverId, { title: 'Your car is approved', body: `${ve.plate} is in your cars: menu → My cars.`, msg: { k: 'drv.carApproved', p: { plate: ve.plate } }, dedupeKey: `carapp:${r.id}` });
  return ok({ status: 'APPROVED', vehicleId: vehicle.id });
}

// ---------- Lists for the people who decide ----------

/** What the admin decides: access to cars that need him, and new cars to check. */
export async function adminCarQueue() {
  const access = await prisma.carAccess.findMany({ where: { status: 'PENDING', needAdmin: true, adminOkAt: null }, orderBy: { createdAt: 'asc' } });
  const requests = await prisma.carRequest.findMany({ where: { status: 'SUBMITTED' }, orderBy: { submittedAt: 'asc' } });
  const drivers = await prisma.driver.findMany({ where: { id: { in: [...access.map((a) => a.driverId), ...requests.map((r) => r.driverId)] } }, select: { id: true, publicName: true } });
  const cars = await prisma.vehicle.findMany({ where: { id: { in: access.map((a) => a.vehicleId) } }, select: { id: true, plate: true, make: true, model: true, ownerDriverId: true } });
  const owners = await prisma.driver.findMany({ where: { id: { in: cars.map((c) => c.ownerDriverId!).filter(Boolean) } }, select: { id: true, publicName: true } });
  const name = (id: string | null) => drivers.find((d) => d.id === id)?.publicName ?? owners.find((d) => d.id === id)?.publicName ?? '';
  return {
    access: access.map((a) => { const c = cars.find((x) => x.id === a.vehicleId); return { id: a.id, driverName: name(a.driverId), plate: c?.plate ?? '', car: c ? `${c.make} ${c.model}` : '', ownerName: c?.ownerDriverId ? name(c.ownerDriverId) : null, ownerOk: !a.needOwner || !!a.ownerOkAt }; }),
    requests: requests.map((r) => ({ id: r.id, driverName: name(r.driverId), vehicle: JSON.parse(r.vehicle), submittedAt: r.submittedAt?.toISOString() ?? null })),
  };
}

export async function fleetCarQueue(fleetId: string) {
  const cars = await prisma.vehicle.findMany({ where: { fleetId }, select: { id: true, plate: true } });
  const access = await prisma.carAccess.findMany({ where: { status: 'PENDING', needFleet: true, fleetOkAt: null, vehicleId: { in: cars.map((c) => c.id) } }, orderBy: { createdAt: 'asc' } });
  const drivers = await prisma.driver.findMany({ where: { id: { in: access.map((a) => a.driverId) } }, select: { id: true, publicName: true } });
  return access.map((a) => ({ id: a.id, driverName: drivers.find((d) => d.id === a.driverId)?.publicName ?? '', plate: cars.find((c) => c.id === a.vehicleId)?.plate ?? '' }));
}

/** For a document file: the driver who owns the request, or an admin. */
export async function carDocFor(docId: string) {
  return prisma.carDocument.findUnique({ where: { id: docId }, include: { request: { select: { driverId: true } } } });
}

export async function adminCarRequest(requestId: string) {
  const r = await prisma.carRequest.findUnique({ where: { id: requestId }, include: { documents: true } });
  if (!r) return null;
  const d = await prisma.driver.findUnique({ where: { id: r.driverId }, select: { publicName: true, phone: true } });
  const ve = JSON.parse(r.vehicle);
  return {
    id: r.id, status: r.status, driverName: d?.publicName ?? '', vehicle: ve, note: r.decisionNote,
    duplicate: r.status === 'SUBMITTED' ? await findDuplicateVehicle(ve) : null,
    documents: latestDocs(r.documents).map((x) => ({ id: x.id, slot: x.slot, decision: x.decision, decisionNote: x.decisionNote, mime: x.mime, scanStatus: x.scanStatus, expiresAt: x.expiresAt?.toISOString() ?? null })),
  };
}
