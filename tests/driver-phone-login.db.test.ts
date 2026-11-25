import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Operator 2026-11-25:
//  1) «Я уже водитель → Получить код» with the number of an unfinished application opens that application,
//     an unknown number gets «не зарегистрирован» (translated), never an English «NOT_A_DRIVER».
//  2) A driver signing in to the passenger app with the same number gets his name / e-mail from the driver
//     account; a passenger never gets into the driver app.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => new Headers(),
}));
vi.mock('@/server/sms', async (orig) => ({ ...(await orig<typeof import('@/server/sms')>()), checkOtp: async () => true }));

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import * as driverVerify from '@/app/api/v1/driver/otp/verify/route';
import * as paxVerify from '@/app/api/v1/passenger/otp/verify/route';
import { getApplicant } from '@/server/applicant';

let n = 0;
const phoneOf = () => `+35799${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
const call = async (route: typeof driverVerify, phone: string) => {
  const r = await route.POST(new Request('http://x', { method: 'POST', headers: { 'x-forwarded-for': `10.9.${n++ % 250}.1` }, body: JSON.stringify({ phone, code: '123456' }) }));
  return { status: r.status, body: await r.json() };
};
async function driverWith(phone: string, name: string, email?: string) {
  const user = await prisma.staffUser.create({ data: { login: phone, passwordHash: 'x', role: 'DRIVER', displayName: name } });
  await prisma.driver.create({ data: { userId: user.id, publicName: name, phone } });
  if (email) await prisma.driverApplicant.create({ data: { phone, legalName: name, email } });
  return user;
}

beforeAll(() => { if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`); });
beforeEach(() => jar.clear());

describe('driver sign-in by phone', () => {
  it('an unfinished application opens (applicant session), no error', async () => {
    const phone = phoneOf();
    await prisma.driverApplicant.create({ data: { phone, application: { create: {} } } });
    const r = await call(driverVerify, phone);
    expect(r.status).toBe(200);
    expect(r.body.data?.application ?? r.body.application).toBe(true);
    expect((await getApplicant())?.phone).toBe(phone);
  });

  it('an unknown number → NOT_REGISTERED; a switched-off driver → DRIVER_DISABLED', async () => {
    const unknown = await call(driverVerify, phoneOf());
    expect(unknown.status).toBe(403);
    expect(unknown.body.error?.code ?? unknown.body.code).toBe('NOT_REGISTERED');
    const phone = phoneOf();
    const u = await driverWith(phone, 'Off Driver');
    await prisma.staffUser.update({ where: { id: u.id }, data: { active: false } });
    const r = await call(driverVerify, phone);
    expect(r.status).toBe(403);
    expect(r.body.error?.code ?? r.body.code).toBe('DRIVER_DISABLED');
  });

  it('a passenger number never gets into the driver app', async () => {
    const phone = phoneOf();
    await prisma.passenger.create({ data: { phone, name: 'Pax' } });
    const r = await call(driverVerify, phone);
    expect(r.status).toBe(403);
    expect(r.body.error?.code ?? r.body.code).toBe('NOT_REGISTERED');
  });
});

describe('driver in the passenger app', () => {
  it('a new passenger account takes the driver’s name and e-mail', async () => {
    const phone = phoneOf();
    const email = `drv${Date.now()}@example.com`;
    await driverWith(phone, 'Andreas Georgiou', email);
    const r = await call(paxVerify, phone);
    expect(r.status).toBe(200);
    const p = await prisma.passenger.findUnique({ where: { phone } });
    expect(p?.name).toBe('Andreas Georgiou');
    expect(p?.email).toBe(email);
  });

  it('fills only what is empty; an e-mail used by another passenger is not taken', async () => {
    const phone = phoneOf();
    const email = `taken${Date.now()}@example.com`;
    await prisma.passenger.create({ data: { email, name: 'Someone else' } });
    await driverWith(phone, 'Maria K', email);
    await prisma.passenger.create({ data: { phone, name: 'My own name' } });
    await call(paxVerify, phone);
    const p = await prisma.passenger.findUnique({ where: { phone } });
    expect(p?.name).toBe('My own name');
    expect(p?.email).toBeNull();
  });

  it('a non-driver number gets a plain passenger account', async () => {
    const phone = phoneOf();
    await call(paxVerify, phone);
    const p = await prisma.passenger.findUnique({ where: { phone } });
    expect(p?.name).toBeNull();
  });
});
