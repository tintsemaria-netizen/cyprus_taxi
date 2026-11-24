import { prisma } from '@/lib/db';

// One car, one registration (2026-11-24, operator): a car (same plate or same VIN) can't be registered a
// second time — not by another applicant, not as a second vehicle in admin. «KXY 248», «kxy-248» and
// «KXY248» are the same plate. Two drivers can't be online in one car either: a car has at most one
// active driver binding (DB unique `activeVehicleId`), and one Vehicle row per real car keeps that true.

export const normPlate = (p: unknown) => String(p ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const normVin = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export type Duplicate = { by: 'plate' | 'vin'; where: 'vehicle' | 'application'; plate: string };

/** An existing car or another live application with this plate / VIN. */
export async function findDuplicateVehicle(car: { plate?: unknown; vin?: unknown }, opts: { exceptApplicationId?: string; exceptVehicleId?: string } = {}): Promise<Duplicate | null> {
  const plate = normPlate(car.plate);
  const vin = normVin(car.vin);
  if (!plate && !vin) return null;
  const vehicles = await prisma.$queryRaw<{ id: string; plate: string; vin: string | null }[]>`
    SELECT id, plate, vin FROM "Vehicle"
    WHERE (${plate} <> '' AND upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g')) = ${plate})
       OR (${vin} <> '' AND vin = ${vin})`;
  // His own car (an approved driver's application created it) is not a duplicate.
  let ownVehicleIds = new Set<string>();
  if (opts.exceptApplicationId) {
    const d = await prisma.driver.findFirst({ where: { applicationId: opts.exceptApplicationId }, select: { bindings: { select: { vehicleId: true } } } });
    ownVehicleIds = new Set(d?.bindings.map((b) => b.vehicleId) ?? []);
  }
  const v = vehicles.find((x) => x.id !== opts.exceptVehicleId && !ownVehicleIds.has(x.id));
  if (v) return { by: plate && normPlate(v.plate) === plate ? 'plate' : 'vin', where: 'vehicle', plate: v.plate };

  const apps = await prisma.driverApplication.findMany({
    where: { status: { in: ['SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'] }, ...(opts.exceptApplicationId ? { id: { not: opts.exceptApplicationId } } : {}) },
    select: { vehicle: true },
  });
  for (const a of apps) {
    let ve: Record<string, unknown> = {};
    try { ve = a.vehicle ? JSON.parse(a.vehicle) : {}; } catch { continue; }
    if (plate && normPlate(ve.plate) === plate) return { by: 'plate', where: 'application', plate: String(ve.plate) };
    if (vin && normVin(ve.vin) === vin) return { by: 'vin', where: 'application', plate: String(ve.plate ?? '') };
  }
  return null;
}
