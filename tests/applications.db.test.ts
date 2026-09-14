import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { getOrCreateApplication, saveDraft, submitApplication, startReview, approveApplication, requestChanges } from '@/server/applications';
import { findBestCandidate } from '@/server/dispatch/eligibility';

const marina = { pickupLat: 34.6706, pickupLng: 33.0413, vClass: 'COMFORT' as const, passengerCount: 2 };
const PHONE = '+35799000777';
const PLATE = 'APP-TEST-1';

const REQUIRED_DOCS = ['passport', 'selfie', 'licence_front', 'taxi_licence', 'vehicle_reg', 'insurance', 'vehicle_front', 'vehicle_rear', 'vehicle_left', 'vehicle_right', 'cabin_front', 'cabin_rear', 'boot'];

async function cleanupApplicant() {
  const applicant = await prisma.driverApplicant.findUnique({ where: { phone: PHONE }, include: { application: true } });
  if (applicant?.application) {
    await prisma.applicationEvent.deleteMany({ where: { applicationId: applicant.application.id } });
    await prisma.applicationDocument.deleteMany({ where: { applicationId: applicant.application.id } });
    await prisma.driverApplication.deleteMany({ where: { id: applicant.application.id } });
  }
  if (applicant) { await prisma.applicantSession.deleteMany({ where: { applicantId: applicant.id } }); await prisma.driverApplicant.deleteMany({ where: { id: applicant.id } }); }
  await prisma.phoneVerification.deleteMany({ where: { phone: PHONE } });
  // provisioned artifacts
  const u = await prisma.staffUser.findUnique({ where: { login: PHONE } });
  if (u) {
    const d = await prisma.driver.findUnique({ where: { userId: u.id } });
    if (d) { await prisma.driverVehicleBinding.deleteMany({ where: { driverId: d.id } }); await prisma.latestDriverLocation.deleteMany({ where: { driverId: d.id } }); await prisma.driver.deleteMany({ where: { id: d.id } }); }
    await prisma.authSession.deleteMany({ where: { userId: u.id } });
    await prisma.staffUser.deleteMany({ where: { id: u.id } });
  }
  await prisma.vehicle.deleteMany({ where: { plate: PLATE } });
}

async function completeDraft() {
  const applicant = await prisma.driverApplicant.create({ data: { phone: PHONE, phoneVerifiedAt: new Date() } });
  await getOrCreateApplication(applicant.id);
  await saveDraft(applicant.id, {
    identity: { legalName: 'QA Applicant', dateOfBirth: '1990-01-01', address: '1 Test St', country: 'Cyprus' },
    driving: { licenceNumber: 'DL1', licenceCountry: 'CY', licenceExpiry: '2030-01-01', taxiLicenceNumber: 'TX1' },
    vehicle: { plate: PLATE, vin: 'VIN123', make: 'Toyota', model: 'Corolla', year: '2021', color: 'White', seats: '4', vClass: 'COMFORT' },
  });
  const app = (await prisma.driverApplication.findUnique({ where: { applicantId: applicant.id } }))!;
  for (const slot of REQUIRED_DOCS) {
    await prisma.applicationDocument.create({ data: { applicationId: app.id, slot, storageKey: `x/${slot}.jpg`, mime: 'image/jpeg', sizeBytes: 1, sha256: 'h', revision: 1, decision: 'PENDING' } });
  }
  return { applicantId: applicant.id, appId: app.id };
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await prisma.$queryRaw`SELECT 1`;
});
beforeEach(cleanupApplicant);

describe('Task 015 — application lifecycle + provisioning', () => {
  it('incomplete draft cannot be submitted', async () => {
    const applicant = await prisma.driverApplicant.create({ data: { phone: PHONE, phoneVerifiedAt: new Date() } });
    await getOrCreateApplication(applicant.id);
    const r = await submitApplication(applicant.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INCOMPLETE');
  });

  it('complete application: submit → review → approve provisions ONE driver+vehicle+binding, off-duty & APPROVED', async () => {
    const { applicantId, appId } = await completeDraft();
    expect((await submitApplication(applicantId)).ok).toBe(true);
    expect((await prisma.driverApplication.findUnique({ where: { id: appId } }))!.status).toBe('SUBMITTED');
    await startReview(appId, 'admin');
    await prisma.applicationDocument.updateMany({ where: { applicationId: appId }, data: { decision: 'ACCEPTED' } });
    const rev = (await prisma.driverApplication.findUnique({ where: { id: appId } }))!.revision;
    const appr = await approveApplication(appId, 'admin', rev);
    expect(appr.ok).toBe(true);
    const u = await prisma.staffUser.findUnique({ where: { login: PHONE } });
    const d = await prisma.driver.findFirst({ where: { applicationId: appId } });
    expect(u?.role).toBe('DRIVER');
    expect(d?.eligibility).toBe('APPROVED');
    expect(d?.onDuty).toBe(false);
    expect(await prisma.vehicle.count({ where: { plate: PLATE } })).toBe(1);
    expect(await prisma.driverVehicleBinding.count({ where: { driverId: d!.id, endedAt: null } })).toBe(1);
    // Idempotent re-approve.
    const again = await approveApplication(appId, 'admin', rev);
    expect(again.ok).toBe(true);
    expect(await prisma.driver.count({ where: { applicationId: appId } })).toBe(1);
  });

  it('approve is blocked with a stale revision (two-admin guard)', async () => {
    const { applicantId, appId } = await completeDraft();
    await submitApplication(applicantId);
    await startReview(appId, 'admin');
    await prisma.applicationDocument.updateMany({ where: { applicationId: appId }, data: { decision: 'ACCEPTED' } });
    const stale = 999;
    const r = await approveApplication(appId, 'admin', stale);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('REVISION_CONFLICT');
  });

  it('approve refused unless all required documents are accepted', async () => {
    const { applicantId, appId } = await completeDraft();
    await submitApplication(applicantId);
    await startReview(appId, 'admin');
    const rev = (await prisma.driverApplication.findUnique({ where: { id: appId } }))!.revision;
    const r = await approveApplication(appId, 'admin', rev); // docs still PENDING
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('DOCS_NOT_ACCEPTED');
  });

  it('request changes reopens editing with a new revision', async () => {
    const { applicantId, appId } = await completeDraft();
    await submitApplication(applicantId);
    const before = (await prisma.driverApplication.findUnique({ where: { id: appId } }))!.revision;
    await requestChanges(appId, 'admin', 'Blurry licence photo');
    const app = (await prisma.driverApplication.findUnique({ where: { id: appId } }))!;
    expect(app.status).toBe('CHANGES_REQUESTED');
    expect(app.revision).toBe(before + 1);
    expect((await saveDraft(applicantId, { identity: { legalName: 'QA Applicant', dateOfBirth: '1990-01-01', address: '2 New St', country: 'Cyprus' } })).ok).toBe(true);
  });
});

describe('Task 015 — eligibility gate', () => {
  it('a non-eligible (PENDING) driver is never a dispatch candidate; LEGACY is', async () => {
    const drv = await prisma.driver.findFirst({ where: { publicName: 'Andreas' }, include: { bindings: { where: { endedAt: null } } } });
    if (!drv || !drv.bindings[0]) throw new Error('fixture Andreas (bound COMFORT) missing');
    // Ensure no other seeded driver competes for this pickup.
    await prisma.driver.updateMany({ where: { publicName: { in: ['Maria', 'Petros'] } }, data: { onDuty: false, available: false } });
    await prisma.assignment.updateMany({ where: { activeDriverId: drv.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
    const now = new Date();
    await prisma.latestDriverLocation.upsert({ where: { driverId: drv.id }, update: { lat: 34.671, lng: 33.0413, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: 'elig', sequence: 1 }, create: { driverId: drv.id, lat: 34.671, lng: 33.0413, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: 'elig', sequence: 1 } });
    await prisma.driver.update({ where: { id: drv.id }, data: { onDuty: true, available: true, active: true, eligibility: 'PENDING' } });
    expect(await findBestCandidate(marina, 10, [])).toBeNull(); // PENDING excluded
    await prisma.driver.update({ where: { id: drv.id }, data: { eligibility: 'LEGACY' } });
    const c = await findBestCandidate(marina, 10, []);
    expect(c?.driverId).toBe(drv.id); // LEGACY eligible
    await prisma.driver.update({ where: { id: drv.id }, data: { onDuty: false, available: false } });
    await prisma.latestDriverLocation.deleteMany({ where: { driverId: drv.id } });
  });
});
