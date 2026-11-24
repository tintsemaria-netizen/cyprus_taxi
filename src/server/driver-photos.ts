import { prisma } from '@/lib/db';

// Photos the passenger sees on the driver card (2026-11-24, operator): the driver's selfie and the car
// from the front — the ACCEPTED ones only (a new upload waits for the admin). Being shown to the
// passenger is part of the driver's duties (operator: no separate consent).
// The car photo is shown only when the ride's car is the car of his application (same plate) — after a
// switch to another (e.g. fleet) car the old car's photo would mislead.

const normPlate = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function passengerPhotos(driverId: string, ridePlate: string): Promise<{ driver: string | null; car: string | null }> {
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { applicationId: true } });
  if (!d?.applicationId) return { driver: null, car: null };
  const app = await prisma.driverApplication.findUnique({ where: { id: d.applicationId }, select: { vehicle: true } });
  let appPlate = '';
  try { appPlate = String(JSON.parse(app?.vehicle || '{}').plate || ''); } catch { /* no plate */ }
  const rows = await prisma.applicationDocument.findMany({
    where: { applicationId: d.applicationId, slot: { in: ['selfie', 'vehicle_front'] }, decision: 'ACCEPTED', mime: { startsWith: 'image/' } },
    orderBy: { createdAt: 'desc' }, select: { id: true, slot: true },
  });
  const sameCar = !!appPlate && normPlate(appPlate) === normPlate(ridePlate);
  return {
    driver: rows.find((r) => r.slot === 'selfie')?.id ?? null,
    car: sameCar ? rows.find((r) => r.slot === 'vehicle_front')?.id ?? null : null,
  };
}
