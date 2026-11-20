import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
// Fleet owner role (2026-11-20): read-only, sees ONLY the drivers & cars the admin put into his fleet.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => new Headers(),
}));
import { prisma } from '@/lib/db';
import { createStaffSession } from '@/lib/auth';
import * as adminFleets from '@/app/api/v1/admin/fleets/route';
import * as adminFleet from '@/app/api/v1/admin/fleets/[id]/route';
import * as adminDriver from '@/app/api/v1/admin/drivers/[id]/route';
import * as adminVehicle from '@/app/api/v1/admin/vehicles/[id]/route';
import * as adminFigures from '@/app/api/v1/admin/drivers/figures/route';
import * as fleetMe from '@/app/api/v1/fleet/me/route';
import * as fleetDrivers from '@/app/api/v1/fleet/drivers/route';
import * as fleetDriver from '@/app/api/v1/fleet/drivers/[id]/route';
import * as fleetReport from '@/app/api/v1/fleet/drivers/[id]/report/[part]/route';
import * as fleetVehicles from '@/app/api/v1/fleet/vehicles/route';

const BASE = 'http://localhost:3000/api/v1';
const req = (path: string, init?: { method?: string; body?: unknown }) => new Request(`${BASE}${path}`, {
  method: init?.method ?? 'GET', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9' },
  body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
});
const P = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const body = async (r: Response) => { const j = await r.json(); return j.data ?? j; };
async function as(login: string) {
  jar.clear();
  const u = await prisma.staffUser.findUnique({ where: { login } });
  if (!u) throw new Error(`user ${login} missing`);
  await createStaffSession(u);
}

const RUN = Date.now().toString(36);
let adminLogin = '', maria = { id: '', login: '' }, andreas = { id: '', login: '' }, fleetId = '', ownerLogin = `owner-${RUN}`;
let mariaCar = '', andreasCar = '';
beforeAll(async () => {
  const a = await prisma.staffUser.findFirst({ where: { role: 'ADMIN', active: true } });
  const m = await prisma.driver.findFirst({ where: { publicName: 'Maria' }, include: { user: true, bindings: { where: { endedAt: null } } } });
  const n = await prisma.driver.findFirst({ where: { publicName: 'Andreas' }, include: { user: true, bindings: { where: { endedAt: null } } } });
  if (!a || !m || !n) throw new Error('fixtures missing');
  adminLogin = a.login; maria = { id: m.id, login: m.user.login }; andreas = { id: n.id, login: n.user.login };
  mariaCar = m.bindings[0]?.vehicleId ?? ''; andreasCar = n.bindings[0]?.vehicleId ?? '';
});
afterAll(async () => {
  // Leave the shared fixtures as they were.
  await prisma.driver.updateMany({ where: { fleetId }, data: { fleetId: null } });
  await prisma.vehicle.updateMany({ where: { fleetId }, data: { fleetId: null } });
});

describe('fleet owner', () => {
  it('admin creates a fleet + owner, puts Maria and her car in; the owner sees only them', async () => {
    await as(adminLogin);
    const c = await adminFleets.POST(req('/admin/fleets', { method: 'POST', body: { name: 'Limassol Cars', login: ownerLogin, displayName: 'Nikos' } }));
    expect(c.status).toBe(201);
    const created = await body(c);
    fleetId = created.id;
    expect(created.temporaryPassword).toBeTruthy();
    expect((await prisma.staffUser.findUnique({ where: { login: ownerLogin } }))?.role).toBe('FLEET_OWNER');
    // Same login twice → conflict.
    expect((await adminFleets.POST(req('/admin/fleets', { method: 'POST', body: { name: 'X', login: ownerLogin, displayName: 'Y' } }))).status).toBe(409);

    expect((await adminDriver.PATCH(req(`/admin/drivers/${maria.id}`, { method: 'PATCH', body: { fleetId } }), P({ id: maria.id }))).status).toBe(200);
    expect((await adminDriver.PATCH(req(`/admin/drivers/${andreas.id}`, { method: 'PATCH', body: { fleetId: 'no-such-fleet' } }), P({ id: andreas.id }))).status).toBe(422);
    if (mariaCar) expect((await adminVehicle.PATCH(req(`/admin/vehicles/${mariaCar}`, { method: 'PATCH', body: { fleetId } }), P({ id: mariaCar }))).status).toBe(200);
    const list = await body(await adminFleets.GET());
    const mine = list.fleets.find((f: { id: string }) => f.id === fleetId);
    expect(mine.drivers).toBe(1);

    await as(ownerLogin);
    const me = await body(await fleetMe.GET());
    expect(me.fleet.name).toBe('Limassol Cars');
    const ds = await body(await fleetDrivers.GET());
    expect(ds.drivers.map((d: { id: string }) => d.id)).toEqual([maria.id]);
    expect(ds.figures.map((f: { driverId: string }) => f.driverId)).toEqual([maria.id]);
    const cars = await body(await fleetVehicles.GET());
    expect(cars.vehicles.every((v: { id: string }) => v.id === mariaCar)).toBe(true);
    expect(cars.vehicles.some((v: { id: string }) => v.id === andreasCar)).toBe(false);

    // His driver: header + every report part.
    expect((await fleetDriver.GET(req(`/fleet/drivers/${maria.id}`), P({ id: maria.id }))).status).toBe(200);
    for (const part of ['earnings', 'duty', 'analytics', 'export']) {
      expect((await fleetReport.GET(req(`/fleet/drivers/${maria.id}/report/${part}`), P({ id: maria.id, part }))).status, part).toBe(200);
    }
    // Not his driver → 404, admin routes → 403.
    expect((await fleetDriver.GET(req(`/fleet/drivers/${andreas.id}`), P({ id: andreas.id }))).status).toBe(404);
    expect((await fleetReport.GET(req(`/fleet/drivers/${andreas.id}/report/duty`), P({ id: andreas.id, part: 'duty' }))).status).toBe(404);
    expect((await adminFigures.GET()).status).toBe(403);
    expect((await adminFleets.GET()).status).toBe(403);
  });

  it('drivers and admins are not fleet owners; switching the fleet off logs the owner out', async () => {
    await as(maria.login);
    expect((await fleetDrivers.GET()).status).toBe(403);
    await as(adminLogin);
    expect((await fleetMe.GET()).status).toBe(403);
    const r = await body(await adminFleet.PATCH(req(`/admin/fleets/${fleetId}`, { method: 'PATCH', body: { resetPassword: true } }), P({ id: fleetId })));
    expect(r.temporaryPassword).toBeTruthy();
    await as(ownerLogin);
    await as(adminLogin);
    expect((await adminFleet.PATCH(req(`/admin/fleets/${fleetId}`, { method: 'PATCH', body: { active: false } }), P({ id: fleetId }))).status).toBe(200);
    jar.clear();
    const u = (await prisma.staffUser.findUnique({ where: { login: ownerLogin } }))!;
    expect(u.active).toBe(false);
    // A fresh session for an inactive owner is refused.
    await createStaffSession(u).catch(() => {});
    expect([401, 403]).toContain((await fleetMe.GET()).status);
  });
});
