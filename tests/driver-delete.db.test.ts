import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// A driver deletes his own account in the app (2026-11-26; store rules, GDPR Art. 17).
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { deleteDriverAccount, DELETED_DRIVER } from '@/server/driver/delete-account';

const RUN = `${Date.now()}`;
let userId = '', driverId = '';

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error('Refusing: DB name must end in _test');
  const u = await prisma.staffUser.create({ data: { login: `del-${RUN}`, passwordHash: 'x', role: 'DRIVER', displayName: 'Del Driver' } });
  const d = await prisma.driver.create({ data: { userId: u.id, publicName: 'Del Driver', phone: '+35799000111', eligibility: 'APPROVED', onDuty: true, available: true } });
  userId = u.id; driverId = d.id;
  const now = new Date();
  await prisma.latestDriverLocation.create({ data: { driverId, lat: 34.7, lng: 33.0, accuracyM: 5, sampledAt: now, gpsSession: 's', sequence: 1 } });
  await prisma.pushSubscription.create({ data: { endpoint: `https://push.example/${RUN}`, p256dh: 'k', auth: 'a', audience: `DRIVER:${userId}` } });
});
afterAll(async () => {
  await prisma.dutySession.deleteMany({ where: { driverId } });
  await prisma.driver.deleteMany({ where: { id: driverId } });
  await prisma.authSession.deleteMany({ where: { userId } });
  await prisma.staffUser.deleteMany({ where: { id: userId } });
});

describe('driver deletes his account', () => {
  it('erases sign-in and personal data, keeps nothing that names him', async () => {
    const r = await deleteDriverAccount(driverId);
    expect(r.ok).toBe(true);
    const d = (await prisma.driver.findUnique({ where: { id: driverId } }))!;
    expect(d.publicName).toBe(DELETED_DRIVER);
    expect(d.phone).toBe('deleted');
    expect(d.active).toBe(false);
    expect(d.onDuty).toBe(false);
    const u = (await prisma.staffUser.findUnique({ where: { id: userId } }))!;
    expect(u.login).toBe(`deleted-${userId}`);
    expect(u.active).toBe(false);
    expect(await prisma.latestDriverLocation.findUnique({ where: { driverId } })).toBeNull();
    expect(await prisma.pushSubscription.count({ where: { audience: `DRIVER:${userId}` } })).toBe(0);
  });
});
