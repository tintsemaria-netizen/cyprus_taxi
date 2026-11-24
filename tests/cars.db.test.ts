import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { switchCar, requestAccess, decideAccess, myCars, createCarRequest, uploadCarDoc, submitCarRequest, decideCarDoc, decideCarRequest, adminCarQueue, fleetCarQueue, revokeAccess } from '@/server/cars';

// «Мои машины» (2026-11-24, operator).
const T = 'carsT';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');

async function cleanup() {
  const users = await prisma.staffUser.findMany({ where: { login: { startsWith: T } }, select: { id: true } });
  const drivers = await prisma.driver.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { id: true } });
  const dIds = drivers.map((d) => d.id);
  const vehicles = await prisma.vehicle.findMany({ where: { plate: { startsWith: 'CT' } }, select: { id: true } });
  const vIds = vehicles.map((v) => v.id);
  await prisma.carAccess.deleteMany({ where: { OR: [{ driverId: { in: dIds } }, { vehicleId: { in: vIds } }] } });
  const reqs = await prisma.carRequest.findMany({ where: { driverId: { in: dIds } }, select: { id: true } });
  await prisma.carDocument.deleteMany({ where: { OR: [{ requestId: { in: reqs.map((r) => r.id) } }, { vehicleId: { in: vIds } }] } });
  await prisma.carRequest.deleteMany({ where: { driverId: { in: dIds } } });
  await prisma.auditEvent.deleteMany({ where: { action: 'SWITCH_CAR', actorId: { in: dIds } } });
  await prisma.driverVehicleBinding.deleteMany({ where: { OR: [{ driverId: { in: dIds } }, { vehicleId: { in: vIds } }] } });
  await prisma.fleet.deleteMany({ where: { ownerId: { in: users.map((u) => u.id) } } });
  await prisma.driver.deleteMany({ where: { id: { in: dIds } } });
  await prisma.vehicle.deleteMany({ where: { id: { in: vIds } } });
  await prisma.staffUser.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  // Its pushes too: ~570 left PENDING piled up and pushed other files' notifications out of a drain batch (2026-11-25).
  await prisma.notificationOutbox.deleteMany({ where: { tag: 'cars' } });
}

async function driver(n: string) {
  const u = await prisma.staffUser.create({ data: { login: `${T}${n}`, passwordHash: 'x', role: 'DRIVER', displayName: n } });
  return prisma.driver.create({ data: { userId: u.id, publicName: n, phone: '+35799000000' } });
}
async function car(plate: string, data: { ownerDriverId?: string; fleetId?: string } = {}) {
  return prisma.vehicle.create({ data: { plate, make: 'Toyota', model: 'Prius', color: 'White', vClass: 'COMFORT', seats: 4, ...data } });
}
async function bind(driverId: string, vehicleId: string) {
  return prisma.driverVehicleBinding.create({ data: { driverId, vehicleId, activeDriverId: driverId, activeVehicleId: vehicleId } });
}

beforeAll(cleanup);
afterAll(cleanup);

describe('«Мои машины»', () => {
  it('another driver’s car: his yes AND the admin’s; then switching only offline, never onto a car someone is online in', async () => {
    const a = await driver('A'); const b = await driver('B');
    const carA = await car('CT-100', { ownerDriverId: a.id }); await bind(a.id, carA.id);
    const carB = await car('CT-200', { ownerDriverId: b.id }); await bind(b.id, carB.id);

    // B can't take A's car without permission.
    expect((await switchCar(b.id, carA.id)).ok).toBe(false);
    const r = await requestAccess(b.id, 'ct 100');
    expect(r.ok && r.data.waitingFor.sort()).toEqual(['ADMIN', 'OWNER']);
    if (!r.ok) return;
    expect((await myCars(a.id)).asks.map((x) => x.driverName)).toEqual(['B']);
    expect((await adminCarQueue()).access.some((x) => x.id === r.data.id)).toBe(true);
    expect((await decideAccess(r.data.id, { kind: 'OWNER', driverId: b.id }, true)).ok).toBe(false); // not his car
    expect((await decideAccess(r.data.id, { kind: 'OWNER', driverId: a.id }, true)).ok && 'PENDING').toBe('PENDING');
    const done = await decideAccess(r.data.id, { kind: 'ADMIN', userId: 'admin' }, true);
    expect(done.ok && done.data.status).toBe('APPROVED');

    // A is online in his car → B can't switch onto it.
    await prisma.driver.update({ where: { id: a.id }, data: { onDuty: true } });
    const busy = await switchCar(b.id, carA.id);
    expect(busy.ok ? null : busy.code).toBe('CAR_IN_USE');
    // B online himself → must go offline first.
    await prisma.driver.update({ where: { id: a.id }, data: { onDuty: false } });
    await prisma.driver.update({ where: { id: b.id }, data: { onDuty: true } });
    const online = await switchCar(b.id, carA.id);
    expect(online.ok ? null : online.code).toBe('GO_OFFLINE_FIRST');
    await prisma.driver.update({ where: { id: b.id }, data: { onDuty: false } });
    // Both offline → B takes the car; A has no car until he picks one; the car has one driver.
    expect((await switchCar(b.id, carA.id)).ok).toBe(true);
    expect(await prisma.driverVehicleBinding.count({ where: { activeVehicleId: carA.id } })).toBe(1);
    expect((await prisma.driverVehicleBinding.findFirst({ where: { activeVehicleId: carA.id } }))!.driverId).toBe(b.id);
    expect(await prisma.driverVehicleBinding.count({ where: { activeDriverId: a.id } })).toBe(0);
    // A goes back to his own car (his car, always allowed) — B is offline, so it works.
    expect((await switchCar(a.id, carA.id)).ok).toBe(true);
    // The owner takes the permission back.
    const acc = (await prisma.carAccess.findFirst({ where: { driverId: b.id, vehicleId: carA.id } }))!;
    expect((await revokeAccess(acc.id, { kind: 'OWNER', driverId: a.id })).ok).toBe(true);
    expect((await switchCar(b.id, carA.id)).ok).toBe(false);
  });

  it('a fleet car: only the fleet owner decides; a no closes it', async () => {
    const o = await driver('O'); const c = await driver('C');
    const ownerUser = await prisma.driver.findUnique({ where: { id: o.id }, select: { userId: true } });
    const fleet = await prisma.fleet.create({ data: { name: 'CT fleet', ownerId: ownerUser!.userId } });
    const fc = await car('CT-300', { fleetId: fleet.id });
    const r = await requestAccess(c.id, 'CT300');
    expect(r.ok && r.data.waitingFor).toEqual(['FLEET']);
    if (!r.ok) return;
    expect((await fleetCarQueue(fleet.id)).map((x) => x.plate)).toEqual(['CT-300']);
    expect((await decideAccess(r.data.id, { kind: 'ADMIN', userId: 'admin' }, true)).ok).toBe(false); // the admin isn't asked
    expect((await decideAccess(r.data.id, { kind: 'FLEET', fleetId: fleet.id, userId: 'o' }, false)).ok).toBe(true);
    expect((await prisma.carAccess.findUnique({ where: { id: r.data.id } }))!.status).toBe('REJECTED');
    // Asking again reopens it; a yes allows the car.
    const r2 = await requestAccess(c.id, 'CT-300');
    expect(r2.ok).toBe(true);
    if (r2.ok) expect((await decideAccess(r2.data.id, { kind: 'FLEET', fleetId: fleet.id, userId: 'o' }, true)).ok).toBe(true);
    expect((await switchCar(c.id, fc.id)).ok).toBe(true);
    // A car that isn't in the system.
    const none = await requestAccess(c.id, 'NOPE-1');
    expect(none.ok ? null : none.code).toBe('CAR_NOT_IN_SYSTEM');
  });

  it('a new car: details, five documents (no roadworthiness), the admin accepts with dates and approves → his own car', async () => {
    const d = await driver('N');
    const dup = await car('CT-400');
    const bad = await createCarRequest(d.id, { plate: 'ct 400', vin: 'X1', make: 'VW', model: 'Golf', year: '2020', color: 'Blue', seats: '4', vClass: 'COMFORT' });
    expect(bad.ok ? null : bad.code).toBe('DUPLICATE_VEHICLE');
    const r = await createCarRequest(d.id, { plate: 'CT-401', vin: 'wvw 123', make: 'VW', model: 'Golf', year: '2020', color: 'Blue', seats: '4', vClass: 'COMFORT' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await submitCarRequest(d.id, r.data.id)).ok).toBe(false); // nothing uploaded yet
    const ids: Record<string, string> = {};
    for (const s of ['vehicle_reg', 'insurance', 'taxi_licence', 'vehicle_front', 'vehicle_rear']) {
      const u = await uploadCarDoc(d.id, r.data.id, s, PNG);
      expect(u.ok).toBe(true);
      if (u.ok) ids[s] = u.data.id;
    }
    expect((await uploadCarDoc(d.id, r.data.id, 'roadworthiness', PNG)).ok).toBe(false);
    expect((await submitCarRequest(d.id, r.data.id)).ok).toBe(true);
    expect((await adminCarQueue()).requests.some((x) => x.id === r.data.id)).toBe(true);
    expect((await decideCarRequest(r.data.id, 'admin', 'APPROVE')).ok).toBe(false); // documents not accepted
    await prisma.carDocument.updateMany({ where: { requestId: r.data.id }, data: { scanStatus: 'CLEAN' } });
    const future = new Date(Date.now() + 300 * 86_400_000).toISOString();
    expect((await decideCarDoc(ids.insurance, 'ACCEPTED', undefined, undefined)).ok).toBe(false); // needs a date
    for (const [s, id] of Object.entries(ids)) expect((await decideCarDoc(id, 'ACCEPTED', undefined, ['insurance', 'taxi_licence'].includes(s) ? future : undefined)).ok).toBe(true);
    const ok = await decideCarRequest(r.data.id, 'admin', 'APPROVE');
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const v = (await prisma.vehicle.findUnique({ where: { id: ok.data.vehicleId! } }))!;
    expect(v).toMatchObject({ plate: 'CT-401', vin: 'WVW123', ownerDriverId: d.id });
    expect((await myCars(d.id)).cars.map((c) => c.plate)).toEqual(['CT-401']);
    expect((await switchCar(d.id, v.id)).ok).toBe(true);
    // An expired insurance stops the car being chosen.
    await prisma.carDocument.updateMany({ where: { vehicleId: v.id, slot: 'insurance' }, data: { expiresAt: new Date(Date.now() - 86_400_000) } });
    await prisma.driverVehicleBinding.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeDriverId: null, activeVehicleId: null } });
    const exp = await switchCar(d.id, v.id);
    expect(exp.ok ? null : exp.code).toBe('CAR_DOCS_EXPIRED');
    void dup;
  });

  it('an added car’s documents: pushes at 7 and 1 day, expired → offline and not chosen; a new upload keeps it working; accept → old one gone', async () => {
    const { runCarDocExpiry, docAttention } = await import('@/server/doc-renewal');
    const { uploadCarRenewal, expiredCarDoc, myCars } = await import('@/server/cars');
    const { passengerPhotos } = await import('@/server/driver-photos');
    const d = await driver('R');
    const v = await car('CT-500', { ownerDriverId: d.id });
    await bind(d.id, v.id);
    const exp = new Date(Date.now() + 10 * 86_400_000);
    const doc = await prisma.carDocument.create({ data: { vehicleId: v.id, slot: 'insurance', storageKey: 'x/ct500.png', mime: 'image/png', sizeBytes: 1, sha256: 'h', scanStatus: 'CLEAN', decision: 'ACCEPTED', expiresAt: exp } });
    const front = await prisma.carDocument.create({ data: { vehicleId: v.id, slot: 'vehicle_front', storageKey: 'x/ct500f.png', mime: 'image/png', sizeBytes: 1, sha256: 'h', scanStatus: 'CLEAN', decision: 'ACCEPTED' } });
    expect((await passengerPhotos(d.id, 'ct 500')).car).toBe(front.id); // the passenger sees this car's photo
    const pushes = (k: string) => prisma.notificationOutbox.count({ where: { msg: { path: ['k'], equals: k }, dedupeKey: { contains: doc.id } } });
    await runCarDocExpiry(new Date(exp.getTime() - 6 * 86_400_000)); await runCarDocExpiry(new Date(exp.getTime() - 5 * 86_400_000));
    expect(await pushes('drv.carDocExpiring')).toBe(1);
    await runCarDocExpiry(new Date(exp.getTime() - 0.5 * 86_400_000));
    expect(await pushes('drv.carDocExpiring')).toBe(2);
    await prisma.carDocument.update({ where: { id: doc.id }, data: { expiresAt: new Date(Date.now() + 5 * 86_400_000) } });
    expect((await myCars(d.id)).cars[0].docs.find((x) => x.slot === 'insurance')!.soon).toBe(true);
    // Expired while online, no ride → offline; can't be chosen; the admin sees it in «Машины».
    await prisma.carDocument.update({ where: { id: doc.id }, data: { expiresAt: new Date(Date.now() - 3_600_000) } });
    await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true } });
    await runCarDocExpiry();
    expect((await prisma.driver.findUnique({ where: { id: d.id } }))!.onDuty).toBe(false);
    expect(await pushes('drv.carDocExpired')).toBe(1);
    expect(await expiredCarDoc(v.id)).toBe('insurance');
    expect((await docAttention()).find((a) => a.vehicleId === v.id)).toMatchObject({ section: 'vehicles', kind: 'EXPIRED', slot: 'insurance' });
    // He uploads the new insurance → the car works again at once (option «б»).
    const up = await uploadCarRenewal(d.id, v.id, 'insurance', PNG);
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    expect(await expiredCarDoc(v.id)).toBeNull();
    expect((await docAttention()).find((a) => a.vehicleId === v.id)).toMatchObject({ kind: 'UPLOADED', href: `/admin/vehicles/${v.id}/documents#doc-${up.data.id}` });
    expect((await uploadCarRenewal((await driver('X')).id, v.id, 'insurance', PNG)).ok).toBe(false); // not his car
    await prisma.carDocument.update({ where: { id: up.data.id }, data: { scanStatus: 'CLEAN' } });
    expect((await decideCarDoc(up.data.id, 'ACCEPTED', undefined, new Date(Date.now() + 365 * 86_400_000).toISOString())).ok).toBe(true);
    expect(await prisma.carDocument.count({ where: { vehicleId: v.id, slot: 'insurance' } })).toBe(1);
    expect((await docAttention()).find((a) => a.vehicleId === v.id)).toBeUndefined();
  });

  it('the owner sees who may drive his car and takes it back', async () => {
    const o = await driver('P'); const g = await driver('Q');
    const v = await car('CT-600', { ownerDriverId: o.id });
    const r = await requestAccess(g.id, 'CT-600');
    if (!r.ok) throw new Error('ask');
    await decideAccess(r.data.id, { kind: 'OWNER', driverId: o.id }, true);
    await decideAccess(r.data.id, { kind: 'ADMIN', userId: 'admin' }, true);
    expect((await myCars(o.id)).granted.map((x) => [x.driverName, x.plate])).toEqual([['Q', 'CT-600']]);
    expect((await revokeAccess(r.data.id, { kind: 'OWNER', driverId: g.id })).ok).toBe(false); // only the owner
    expect((await revokeAccess(r.data.id, { kind: 'OWNER', driverId: o.id })).ok).toBe(true);
    expect((await myCars(o.id)).granted).toEqual([]);
    void v;
  });
});
