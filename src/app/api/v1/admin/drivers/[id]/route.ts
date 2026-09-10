import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx, hashPassword } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateToken } from '@/lib/crypto';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  active: z.boolean().optional(),
  publicName: z.string().min(1).max(100).optional(),
  phone: z.string().min(5).max(20).optional(),
  resetPassword: z.boolean().optional(),
});

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

  let temporaryPassword: string | undefined;
  await prisma.$transaction(async (tx) => {
    const driverData: Record<string, unknown> = {};
    if (parsed.data.publicName) driverData.publicName = parsed.data.publicName;
    if (parsed.data.phone) driverData.phone = parsed.data.phone;
    if (typeof parsed.data.active === 'boolean') driverData.active = parsed.data.active;
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

  return apiOk({ ok: true, ...(temporaryPassword ? { temporaryPassword } : {}) });
}
