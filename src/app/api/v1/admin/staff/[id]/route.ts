import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { generateToken } from '@/lib/crypto';
import { requireOwner } from '@/server/accounting';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// Switch an admin / dispatcher off or on, give a new temporary password, reset two-factor.
// The owner cannot do these to himself here (so he never locks himself out).
const schema = z.object({
  action: z.enum(['disable', 'enable', 'resetPassword', 'resetMfa']),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  let raw: unknown;
  try { raw = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const p = schema.safeParse(raw);
  if (!p.success) return Errors.validation({ action: 'Unknown action.' });
  const u = await prisma.staffUser.findUnique({ where: { id } });
  if (!u || !['ADMIN', 'DISPATCHER'].includes(u.role)) return Errors.notFound();
  if (u.id === ctx.user.id || u.isOwner) return Errors.conflict('Not for the owner\'s own account.');
  let temporaryPassword: string | undefined;
  const bump = { sessionVersion: { increment: 1 } }; // signs the account out everywhere
  if (p.data.action === 'disable') await prisma.staffUser.update({ where: { id }, data: { active: false, ...bump } });
  else if (p.data.action === 'enable') await prisma.staffUser.update({ where: { id }, data: { active: true } });
  else if (p.data.action === 'resetPassword') {
    temporaryPassword = generateToken(9);
    await prisma.staffUser.update({ where: { id }, data: { passwordHash: await hashPassword(temporaryPassword), ...bump } });
  } else await prisma.staffUser.update({ where: { id }, data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, ...bump } });
  await prisma.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: `STAFF_${p.data.action.toUpperCase()}`, target: id, detail: u.login } });
  return apiOk({ ok: true, ...(temporaryPassword ? { temporaryPassword } : {}) });
}
