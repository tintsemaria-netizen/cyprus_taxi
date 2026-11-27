import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx, hashPassword } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateToken } from '@/lib/crypto';
import { z } from 'zod';
import { driverProfile } from '@/server/driver/profile';
import { driverHead } from '@/server/reports/driver-report';

export const dynamic = 'force-dynamic';

const schema = z.object({
  active: z.boolean().optional(),
  publicName: z.string().min(1).max(100).optional(),
  phone: z.string().min(5).max(20).optional(),
  resetPassword: z.boolean().optional(),
  fleetId: z.string().min(1).max(64).nullable().optional(), // 2026-11-20: put into / take out of a fleet
});

// One driver's header for the admin's per-driver report screen (2026-11-20).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const driver = await driverHead(id);
  if (!driver) return Errors.notFound();
  // Admin only, not the fleet owner (2026-11-27): e-mail, emergency contact, IBAN.
  const p = await driverProfile(id);
  return apiOk({ driver: { ...driver, private: p ? { email: p.email, emergencyName: p.emergencyName, emergencyPhone: p.emergencyPhone, iban: p.iban, ibanHolder: p.ibanHolder } : null } });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return Errors.validation({ _: 'Invalid fields.' });

  const driver = await prisma.driver.findUnique({ where: { id }, include: { user: true } });
  if (!driver) return Errors.notFound();
  if (parsed.data.fleetId && !(await prisma.fleet.findUnique({ where: { id: parsed.data.fleetId }, select: { id: true } }))) return Errors.validation({ fleetId: 'Unknown fleet.' });

  let temporaryPassword: string | undefined;
  let blocked = false;
  await prisma.$transaction(async (tx) => {
    // Deactivation must not silently invalidate an active assignment: lock the driver
    // row and re-check for an active trip inside the transaction (serializes with assign).
    if (parsed.data.active === false) {
      await tx.$executeRaw`SELECT 1 FROM "Driver" WHERE id = ${id} FOR UPDATE`;
      const active = await tx.assignment.findFirst({ where: { activeDriverId: id } });
      if (active) { blocked = true; return; }
    }
    const driverData: Record<string, unknown> = {};
    if (parsed.data.publicName) driverData.publicName = parsed.data.publicName;
    if (parsed.data.phone) driverData.phone = parsed.data.phone;
    if (typeof parsed.data.active === 'boolean') driverData.active = parsed.data.active;
    if (parsed.data.fleetId !== undefined) driverData.fleetId = parsed.data.fleetId;
    if (Object.keys(driverData).length) await tx.driver.update({ where: { id }, data: driverData });

    const userData: Record<string, unknown> = {};
    if (typeof parsed.data.active === 'boolean') {
      userData.active = parsed.data.active;
      // Deactivation bumps sessionVersion → instant logout everywhere (SPEC §10).
      if (!parsed.data.active) userData.sessionVersion = { increment: 1 };
    }
    if (parsed.data.resetPassword) {
      temporaryPassword = generateToken(9);
      userData.passwordHash = await hashPassword(temporaryPassword);
      userData.sessionVersion = { increment: 1 };
    }
    if (Object.keys(userData).length) await tx.staffUser.update({ where: { id: driver.userId }, data: userData });
    await tx.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'UPDATE_DRIVER', target: id } });
  });

  if (blocked) return Errors.conflict('Driver has an active assignment; reassign or complete it first.');
  return apiOk({ ok: true, ...(temporaryPassword ? { temporaryPassword } : {}) });
}
