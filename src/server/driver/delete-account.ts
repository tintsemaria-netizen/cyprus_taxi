import { prisma } from '@/lib/db';
import { goOffline } from '@/server/driver/duty';
import { deleteApplicationFiles } from '@/server/storage';

// A driver deletes his own account from the app (2026-11-26; App Store / Google Play rule: an app that lets
// people create an account must let them delete it inside the app; GDPR Art. 17).
//  - Refused while he has a ride now, a next ride queued or a committed pre-booking (finish or give it back first).
//  - Sign-in removed at once: login renamed, password unusable, every session revoked.
//  - Personal data erased: name and phone, the registration application (identity, licence, vehicle data) and its
//    document files, GPS, the stand queue place, push subscriptions; his name on past rides becomes «Driver».
//  - Kept, without his name: trips, fares, settlements, ledger — financial records the law requires.

export const DELETED_DRIVER = 'Deleted driver';
export type DriverDeleteResult = { ok: true } | { ok: false; status: number; code: string; message: string };

export async function deleteDriverAccount(driverId: string): Promise<DriverDeleteResult> {
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true, userId: true, applicationId: true } });
  if (!d) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Account not found.' };
  const busy = await prisma.assignment.findFirst({ where: { OR: [{ activeDriverId: driverId }, { queuedDriverId: driverId }] }, select: { id: true } });
  const committed = await prisma.preAssignment.findFirst({ where: { driverId, status: 'COMMITTED' }, select: { id: true } });
  if (busy || committed) return { ok: false, status: 409, code: 'ACTIVE_RIDE', message: 'Finish or give back your rides before deleting your account.' };

  const app = d.applicationId ? await prisma.driverApplication.findUnique({ where: { id: d.applicationId }, select: { id: true, applicantId: true } }) : null;
  await prisma.$transaction(async (tx) => {
    await goOffline(tx, driverId, 'driver');
    await tx.driver.update({ where: { id: driverId }, data: { publicName: DELETED_DRIVER, phone: 'deleted', active: false, onDuty: false, available: false, eligibility: 'SUSPENDED', acceptsShared: false } });
    await tx.staffUser.update({
      where: { id: d.userId },
      data: { login: `deleted-${d.userId}`, displayName: DELETED_DRIVER, passwordHash: '!deleted', active: false, sessionVersion: { increment: 1 }, totpSecret: null, totpPendingSecret: null, totpEnabledAt: null },
    });
    await tx.authSession.updateMany({ where: { userId: d.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.driverVehicleBinding.updateMany({ where: { driverId, endedAt: null }, data: { endedAt: new Date(), activeDriverId: null, activeVehicleId: null } });
    await tx.assignment.updateMany({ where: { driverId }, data: { driverPublicName: 'Driver' } });
    await tx.latestDriverLocation.deleteMany({ where: { driverId } });
    await tx.gpsSample.deleteMany({ where: { driverId } });
    await tx.standQueue.deleteMany({ where: { driverId } });
    await tx.pushSubscription.deleteMany({ where: { audience: `DRIVER:${d.userId}` } });
    await tx.notificationOutbox.deleteMany({ where: { audience: `DRIVER:${d.userId}`, deliveredAt: null } });
    if (app) {
      await tx.applicationDocument.deleteMany({ where: { applicationId: app.id } });
      await tx.driverApplication.update({ where: { id: app.id }, data: { identity: null, driving: null, vehicle: null, decisionReason: null } });
      await tx.applicantSession.deleteMany({ where: { applicantId: app.applicantId } });
      await tx.driverApplicant.update({ where: { id: app.applicantId }, data: { phone: `deleted-${app.applicantId}`, legalName: null, email: null } });
    }
  });
  if (app) await deleteApplicationFiles(app.id).catch(() => null); // files after the rows are gone
  return { ok: true };
}
