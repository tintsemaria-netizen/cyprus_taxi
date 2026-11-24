import { prisma } from '@/lib/db';
import { normVin } from '@/server/vehicle-dupes';
import { Prisma, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateToken } from '@/lib/crypto';

// Driver application domain (Task 015). One application per applicant. All transitions are
// server-validated + audited; approval alone provisions an operational driver.

// Required documents (IL-Y onboarding policy — configurable; see
// docs/research/DRIVER-ONBOARDING-REQUIREMENTS.md for the government-vs-platform split).
// REQUIRED vehicle photos (all applicants). taxi_sign is conditional → accepted but not required.
export const REQUIRED_VEHICLE_PHOTOS = ['vehicle_front', 'vehicle_rear'];
export const VEHICLE_PHOTO_SLOTS = ['vehicle_front', 'vehicle_rear', 'vehicle_left', 'vehicle_right', 'cabin_front', 'cabin_rear', 'boot'];
export const DOC_SLOTS = [
  'id_front', 'id_back', 'passport', 'selfie', 'right_to_work',
  'licence_front', 'licence_back', 'taxi_licence',
  'vehicle_reg', 'insurance', 'fleet_authorization', 'roadworthiness',
  ...VEHICLE_PHOTO_SLOTS, 'taxi_sign',
];

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };
const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const err = (status: number, code: string, message: string): Result<never> => ({ ok: false, status, code, message });

export async function getOrCreateApplication(applicantId: string) {
  const found = await prisma.driverApplication.findUnique({ where: { applicantId }, include: { documents: true } });
  if (found) return found;
  await prisma.driverApplication.create({ data: { applicantId } });
  return prisma.driverApplication.findUnique({ where: { applicantId }, include: { documents: true } });
}

const EDITABLE = ['DRAFT', 'CHANGES_REQUESTED'];

export async function saveDraft(applicantId: string, patch: { identity?: unknown; driving?: unknown; vehicle?: unknown }): Promise<Result> {
  const app = await prisma.driverApplication.findUnique({ where: { applicantId } });
  if (!app) return err(404, 'NO_APPLICATION', 'No application.');
  if (!EDITABLE.includes(app.status)) return err(409, 'NOT_EDITABLE', 'This application is under review and cannot be edited.');
  const data: Record<string, string> = {};
  if (patch.identity !== undefined) data.identity = JSON.stringify(patch.identity);
  if (patch.driving !== undefined) data.driving = JSON.stringify(patch.driving);
  if (patch.vehicle !== undefined) data.vehicle = JSON.stringify(patch.vehicle);
  const updated = await prisma.driverApplication.update({ where: { id: app.id }, data });
  return ok({ revision: updated.revision, status: updated.status });
}

// Missing required inputs for submission (identity: passport OR both ID sides).
export function missingRequirements(app: { identity: string | null; driving: string | null; vehicle: string | null }, slots: Set<string>): string[] {
  const miss: string[] = [];
  const j = (s: string | null) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
  const id = j(app.identity), dr = j(app.driving), ve = j(app.vehicle);
  for (const f of ['legalName', 'dateOfBirth', 'address', 'country']) if (!id[f]) miss.push(`identity.${f}`);
  const hasPassport = slots.has('passport');
  const hasIdCard = slots.has('id_front') && slots.has('id_back');
  if (!hasPassport && !hasIdCard) miss.push('doc.identity (passport OR id front+back)');
  if (!slots.has('selfie')) miss.push('doc.selfie');
  for (const f of ['licenceNumber', 'licenceCountry', 'licenceExpiry', 'taxiLicenceNumber']) if (!dr[f]) miss.push(`driving.${f}`);
  if (!slots.has('licence_front')) miss.push('doc.licence_front');
  if (!slots.has('taxi_licence')) miss.push('doc.taxi_licence');
  for (const f of ['plate', 'vin', 'make', 'model', 'year', 'seats', 'vClass']) if (!ve[f]) miss.push(`vehicle.${f}`);
  if (!slots.has('vehicle_reg')) miss.push('doc.vehicle_reg');
  if (!slots.has('insurance')) miss.push('doc.insurance');
  // Car photos: only front and rear are required (operator 2026-11-24); the rest are welcome.
  for (const s of REQUIRED_VEHICLE_PHOTOS) if (!slots.has(s)) miss.push(`photo.${s}`);
  return miss;
}

export async function submitApplication(applicantId: string): Promise<Result> {
  const app = await prisma.driverApplication.findUnique({ where: { applicantId }, include: { documents: true } });
  if (!app) return err(404, 'NO_APPLICATION', 'No application.');
  if (!EDITABLE.includes(app.status)) return err(409, 'NOT_EDITABLE', 'Already submitted.');
  const slots = new Set(app.documents.map((d) => d.slot));
  const missing = missingRequirements(app, slots);
  if (missing.length) return err(422, 'INCOMPLETE', `Missing: ${missing.join(', ')}`);
  // One car, one registration (2026-11-24).
  { const { findDuplicateVehicle } = await import('@/server/vehicle-dupes');
    let ve: Record<string, unknown> = {}; try { ve = app.vehicle ? JSON.parse(app.vehicle) : {}; } catch { /* checked above */ }
    if (await findDuplicateVehicle(ve, { exceptApplicationId: app.id })) return err(409, 'DUPLICATE_VEHICLE', 'This car is already registered.'); }
  await prisma.$transaction([
    prisma.driverApplication.update({ where: { id: app.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), decisionReason: null } }),
    prisma.applicationEvent.create({ data: { applicationId: app.id, type: 'SUBMITTED', actorType: 'APPLICANT', revision: app.revision } }),
  ]);
  return ok({ status: 'SUBMITTED' });
}

// ---- Admin actions ----

export async function startReview(applicationId: string, adminId: string): Promise<Result> {
  return runAdmin(applicationId, adminId, ['SUBMITTED'], 'IN_REVIEW', 'IN_REVIEW', undefined);
}
export async function requestChanges(applicationId: string, adminId: string, reason: string, expectedRevision?: number): Promise<Result> {
  if (!reason || reason.trim().length < 3) return err(422, 'REASON_REQUIRED', 'Describe the changes required.');
  return runAdmin(applicationId, adminId, ['SUBMITTED', 'IN_REVIEW'], 'CHANGES_REQUESTED', 'CHANGES_REQUESTED', reason, true, expectedRevision);
}
export async function rejectApplication(applicationId: string, adminId: string, reason: string, expectedRevision?: number): Promise<Result> {
  if (!reason || reason.trim().length < 3) return err(422, 'REASON_REQUIRED', 'A rejection reason is required.');
  return runAdmin(applicationId, adminId, ['SUBMITTED', 'IN_REVIEW'], 'REJECTED', 'REJECTED', reason, false, expectedRevision);
}

async function runAdmin(applicationId: string, adminId: string, from: string[], to: string, evt: string, reason?: string, bumpRevision = false, expectedRevision?: number): Promise<Result> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "DriverApplication" WHERE id = ${applicationId} FOR UPDATE`;
    const app = await tx.driverApplication.findUnique({ where: { id: applicationId } });
    if (!app) return err(404, 'NO_APPLICATION', 'No application.');
    if (expectedRevision !== undefined && app.revision !== expectedRevision) return err(409, 'REVISION_CONFLICT', 'Application changed since you opened it — reload.');
    if (!from.includes(app.status)) return err(409, 'BAD_STATE', `Cannot ${to} from ${app.status}.`);
    await tx.driverApplication.update({
      where: { id: applicationId },
      data: { status: to as never, reviewerId: adminId, reviewedAt: new Date(), decisionReason: reason ?? null, ...(bumpRevision ? { revision: { increment: 1 } } : {}) },
    });
    await tx.applicationEvent.create({ data: { applicationId, type: evt, actorType: 'ADMIN', actorId: adminId, detail: reason ?? null, revision: app.revision } });
    return ok({ status: to });
  });
}

/** Documents that always expire and must carry a future expiry date to be accepted (launch fixes §3). */
export const EXPIRING_SLOTS = new Set(['licence_front', 'taxi_licence', 'insurance', 'roadworthiness']);

export async function setDocumentDecision(applicationId: string, docId: string, decision: 'ACCEPTED' | 'CHANGES', note: string | undefined, adminId: string, expiresAt?: string | null): Promise<Result> {
  const doc = await prisma.applicationDocument.findFirst({ where: { id: docId, applicationId } });
  if (!doc) return err(404, 'NO_DOC', 'Document not found.');
  // Never accept a document that has not passed a malware scan (Task 015).
  if (decision === 'ACCEPTED' && doc.scanStatus !== 'CLEAN') return err(422, 'NOT_SCANNED_CLEAN', `Cannot accept: malware scan status is ${doc.scanStatus}. A clean scan is required.`);
  const exp = expiresAt ? new Date(expiresAt) : undefined;
  // Launch fixes §3: licence, taxi licence, insurance and roadworthiness are accepted only with a
  // FUTURE expiry date — otherwise the expiry watcher can never suspend the driver later.
  if (decision === 'ACCEPTED' && EXPIRING_SLOTS.has(doc.slot) && !(exp && !Number.isNaN(exp.getTime()) && exp > new Date()) && !(doc.expiresAt && doc.expiresAt > new Date())) {
    return err(422, 'EXPIRY_REQUIRED', 'Enter the document expiry date (in the future) to accept it.');
  }
  await prisma.applicationDocument.update({ where: { id: docId }, data: { decision, decisionNote: note ?? null, ...(exp && !Number.isNaN(exp.getTime()) ? { expiresAt: exp } : {}) } });
  await prisma.applicationEvent.create({ data: { applicationId, type: 'DOC_DECISION', actorType: 'ADMIN', actorId: adminId, visibility: 'INTERNAL', detail: `${doc.slot}:${decision}` } });
  // A renewal by an approved driver (2026-11-24): accepted → the old one goes and he may work again;
  // sent back → he is told, and blocked if the old one has already expired.
  const { afterRenewalAccepted, afterRenewalReturned } = await import('@/server/doc-renewal');
  if (decision === 'ACCEPTED') await afterRenewalAccepted(applicationId, docId);
  else await afterRenewalReturned(applicationId, docId);
  return ok({ decision });
}

// Approve → atomically provision (idempotent) a driver + vehicle + binding, APPROVED and
// off-duty. Revision/concurrency guarded so two admins can't approve a stale application.
export async function approveApplication(applicationId: string, adminId: string, expectedRevision: number): Promise<Result> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "DriverApplication" WHERE id = ${applicationId} FOR UPDATE`;
      const app = await tx.driverApplication.findUnique({ where: { id: applicationId }, include: { documents: true, applicant: true } });
      if (!app) return err(404, 'NO_APPLICATION', 'No application.');
      if (app.status === 'APPROVED') return ok({ status: 'APPROVED', already: true }); // idempotent
      if (!['SUBMITTED', 'IN_REVIEW'].includes(app.status)) return err(409, 'BAD_STATE', `Cannot approve from ${app.status}.`);
      if (app.revision !== expectedRevision) return err(409, 'REVISION_CONFLICT', 'Application changed since you opened it — reload.');

      const slots = new Set(app.documents.map((d) => d.slot));
      const missing = missingRequirements(app, slots);
      if (missing.length) return err(422, 'INCOMPLETE', `Cannot approve — missing: ${missing.join(', ')}`);
      // Every present required-ish document must be accepted, and none flagged for changes.
      if (app.documents.some((d) => d.decision === 'CHANGES')) return err(422, 'DOCS_NOT_ACCEPTED', 'Some documents still need changes.');
      const requiredDocs = app.documents.filter((d) => d.slot !== 'id_back' || slots.has('id_front'));
      if (requiredDocs.some((d) => d.decision !== 'ACCEPTED')) return err(422, 'DOCS_NOT_ACCEPTED', 'Accept all required documents before approving.');
      if (requiredDocs.some((d) => d.scanStatus !== 'CLEAN')) return err(422, 'DOCS_NOT_SCANNED', 'Every document must pass a clean malware scan before approval.');
      if (requiredDocs.some((d) => d.expiresAt && d.expiresAt < new Date())) return err(422, 'DOC_EXPIRED', 'A required document has already expired.');
      if (requiredDocs.some((d) => EXPIRING_SLOTS.has(d.slot) && !d.expiresAt)) return err(422, 'EXPIRY_REQUIRED', 'Licence, taxi licence, insurance and roadworthiness need an expiry date before approval.');

      const ve = JSON.parse(app.vehicle || '{}');
      // One car, one registration (2026-11-24): same plate (any spelling) or VIN already in the system.
      const { findDuplicateVehicle } = await import('@/server/vehicle-dupes');
      const dupe = await findDuplicateVehicle(ve, { exceptApplicationId: app.id });
      if (dupe?.where === 'vehicle') return err(409, 'DUPLICATE_VEHICLE', `This car (${dupe.plate}) is already registered.`);
      const id = JSON.parse(app.identity || '{}');
      const phone = app.applicant.phone;

      // Idempotent provisioning keyed on the application.
      let driver = await tx.driver.findFirst({ where: { applicationId } });
      if (!driver) {
        // Reuse a StaffUser by login=phone if present, else create one (unusable password;
        // the approved driver signs in via phone OTP — see /api/v1/driver/otp).
        let user = await tx.staffUser.findUnique({ where: { login: phone } });
        if (!user) {
          user = await tx.staffUser.create({ data: { login: phone, passwordHash: await bcrypt.hash(generateToken(), 12), role: Role.DRIVER, displayName: id.legalName || app.applicant.legalName || 'Driver', active: true } });
        } else if (user.role !== Role.DRIVER) {
          return err(409, 'ACCOUNT_CONFLICT', 'A non-driver account already uses this phone.');
        }
        if (await tx.driver.findUnique({ where: { userId: user.id } })) return err(409, 'ALREADY_DRIVER', 'This account is already a driver.');
        const vehicle = await tx.vehicle.create({ data: { plate: ve.plate, vin: normVin(ve.vin) || null, make: ve.make, model: ve.model, color: ve.color || 'Unknown', vClass: ve.vClass, seats: Number(ve.seats), active: true } });
        driver = await tx.driver.create({ data: { userId: user.id, publicName: id.legalName || 'Driver', phone, active: true, onDuty: false, available: false, eligibility: 'APPROVED', applicationId } });
        await tx.driverVehicleBinding.create({ data: { driverId: driver.id, vehicleId: vehicle.id, activeDriverId: driver.id, activeVehicleId: vehicle.id } });
      } else if (driver.eligibility !== 'APPROVED') {
        await tx.driver.update({ where: { id: driver.id }, data: { eligibility: 'APPROVED' } });
      }

      await tx.driverApplication.update({ where: { id: applicationId }, data: { status: 'APPROVED', reviewerId: adminId, reviewedAt: new Date(), decisionReason: null } });
      await tx.applicationEvent.create({ data: { applicationId, type: 'APPROVED', actorType: 'ADMIN', actorId: adminId, revision: app.revision } });
      await tx.auditEvent.create({ data: { actorId: adminId, actorRole: Role.ADMIN, action: 'APPROVE_DRIVER', target: applicationId, detail: `driver ${driver.id}` } });
      return ok({ status: 'APPROVED', driverId: driver.id });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return err(409, 'DUPLICATE', 'A conflicting plate/account already exists — review for duplicates.');
    throw e;
  }
}

// (Rejected/abandoned KYC files are purged on a schedule by src/server/kyc-retention.ts.)

// Expiry enforcement (Task 015 §5). An APPROVED driver whose required document has expired
// → DOCUMENTS_EXPIRED: taken off duty, unaccepted offers invalidated. NEVER cancels an
// active trip (the assignment is left intact; only new work is blocked). Sends 30/7/1-day
// reminders via the outbox.
export async function enforceDocumentExpiries(now: Date = new Date()): Promise<void> {
  // Per document type, newest wins; an upload waiting for the admin keeps the driver working (2026-11-24).
  const { runDocExpiry } = await import('@/server/doc-renewal');
  await runDocExpiry(now);
}
