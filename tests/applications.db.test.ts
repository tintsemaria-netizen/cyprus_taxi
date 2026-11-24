import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { getOrCreateApplication, saveDraft, submitApplication, startReview, approveApplication, requestChanges, setDocumentDecision, enforceDocumentExpiries } from '@/server/applications';
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

  it('launch fixes §3: licence/insurance without a future expiry cannot be accepted or approved', async () => {
    const { applicantId, appId } = await completeDraft();
    expect((await submitApplication(applicantId)).ok).toBe(true);
    await startReview(appId, 'admin');
    const ins = (await prisma.applicationDocument.findFirst({ where: { applicationId: appId, slot: 'insurance' } }))!;
    await prisma.applicationDocument.update({ where: { id: ins.id }, data: { scanStatus: 'CLEAN' } });
    const noDate = await setDocumentDecision(appId, ins.id, 'ACCEPTED', undefined, 'admin');
    expect(noDate.ok).toBe(false);
    if (!noDate.ok) expect(noDate.code).toBe('EXPIRY_REQUIRED');
    const past = await setDocumentDecision(appId, ins.id, 'ACCEPTED', undefined, 'admin', new Date(Date.now() - 86_400_000).toISOString());
    expect(past.ok).toBe(false);
    const future = await setDocumentDecision(appId, ins.id, 'ACCEPTED', undefined, 'admin', new Date(Date.now() + 200 * 86_400_000).toISOString());
    expect(future.ok).toBe(true);
    // Forced-accepted documents without dates still block approval.
    await prisma.applicationDocument.updateMany({ where: { applicationId: appId }, data: { decision: 'ACCEPTED', scanStatus: 'CLEAN', expiresAt: null } });
    const rev = (await prisma.driverApplication.findUnique({ where: { id: appId } }))!.revision;
    const appr = await approveApplication(appId, 'admin', rev);
    expect(appr.ok).toBe(false);
    if (!appr.ok) expect(appr.code).toBe('EXPIRY_REQUIRED');
  });

  it('complete application: submit → review → approve provisions ONE driver+vehicle+binding, off-duty & APPROVED', async () => {
    const { applicantId, appId } = await completeDraft();
    expect((await submitApplication(applicantId)).ok).toBe(true);
    expect((await prisma.driverApplication.findUnique({ where: { id: appId } }))!.status).toBe('SUBMITTED');
    await startReview(appId, 'admin');
    await prisma.applicationDocument.updateMany({ where: { applicationId: appId }, data: { decision: 'ACCEPTED', scanStatus: 'CLEAN', expiresAt: new Date(Date.now() + 365 * 86_400_000) } });
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
    await prisma.applicationDocument.updateMany({ where: { applicationId: appId }, data: { decision: 'ACCEPTED', scanStatus: 'CLEAN', expiresAt: new Date(Date.now() + 365 * 86_400_000) } });
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

  it('never accept/approve an unscanned document (malware gate)', async () => {
    const { applicantId, appId } = await completeDraft();
    await submitApplication(applicantId);
    await startReview(appId, 'admin');
    const first = (await prisma.applicationDocument.findMany({ where: { applicationId: appId } }))[0];
    const dec = await setDocumentDecision(appId, first.id, 'ACCEPTED', undefined, 'admin'); // scanStatus UNScanned
    expect(dec.ok).toBe(false);
    if (!dec.ok) expect(dec.code).toBe('NOT_SCANNED_CLEAN');
    // Even if decisions were forced ACCEPTED, approval still requires a clean scan.
    await prisma.applicationDocument.updateMany({ where: { applicationId: appId }, data: { decision: 'ACCEPTED' } });
    const rev = (await prisma.driverApplication.findUnique({ where: { id: appId } }))!.revision;
    const r = await approveApplication(appId, 'admin', rev);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('DOCS_NOT_SCANNED');
  });

  it('expired document takes an APPROVED driver off duty as DOCUMENTS_EXPIRED', async () => {
    const { applicantId, appId } = await completeDraft();
    await submitApplication(applicantId);
    await startReview(appId, 'admin');
    await prisma.applicationDocument.updateMany({ where: { applicationId: appId }, data: { decision: 'ACCEPTED', scanStatus: 'CLEAN', expiresAt: new Date(Date.now() + 365 * 86_400_000) } });
    const rev = (await prisma.driverApplication.findUnique({ where: { id: appId } }))!.revision;
    expect((await approveApplication(appId, 'admin', rev)).ok).toBe(true);
    const d = (await prisma.driver.findFirst({ where: { applicationId: appId } }))!;
    await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true } });
    // Expire the licence.
    const lic = (await prisma.applicationDocument.findFirst({ where: { applicationId: appId, slot: 'licence_front' } }))!;
    await prisma.applicationDocument.update({ where: { id: lic.id }, data: { expiresAt: new Date(Date.now() - 86400000) } });
    await enforceDocumentExpiries();
    const after = (await prisma.driver.findUnique({ where: { id: d.id } }))!;
    expect(after.eligibility).toBe('DOCUMENTS_EXPIRED');
    expect(after.onDuty).toBe(false);
  });

  // Document renewal by the driver himself (2026-11-24, operator, option «б»).
  async function approvedDriver() {
    const { applicantId, appId } = await completeDraft();
    await submitApplication(applicantId);
    await startReview(appId, 'admin');
    await prisma.applicationDocument.updateMany({ where: { applicationId: appId }, data: { decision: 'ACCEPTED', scanStatus: 'CLEAN', expiresAt: new Date(Date.now() + 365 * 86_400_000) } });
    const rev = (await prisma.driverApplication.findUnique({ where: { id: appId } }))!.revision;
    expect((await approveApplication(appId, 'admin', rev)).ok).toBe(true);
    const d = (await prisma.driver.findFirst({ where: { applicationId: appId } }))!;
    const ins = (await prisma.applicationDocument.findFirst({ where: { applicationId: appId, slot: 'insurance' } }))!;
    return { appId, d, ins };
  }
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
  const outbox = (k: string) => prisma.notificationOutbox.findMany({ where: { msg: { path: ['k'], equals: k } } });

  it('renewal: pushes at 7 and 1 day only; expired → blocked; upload → works again on the unchecked one; accept → old one gone', async () => {
    const { runDocExpiry, docAttention } = await import('@/server/doc-renewal');
    const { uploadRenewal } = await import('@/server/doc-renewal');
    await prisma.notificationOutbox.deleteMany({});
    const { appId, d, ins } = await approvedDriver();
    const admin = await prisma.staffUser.findFirst({ where: { role: 'ADMIN', active: true } });

    // 10 days left: nothing. 6 days: the «7» push, once. 20 hours: the «1» push.
    const exp = new Date(Date.now() + 10 * 86_400_000);
    await prisma.applicationDocument.update({ where: { id: ins.id }, data: { expiresAt: exp } });
    await runDocExpiry(new Date());
    expect(await outbox('drv.docExpiring')).toHaveLength(0);
    const at = (daysBefore: number) => new Date(exp.getTime() - daysBefore * 86_400_000);
    await runDocExpiry(at(6)); await runDocExpiry(at(5));
    expect(await outbox('drv.docExpiring')).toHaveLength(1);
    await runDocExpiry(at(0.8));
    expect(await outbox('drv.docExpiring')).toHaveLength(2);
    // The admin sees the car in «Машины» (insurance), and gets the 7-day push once.
    const soon = (await docAttention(at(5))).filter((a) => a.driverId === d.id);
    expect(soon.map((a) => [a.slot, a.kind])).toEqual([['insurance', 'EXPIRING']]);
    if (admin) expect((await outbox('staff.docExpiring')).length).toBeGreaterThanOrEqual(1);

    // Expired, nothing uploaded → blocked.
    await prisma.applicationDocument.update({ where: { id: ins.id }, data: { expiresAt: new Date(Date.now() - 3_600_000) } });
    await runDocExpiry();
    expect((await prisma.driver.findUnique({ where: { id: d.id } }))!.eligibility).toBe('DOCUMENTS_EXPIRED');
    expect(await outbox('drv.docExpired')).toHaveLength(1);

    // He uploads the new insurance → works again at once (option «б»), the old accepted row stays.
    const up = await uploadRenewal(d.id, 'insurance', PNG);
    expect(up.ok).toBe(true);
    expect((await prisma.driver.findUnique({ where: { id: d.id } }))!.eligibility).toBe('APPROVED');
    expect(await prisma.applicationDocument.count({ where: { applicationId: appId, slot: 'insurance' } })).toBe(2);
    const waiting = (await docAttention()).find((a) => a.driverId === d.id)!;
    expect(waiting.kind).toBe('UPLOADED');
    expect(waiting.oldExpired).toBe(true);
    if (admin) expect(await outbox('staff.docUploaded')).not.toHaveLength(0);
    // Still working later, no more driver pushes; the admin gets the urgent reminder twice a day.
    const later = new Date(Date.now() + 13 * 3_600_000);
    await runDocExpiry(later); await runDocExpiry(new Date(later.getTime() + 60_000));
    expect((await prisma.driver.findUnique({ where: { id: d.id } }))!.eligibility).toBe('APPROVED');
    expect(await outbox('drv.docExpired')).toHaveLength(1);
    if (admin) {
      const n = (await outbox('staff.docUrgent')).length;
      expect(n).toBeGreaterThanOrEqual(1);
      await runDocExpiry(new Date(later.getTime() + 13 * 3_600_000));
      expect((await outbox('staff.docUrgent')).length).toBeGreaterThan(n);
    }

    // The admin can accept only a clean scan with a new date; then the old one goes.
    expect((await setDocumentDecision(appId, up.ok ? up.id : '', 'ACCEPTED', undefined, 'admin', new Date(Date.now() + 365 * 86_400_000).toISOString())).ok).toBe(up.ok && up.scanStatus === 'CLEAN');
    await prisma.applicationDocument.update({ where: { id: up.ok ? up.id : '' }, data: { scanStatus: 'CLEAN' } });
    expect((await setDocumentDecision(appId, up.ok ? up.id : '', 'ACCEPTED', undefined, 'admin', new Date(Date.now() + 365 * 86_400_000).toISOString())).ok).toBe(true);
    expect(await prisma.applicationDocument.count({ where: { applicationId: appId, slot: 'insurance' } })).toBe(1);
    expect((await docAttention()).filter((a) => a.driverId === d.id)).toHaveLength(0);
    expect((await prisma.driver.findUnique({ where: { id: d.id } }))!.eligibility).toBe('APPROVED');
  });

  it('renewal sent back by the admin: the driver is told and blocked again if the old one expired', async () => {
    const { uploadRenewal } = await import('@/server/doc-renewal');
    await prisma.notificationOutbox.deleteMany({});
    const { appId, d, ins } = await approvedDriver();
    await prisma.applicationDocument.update({ where: { id: ins.id }, data: { expiresAt: new Date(Date.now() - 86_400_000) } });
    await enforceDocumentExpiries();
    expect((await prisma.driver.findUnique({ where: { id: d.id } }))!.eligibility).toBe('DOCUMENTS_EXPIRED');
    const up = await uploadRenewal(d.id, 'insurance', PNG);
    expect((await prisma.driver.findUnique({ where: { id: d.id } }))!.eligibility).toBe('APPROVED');
    expect((await setDocumentDecision(appId, up.ok ? up.id : '', 'CHANGES', 'Blurry', 'admin')).ok).toBe(true);
    expect((await prisma.driver.findUnique({ where: { id: d.id } }))!.eligibility).toBe('DOCUMENTS_EXPIRED');
    expect(await outbox('drv.docReturned')).toHaveLength(1);
    // A second upload replaces the returned one (the accepted one stays).
    const up2 = await uploadRenewal(d.id, 'insurance', PNG);
    expect(up2.ok).toBe(true);
    expect(await prisma.applicationDocument.count({ where: { applicationId: appId, slot: 'insurance' } })).toBe(2);
    expect((await uploadRenewal(d.id, 'selfie', PNG)).ok).toBe(false); // only the four expiring documents
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
    // An open offer left by another test file (re-runs on the same DB) would make the driver "busy".
    await prisma.driverOffer.updateMany({ where: { activeDriverId: drv.id }, data: { status: 'CANCELED', activeDriverId: null, activeBookingId: null } });
    // …and a live pre-booking close in time would (correctly) protect the driver from new offers.
    await prisma.preAssignment.updateMany({ where: { driverId: drv.id, status: 'COMMITTED' }, data: { status: 'RELEASED', activeBookingId: null } });
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
