import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

// Isolated upload dir for the KYC retention test. config reads PRIVATE_UPLOAD_DIR at import time and
// imports are hoisted, so set it in vi.hoisted (runs before any import).
const UPLOADS = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR || '/tmp'}/kyc-test-${process.pid}`;
  process.env.PRIVATE_UPLOAD_DIR = dir;
  return dir;
});

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { ingestLocation } from '@/server/location';
import { driverPseudo } from '@/server/events';
import { runKycRetention } from '@/server/kyc-retention';
import { exportPassengerData, deletePassengerAccount, DELETED_LABEL } from '@/server/passenger-data';
import { createBooking } from '@/server/bookings';
import type { CreateBookingInput } from '@/lib/validation';

const RUN = `${Date.now()}`;
let n = 0;

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await fs.mkdir(UPLOADS, { recursive: true });
});
afterAll(async () => { await fs.rm(UPLOADS, { recursive: true, force: true }); });

describe('analytics GPS events are pseudonymous and coarse', () => {
  it('no raw driverId and no exact coordinates in the event', async () => {
    const d = (await prisma.driver.findFirst({ where: { publicName: 'Petros' } }))!;
    await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, active: true } });
    const sess = `priv-${RUN}`;
    const r = await ingestLocation(d.id, { lat: 34.67061, lng: 33.04131, accuracyM: 7, heading: 90, speed: 10, sampledAt: new Date().toISOString(), gpsSession: sess, sequence: 1 });
    expect(r.ok).toBe(true);
    const ev = await prisma.domainEvent.findFirst({ where: { eventType: 'gps.sample', aggregateId: { endsWith: `:${sess}` } } });
    expect(ev).not.toBeNull();
    expect(ev!.aggregateId).toBe(`${driverPseudo(d.id)}:${sess}`);
    const raw = JSON.stringify(ev);
    expect(raw).not.toContain(d.id);
    const payload = typeof ev!.payload === 'string' ? JSON.parse(ev!.payload) : ev!.payload;
    expect(payload.lat).toBe(34.67);
    expect(payload.lng).toBe(33.04);
    expect(payload).not.toHaveProperty('heading');
    expect(payload.speedKmh).toBe(36);
    await prisma.driver.update({ where: { id: d.id }, data: { onDuty: false } });
  });
});

describe('KYC file retention', () => {
  async function application(status: 'REJECTED' | 'DRAFT' | 'APPROVED', ageDays: number) {
    const applicant = await prisma.driverApplicant.create({ data: { phone: `+3579770${++n}${RUN.slice(-4)}`.slice(0, 15) } });
    const old = new Date(Date.now() - ageDays * 86_400_000);
    const app = await prisma.driverApplication.create({ data: { applicantId: applicant.id, status, reviewedAt: status === 'REJECTED' ? old : null } });
    await prisma.$executeRaw`UPDATE "DriverApplication" SET "updatedAt" = ${old} WHERE id = ${app.id}`;
    const key = path.join(app.id, `doc-${n}.jpg`);
    await fs.mkdir(path.join(UPLOADS, app.id), { recursive: true });
    await fs.writeFile(path.join(UPLOADS, key), 'x');
    await prisma.applicationDocument.create({ data: { applicationId: app.id, slot: 'LICENSE_FRONT', storageKey: key, mime: 'image/jpeg', sizeBytes: 1, sha256: 'x', scanStatus: 'CLEAN', decision: 'PENDING', revision: 1 } });
    return { app, key };
  }
  const exists = async (k: string) => fs.stat(path.join(UPLOADS, k)).then(() => true, () => false);

  it('purges files of old rejected and abandoned applications; keeps approved and recent ones; sweeps orphans', async () => {
    const rejectedOld = await application('REJECTED', 40);
    const rejectedNew = await application('REJECTED', 5);
    const draftOld = await application('DRAFT', 120);
    const approved = await application('APPROVED', 400);
    const orphanKey = path.join(rejectedNew.app.id, 'orphan.jpg');
    await fs.writeFile(path.join(UPLOADS, orphanKey), 'x');
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    await fs.utimes(path.join(UPLOADS, orphanKey), twoDaysAgo, twoDaysAgo);

    const r = await runKycRetention();
    expect(r.applicationsPurged).toBeGreaterThanOrEqual(2);
    expect(await exists(rejectedOld.key)).toBe(false);
    expect(await exists(draftOld.key)).toBe(false);
    expect(await exists(rejectedNew.key)).toBe(true);
    expect(await exists(approved.key)).toBe(true);
    expect(await exists(orphanKey)).toBe(false);
    expect(await prisma.applicationEvent.count({ where: { applicationId: rejectedOld.app.id, type: 'FILES_PURGED' } })).toBe(1);
    // Idempotent: a second run does not purge/record again.
    await runKycRetention();
    expect(await prisma.applicationEvent.count({ where: { applicationId: rejectedOld.app.id, type: 'FILES_PURGED' } })).toBe(1);
  });
});

describe('passenger export + account deletion', () => {
  const marina = { lat: 34.67061, lng: 33.04131, label: 'Home, 12 Example St' };
  const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
  beforeEach(async () => { await prisma.passengerSession.deleteMany({}); });

  async function passengerWithRide(status: 'COMPLETED' | 'SEARCHING') {
    const p = await prisma.passenger.create({ data: { phone: `+3579660${++n}${RUN.slice(-4)}`.slice(0, 15), name: 'Eleni', email: `eleni-${RUN}-${n}@example.test`, phoneVerifiedAt: new Date() } });
    await prisma.savedPlace.create({ data: { passengerId: p.id, kind: 'HOME', label: 'Home, 12 Example St', lat: 34.67, lng: 33.04 } });
    const r = await createBooking({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'Eleni', phone: p.phone, note: 'ring the bell' } as CreateBookingInput, `priv-${RUN}-${n}`, undefined, p.id);
    if (!r.ok) throw new Error('create');
    const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
    if (status === 'COMPLETED') await prisma.booking.update({ where: { id: b.id }, data: { status: 'COMPLETED' } });
    await prisma.chatMessage.create({ data: { bookingId: b.id, sender: 'PASSENGER', body: 'I am at the gate' } });
    await prisma.chatMessage.create({ data: { bookingId: b.id, sender: 'DRIVER', body: 'Coming' } });
    return { p, b };
  }

  it('export contains the account, saved places, rides and the passenger’s own messages', async () => {
    const { p, b } = await passengerWithRide('COMPLETED');
    const data = await exportPassengerData(p.id);
    expect(data!.account.email).toBe(p.email);
    expect(data!.savedPlaces).toHaveLength(1);
    expect(data!.rides).toHaveLength(1);
    expect(data!.rides[0].reference).toBe(b.reference);
    expect(data!.rides[0].yourChatMessages.map((m) => m.body)).toEqual(['I am at the gate']);
  });

  it('refuses while a ride is active', async () => {
    const { p } = await passengerWithRide('SEARCHING');
    const r = await deletePassengerAccount(p.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ACTIVE_RIDE');
    expect(await prisma.passenger.findUnique({ where: { id: p.id } })).not.toBeNull();
  });

  it('deletes the account and anonymises ride history, keeping the financial row', async () => {
    const { p, b } = await passengerWithRide('COMPLETED');
    await prisma.trackingGrant.updateMany({ where: { bookingId: b.id }, data: { revokedAt: null } });
    const r = await deletePassengerAccount(p.id);
    expect(r).toEqual({ ok: true, ridesAnonymised: 1 });
    expect(await prisma.passenger.findUnique({ where: { id: p.id } })).toBeNull();
    expect(await prisma.savedPlace.count({ where: { passengerId: p.id } })).toBe(0);
    const after = (await prisma.booking.findUnique({ where: { id: b.id } }))!;
    expect(after.status).toBe('COMPLETED');
    expect(after.passengerId).toBeNull();
    expect(after.passengerName).toBe('Deleted passenger');
    expect(after.phone).toBe('deleted');
    expect(after.note).toBeNull();
    expect(after.pickupLabel).toBe(DELETED_LABEL);
    expect(after.pickupLat).toBe(34.67);
    const msgs = await prisma.chatMessage.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: 'asc' } });
    expect(msgs.map((m) => m.body)).toEqual(['[deleted]', 'Coming']);
    expect(await prisma.trackingGrant.count({ where: { bookingId: b.id, revokedAt: null } })).toBe(0);
  });
});
