import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Driver home map (2026-11-12): GET /driver/fleet shows the OTHER on-duty cars (anonymised),
// never the requesting driver's own car, and is driver-only.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => new Headers(),
}));

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createStaffSession } from '@/lib/auth';
import * as driverFleet from '@/app/api/v1/driver/fleet/route';

async function onDutyAt(name: string, lat: number, lng: number) {
  const d = (await prisma.driver.findFirst({ where: { publicName: name } }))!;
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true } });
  const loc = { lat, lng, accuracyM: 10, heading: null, speed: null, sampledAt: new Date(), receivedAt: new Date(), gpsSession: 'fleet-test', sequence: 1 };
  await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: loc, create: { driverId: d.id, ...loc } });
  return d;
}
async function as(login: string) {
  jar.clear();
  await createStaffSession((await prisma.staffUser.findUnique({ where: { login } }))!);
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
});
beforeEach(() => { jar.clear(); });

describe('driver home map fleet', () => {
  it('returns other on-duty cars without the requesting driver, with no identifying fields', async () => {
    await onDutyAt('Andreas', 34.6801, 33.0412);
    await onDutyAt('Maria', 34.9001, 33.6201);
    await as('maria');
    const res = await driverFleet.GET();
    expect(res.status).toBe(200);
    const { vehicles } = (await res.json()) as { vehicles: Record<string, unknown>[] };
    expect(vehicles.some((v) => v.lat === 34.6801 && v.lng === 33.0412)).toBe(true); // Andreas visible
    expect(vehicles.some((v) => v.lat === 34.9001 && v.lng === 33.6201)).toBe(false); // own car excluded
    for (const v of vehicles) expect(Object.keys(v).sort()).toEqual(['lat', 'lng', 'stale', 'state']);
  });

  it('is driver-only', async () => {
    expect((await driverFleet.GET()).status).toBe(401);
    await as('dispatcher');
    expect((await driverFleet.GET()).status).toBe(403);
  });
});
