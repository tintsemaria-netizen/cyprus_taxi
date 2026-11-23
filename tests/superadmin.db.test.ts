import { describe, it, expect, beforeAll, vi } from 'vitest';

// Superadmin (2026-11-23): only the owner manages staff and sees the change log; every changing
// request by another admin is logged and the owner is notified (once per 2 minutes per admin).
const jar = vi.hoisted(() => new Map<string, string>());
const hdr = vi.hoisted(() => ({ h: new Headers() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => hdr.h,
}));

import { prisma } from '@/lib/db';
import { createStaffSession, verifyPassword } from '@/lib/auth';
import * as staff from '@/app/api/v1/admin/staff/route';
import * as staffOne from '@/app/api/v1/admin/staff/[id]/route';
import * as changes from '@/app/api/v1/admin/changes/route';
import * as changesCount from '@/app/api/v1/admin/changes/count/route';
import * as minFares from '@/app/api/v1/admin/min-fares/route';
import { areaOf } from '@/server/staff-log';

const RUN = Date.now().toString(36);
const req = (body?: unknown, method = 'POST') => new Request('http://localhost:3000/api/v1/admin/staff', { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
async function as(login: string) {
  jar.clear();
  const u = await prisma.staffUser.findUnique({ where: { login } });
  if (!u) throw new Error(`missing ${login}`);
  await createStaffSession(u);
}

beforeAll(async () => {
  await prisma.staffAction.deleteMany({});
  if (!(await prisma.staffUser.count({ where: { login: 'admin', isOwner: true } }))) await prisma.staffUser.update({ where: { login: 'admin' }, data: { isOwner: true } });
});

describe('superadmin', () => {
  let adminLogin = '';
  it('only the owner creates staff; a new admin gets a temporary password', async () => {
    await as('dispatcher');
    expect((await staff.GET()).status).toBe(403);
    await as('admin');
    adminLogin = `adm-${RUN}`;
    const r = await staff.POST(req({ login: adminLogin, displayName: 'Nikos', role: 'ADMIN' }));
    expect(r.status).toBe(201);
    const { temporaryPassword } = await r.json();
    const u = (await prisma.staffUser.findUnique({ where: { login: adminLogin } }))!;
    expect(u.role).toBe('ADMIN');
    expect(u.isOwner).toBe(false);
    expect(await verifyPassword(temporaryPassword, u.passwordHash)).toBe(true);
    expect((await staff.POST(req({ login: adminLogin, displayName: 'X', role: 'ADMIN' }))).status).toBe(409);
    await as(adminLogin);
    expect((await staff.GET()).status).toBe(403); // a normal admin cannot manage staff
    expect((await changes.GET(new Request('http://localhost:3000/api/v1/admin/changes'))).status).toBe(403);
  });

  it('a normal admin\'s change is logged — no push (operator: red section, no sound); the owner\'s own are not', async () => {
    await prisma.notificationOutbox.deleteMany({ where: { tag: 'staff-changes' } });
    await as(adminLogin);
    hdr.h = new Headers({ 'x-ily-mutation': 'POST /api/v1/admin/min-fares' });
    await minFares.POST(new Request('http://localhost:3000/api/v1/admin/min-fares', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    await minFares.POST(new Request('http://localhost:3000/api/v1/admin/min-fares', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    expect(await prisma.staffAction.count({ where: { actorName: 'Nikos' } })).toBe(2);
    const owner = (await prisma.staffUser.findUnique({ where: { login: 'admin' } }))!;
    expect(await prisma.notificationOutbox.count({ where: { audience: `STAFF:${owner.id}` } })).toBe(0);
    // A plain read is not a change; the owner's own changes are not logged.
    hdr.h = new Headers();
    await as(adminLogin);
    await minFares.GET();
    await as('admin');
    hdr.h = new Headers({ 'x-ily-mutation': 'POST /api/v1/admin/min-fares' });
    await minFares.POST(new Request('http://localhost:3000/api/v1/admin/min-fares', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    hdr.h = new Headers();
    expect(await prisma.staffAction.count()).toBe(2);
    const list = await (await changes.GET(new Request('http://localhost:3000/api/v1/admin/changes'))).json();
    expect(list.unread).toBe(2);
    const cnt = await (await changesCount.GET()).json();
    expect(cnt.unread).toBe(2);
    expect(cnt.last).toMatchObject({ actor: 'Nikos' });
    // «Проверено» on one: still red (1 left)
    const one = await (await changes.POST(new Request('http://localhost:3000/api/v1/admin/changes', { method: 'POST', body: JSON.stringify({ id: cnt.last.id }) }))).json();
    expect(one.unread).toBe(1);
    expect(list.actions[0]).toMatchObject({ actor: 'Nikos', area: 'minFares', method: 'POST' });
    await changes.POST();
    expect((await (await changes.GET(new Request('http://localhost:3000/api/v1/admin/changes'))).json()).unread).toBe(0);
    expect((await (await changesCount.GET()).json()).unread).toBe(0);
    await as(adminLogin);
    expect((await changesCount.GET()).status).toBe(403);
  });

  it('switch off signs out; new password; the owner cannot touch himself', async () => {
    await as('admin');
    const u = (await prisma.staffUser.findUnique({ where: { login: adminLogin } }))!;
    const p = (id: string, action: string) => staffOne.PATCH(req({ action }, 'PATCH'), { params: Promise.resolve({ id }) });
    expect((await p(u.id, 'disable')).status).toBe(200);
    const off = (await prisma.staffUser.findUnique({ where: { id: u.id } }))!;
    expect([off.active, off.sessionVersion]).toEqual([false, u.sessionVersion + 1]);
    expect((await p(u.id, 'enable')).status).toBe(200);
    const r = await (await p(u.id, 'resetPassword')).json();
    expect(await verifyPassword(r.temporaryPassword, (await prisma.staffUser.findUnique({ where: { id: u.id } }))!.passwordHash)).toBe(true);
    const owner = (await prisma.staffUser.findUnique({ where: { login: 'admin' } }))!;
    expect((await p(owner.id, 'disable')).status).toBe(409);
  });

  it('areas of paths', () => {
    expect(areaOf('/api/v1/admin/fixed-zones/abc')).toBe('fixedPrices');
    expect(areaOf('/api/v1/admin/drivers/x/report/earnings')).toBe('drivers');
    expect(areaOf('/api/v1/something')).toBe('misc');
  });
});
