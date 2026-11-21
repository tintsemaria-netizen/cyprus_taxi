import { describe, it, expect, beforeAll, vi } from 'vitest';
// Admin per-driver reports (2026-11-20): the admin gets the very same figures the driver sees,
// a driver can't use the admin routes, and an unknown driver is 404.
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
import * as report from '@/app/api/v1/admin/drivers/[id]/report/[part]/route';
import * as figures from '@/app/api/v1/admin/drivers/figures/route';
import * as one from '@/app/api/v1/admin/drivers/[id]/route';
import * as driverDuty from '@/app/api/v1/driver/duty/route';
import * as driverAnalytics from '@/app/api/v1/driver/analytics/route';
import * as driverEarnings from '@/app/api/v1/driver/earnings/route';

const BASE = 'http://localhost:3000/api/v1';
const req = (path: string) => new Request(`${BASE}${path}`, { headers: { 'x-forwarded-for': '198.51.100.7' } });
const p = (id: string, part: string) => ({ params: Promise.resolve({ id, part }) });
async function as(login: string) {
  jar.clear();
  const u = await prisma.staffUser.findUnique({ where: { login } });
  if (!u) throw new Error(`seed user ${login} missing`);
  await createStaffSession(u);
}
const body = async (r: Response) => { const j = await r.json(); return j.data ?? j; };

let driverId = '', driverLogin = '', adminLogin = '';
beforeAll(async () => {
  const d = await prisma.driver.findFirst({ where: { publicName: 'Maria' }, include: { user: true } });
  const a = await prisma.staffUser.findFirst({ where: { role: 'ADMIN', active: true } });
  if (!d || !a) throw new Error('fixtures missing');
  driverId = d.id; driverLogin = d.user.login; adminLogin = a.login;
});

describe('admin per-driver report', () => {
  it('returns the same duty / analytics / earnings figures the driver sees', async () => {
    await as(driverLogin);
    const mine = {
      duty: await body(await driverDuty.GET()),
      an: await body(await driverAnalytics.GET(req('/driver/analytics?period=week'))),
      earn: await body(await driverEarnings.GET(req('/driver/earnings?range=week'))),
    };
    await as(adminLogin);
    const duty = await body(await report.GET(req(`/admin/drivers/${driverId}/report/duty`), p(driverId, 'duty')));
    const an = await body(await report.GET(req(`/admin/drivers/${driverId}/report/analytics?period=week`), p(driverId, 'analytics')));
    const earn = await body(await report.GET(req(`/admin/drivers/${driverId}/report/earnings?range=week`), p(driverId, 'earnings')));
    expect(duty.week).toEqual(mine.duty.week);
    expect(duty.weekKm).toBe(mine.duty.weekKm);
    expect(an.completed).toEqual(mine.an.completed);
    expect(an.missedOffers).toEqual(mine.an.missedOffers);
    expect(earn.summary.byCurrency).toEqual(mine.earn.summary.byCurrency);
    expect(typeof earn.notDone).toBe('number');
    expect(earn.notDone).toBe(mine.earn.notDone);
    const csv = await report.GET(req(`/admin/drivers/${driverId}/report/export?range=week`), p(driverId, 'export'));
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const head = await body(await one.GET(req(`/admin/drivers/${driverId}`), { params: Promise.resolve({ id: driverId }) }));
    expect(head.driver.publicName).toBe('Maria');
    const f = await body(await figures.GET());
    expect(f.figures.some((x: { driverId: string }) => x.driverId === driverId)).toBe(true);
  });

  it('is admin-only and 404s unknown drivers or parts', async () => {
    await as(driverLogin);
    expect((await report.GET(req(`/admin/drivers/${driverId}/report/duty`), p(driverId, 'duty'))).status).toBe(403);
    expect((await figures.GET()).status).toBe(403);
    jar.clear();
    expect((await report.GET(req(`/admin/drivers/${driverId}/report/duty`), p(driverId, 'duty'))).status).toBe(401);
    await as(adminLogin);
    expect((await report.GET(req('/admin/drivers/nope/report/duty'), p('nope', 'duty'))).status).toBe(404);
    expect((await report.GET(req(`/admin/drivers/${driverId}/report/secret`), p(driverId, 'secret'))).status).toBe(404);
  });
});
