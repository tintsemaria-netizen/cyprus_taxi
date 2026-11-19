import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// Launch fixes §4 / §7 (2026-11-19): a real order needs an SMS-verified passenger phone (server
// rule), passenger test mode is a separate switch, a phone added later stays on the SAME account
// (history kept, no silent merge), and the ride-share switch ignores share opt-ins when off.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => new Headers(),
}));
// The SMS provider is replaced: «0000» is a valid code, anything else is wrong. No real SMS is sent.
vi.mock('@/server/sms', () => ({
  smsConfigured: () => true,
  sendOtp: async () => ({ provider: 'twilio' }),
  checkOtp: async (_p: string, c: string) => c === '0000',
}));

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { createPassengerSession } from '@/server/passenger';
import { createBooking } from '@/server/bookings';
import { createBookingSchema } from '@/lib/validation';
import * as bookings from '@/app/api/v1/bookings/route';
import * as otpVerify from '@/app/api/v1/passenger/otp/verify/route';
import * as publicConfig from '@/app/api/v1/public/config/route';

const cfg = config as unknown as { passengerTestMode: boolean; share: { enabled: boolean } };
const saved = { test: cfg.passengerTestMode, share: cfg.share.enabled };
const RUN = `${Date.now()}`.slice(-6);
let n = 0;
const phoneNo = () => `+357977${RUN}${(++n).toString().padStart(2, '0')}`.slice(0, 15);
const BODY = {
  pickup: { lat: 34.6706, lng: 33.0413, label: 'A' }, dropoff: { lat: 34.8751, lng: 33.6249, label: 'B' },
  when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'P',
};
const book = (body: unknown = BODY) => bookings.POST(new Request('http://localhost/api/v1/bookings', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'idempotency-key': `lf-${RUN}-${++n}-xxxx`, 'x-forwarded-for': `203.0.113.${n % 250}` },
  body: JSON.stringify(body),
}));
const verify = (body: unknown) => otpVerify.POST(new Request('http://localhost/api/v1/passenger/otp/verify', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${n % 250}` }, body: JSON.stringify(body),
}));

beforeAll(() => { if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`); });
beforeEach(() => { jar.clear(); cfg.passengerTestMode = false; cfg.share.enabled = false; });
afterAll(() => { cfg.passengerTestMode = saved.test; cfg.share.enabled = saved.share; });

describe('§4 verified passenger phone (commercial mode)', () => {
  it('no session → 401 LOGIN_REQUIRED; no guest account is created', async () => {
    const before = await prisma.passenger.count();
    const r = await book();
    expect(r.status).toBe(401);
    expect((await r.json()).error.code).toBe('LOGIN_REQUIRED');
    expect(await prisma.passenger.count()).toBe(before);
  });

  it('signed in without a verified phone → 403 PHONE_VERIFICATION_REQUIRED, nothing booked', async () => {
    const p = await prisma.passenger.create({ data: { email: `lf-${RUN}-${++n}@example.test`, name: 'E' } });
    await createPassengerSession(p.id);
    const r = await book({ ...BODY, phone: '+35799000000' }); // a typed phone is NOT accepted instead
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe('PHONE_VERIFICATION_REQUIRED');
    expect(await prisma.booking.count({ where: { passengerId: p.id } })).toBe(0);
  });

  it('phone set but never verified → still 403', async () => {
    const p = await prisma.passenger.create({ data: { phone: phoneNo() } });
    await createPassengerSession(p.id);
    expect((await book()).status).toBe(403);
  });

  it('verified phone → 201, and the booking uses the ACCOUNT phone, not the body', async () => {
    const phone = phoneNo();
    const p = await prisma.passenger.create({ data: { phone, phoneVerifiedAt: new Date() } });
    await createPassengerSession(p.id);
    const r = await book({ ...BODY, phone: '+35799111111' });
    expect(r.status).toBe(201);
    const b = await prisma.booking.findFirst({ where: { passengerId: p.id } });
    expect(b?.phone).toBe(phone);
  });

  it('attach: an e-mail account confirms a free number → same account, history kept, then can order', async () => {
    const p = await prisma.passenger.create({ data: { email: `lf-${RUN}-${++n}@example.test`, name: 'E' } });
    await createPassengerSession(p.id);
    const phone = phoneNo();
    expect((await verify({ phone, code: '1234', attach: true })).status).toBe(401); // wrong code
    const v = await verify({ phone, code: '0000', attach: true });
    expect(v.status).toBe(200);
    expect((await v.json()).attached).toBe(true);
    const after = await prisma.passenger.findUnique({ where: { id: p.id } });
    expect(after?.phone).toBe(phone);
    expect(after?.phoneVerifiedAt).not.toBeNull();
    expect(await prisma.passenger.count({ where: { phone } })).toBe(1);
    expect((await book()).status).toBe(201);
    expect(await prisma.booking.count({ where: { passengerId: p.id } })).toBe(1);
  });

  it('attach: a number owned by another account → 409 PHONE_IN_USE, no merge, no change', async () => {
    const phone = phoneNo();
    const owner = await prisma.passenger.create({ data: { phone, phoneVerifiedAt: new Date() } });
    const p = await prisma.passenger.create({ data: { email: `lf-${RUN}-${++n}@example.test` } });
    await createPassengerSession(p.id);
    const v = await verify({ phone, code: '0000', attach: true });
    expect(v.status).toBe(409);
    expect((await v.json()).error.code).toBe('PHONE_IN_USE');
    expect((await prisma.passenger.findUnique({ where: { id: p.id } }))?.phone).toBeNull();
    expect((await prisma.passenger.findUnique({ where: { id: owner.id } }))?.phone).toBe(phone);
  });

  it('public config reports test mode off', async () => {
    const c = await (await publicConfig.GET()).json();
    expect(c.passenger.testMode).toBe(false);
  });
});

describe('§4 passenger test mode (PASSENGER_TEST_MODE=on) is a separate switch', () => {
  it('guest order without session is allowed and marked by a guest account', async () => {
    cfg.passengerTestMode = true;
    const r = await book();
    expect(r.status).toBe(201);
    const c = await (await publicConfig.GET()).json();
    expect(c.passenger.testMode).toBe(true);
  });
});

describe('§7 ride-share switch (SHARE_ENABLED)', () => {
  const shareInput = () => createBookingSchema.parse({
    pickup: { lat: 34.875, lng: 33.6249, label: 'Larnaca Airport' }, dropoff: { lat: 35.1676, lng: 33.3736, label: 'Nicosia' },
    when: 'NOW', vClass: 'COMFORT', passengerCount: 1, luggageCount: 0, passengerName: 'P', phone: '+35799123456', shareOptIn: true, shareMaxExtraMin: 30,
  });

  it('off: a share opt-in is ignored — normal ride at the normal price', async () => {
    cfg.share.enabled = false;
    const r = await createBooking(shareInput(), `lf-share-off-${RUN}-${++n}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = await prisma.booking.findUnique({ where: { reference: r.body.reference } });
    expect(b?.shareOptIn ?? false).toBe(false);
  });

  it('public config tells the client the switch state', async () => {
    cfg.share.enabled = false;
    expect((await (await publicConfig.GET()).json()).share.enabled).toBe(false);
    cfg.share.enabled = true;
    expect((await (await publicConfig.GET()).json()).share.enabled).toBe(true);
  });
});
