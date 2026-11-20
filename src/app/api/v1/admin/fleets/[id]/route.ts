import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx, hashPassword } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateToken } from '@/lib/crypto';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
  resetPassword: z.boolean().optional(),
});

// Rename, switch off (the owner is logged out everywhere) or reset the owner's password.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  let raw: unknown;
  try { raw = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return Errors.validation({ _: 'Invalid fields.' });
  const fleet = await prisma.fleet.findUnique({ where: { id } });
  if (!fleet) return Errors.notFound();
  let temporaryPassword: string | undefined;
  await prisma.$transaction(async (tx) => {
    const fd: Record<string, unknown> = {};
    if (parsed.data.name) fd.name = parsed.data.name;
    if (typeof parsed.data.active === 'boolean') fd.active = parsed.data.active;
    if (Object.keys(fd).length) await tx.fleet.update({ where: { id }, data: fd });
    const ud: Record<string, unknown> = {};
    if (typeof parsed.data.active === 'boolean') { ud.active = parsed.data.active; if (!parsed.data.active) ud.sessionVersion = { increment: 1 }; }
    if (parsed.data.resetPassword) { temporaryPassword = generateToken(9); ud.passwordHash = await hashPassword(temporaryPassword); ud.sessionVersion = { increment: 1 }; }
    if (Object.keys(ud).length) await tx.staffUser.update({ where: { id: fleet.ownerId }, data: ud });
    await tx.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'UPDATE_FLEET', target: id } });
  });
  return apiOk({ ok: true, ...(temporaryPassword ? { temporaryPassword } : {}) });
}
