import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Sign-up with phone OPTIONAL (2026-11-12): email-only accounts, SMS-unavailable fallback, and
// booking/deletion for an account without a phone. Real route handlers against the _test DB, with
// next/headers' cookie jar replaced by an in-memory map (same harness as routes.db.test.ts).
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
import * as register from '@/app/api/v1/passenger/register/route';
import * as me from '@/app/api/v1/passenger/me/route';
import * as meDelete from '@/app/api/v1/passenger/me/delete/route';
import * as bookings from '@/app/api/v1/bookings/route';

const BASE = 'http://localhost:3000/api/v1';
const req = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 250)}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const RUN = `${Date.now()}`;
let n = 0;
const email = () => `reg${RUN}${++n}@example.com`;

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
});
beforeEach(() => { jar.clear(); });

describe('passenger sign-up with optional phone', () => {
  it('creates and signs in an email-only account when no phone is given', async () => {
    const e = email();
    const res = await register.POST(req('/passenger/register', { name: 'Eva', email: e, password: 'secret123' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ created: true, phoneSkipped: false });
    const p = await prisma.passenger.findUnique({ where: { email: e } });
    expect(p?.phone).toBeNull();
    expect(p?.passwordHash).toBeTruthy();
    const who = await (await me.GET()).json();
    expect(who).toMatchObject({ email: e, name: 'Eva', phone: null });
  });

  it('falls back to an account WITHOUT the phone when SMS is unavailable (never stores it unverified)', async () => {
    const e = email();
    const phone = `+3579981${String(n).padStart(4, '0')}`;
    const res = await register.POST(req('/passenger/register', { name: 'Nik', email: e, password: 'secret123', phone }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: true, phoneSkipped: true });
    expect((await prisma.passenger.findUnique({ where: { email: e } }))?.phone).toBeNull();
    expect(await prisma.passenger.findUnique({ where: { phone } })).toBeNull();
  });

  it('rejects a taken email and an invalid phone', async () => {
    const e = email();
    expect((await register.POST(req('/passenger/register', { name: 'A', email: e, password: 'secret123' }))).status).toBe(200);
    jar.clear();
    const dup = await register.POST(req('/passenger/register', { name: 'B', email: e, password: 'secret456' }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe('EMAIL_TAKEN');
    const bad = await register.POST(req('/passenger/register', { name: 'C', email: email(), password: 'secret123', phone: '12' }));
    expect(bad.status).toBe(422);
  });

  it('an email-only account books with the phone it enters, and can delete itself', async () => {
    const e = email();
    await register.POST(req('/passenger/register', { name: 'Leo', email: e, password: 'secret123' }));
    const contact = '+35799123456';
    const res = await bookings.POST(req('/bookings', {
      pickup: { lat: 34.6706, lng: 33.0413, label: 'A' }, dropoff: { lat: 34.8751, lng: 33.6249, label: 'B' },
      when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'Leo', phone: contact,
    }, { 'idempotency-key': `reg-${RUN}-${n}` }));
    expect([200, 201]).toContain(res.status);
    const p = (await prisma.passenger.findUnique({ where: { email: e } }))!;
    const b = await prisma.booking.findFirst({ where: { passengerId: p.id } });
    expect(b?.phone).toBe(contact);
    // The booking's contact number is not promoted to the account.
    expect((await prisma.passenger.findUnique({ where: { id: p.id } }))?.phone).toBeNull();

    // Deletion is refused while a ride is active; finish it first.
    await prisma.booking.update({ where: { id: b!.id }, data: { status: 'COMPLETED' } });
    const del = await meDelete.POST(req('/passenger/me/delete', { confirm: 'DELETE' }));
    expect(del.status).toBe(200);
    expect(await prisma.passenger.findUnique({ where: { id: p.id } })).toBeNull();
  });
});
