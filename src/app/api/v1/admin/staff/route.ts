import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { generateToken } from '@/lib/crypto';
import { requireOwner } from '@/server/accounting';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// «Сотрудники» — the owner creates admins and dispatchers (2026-11-23). Owner only.
export async function GET() {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const users = await prisma.staffUser.findMany({ where: { role: { in: ['ADMIN', 'DISPATCHER'] } }, orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }] });
  const last = await prisma.authSession.groupBy({ by: ['userId'], where: { userId: { in: users.map((u) => u.id) } }, _max: { createdAt: true } });
  const lastBy = new Map(last.map((l) => [l.userId, l._max.createdAt]));
  return apiOk({
    staff: users.map((u) => ({ id: u.id, login: u.login, displayName: u.displayName, role: u.role, isOwner: u.isOwner, active: u.active, mfa: !!u.totpEnabledAt, lastSignIn: lastBy.get(u.id)?.toISOString() ?? null, createdAt: u.createdAt.toISOString() })),
  });
}

const createSchema = z.object({
  login: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/),
  displayName: z.string().trim().min(1).max(100),
  role: z.enum(['ADMIN', 'DISPATCHER']),
});

export async function POST(req: Request) {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let raw: unknown;
  try { raw = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const p = createSchema.safeParse(raw);
  if (!p.success) return Errors.validation({ _: 'Login: 3–40 letters, digits, . _ -; name required.' });
  if (await prisma.staffUser.findUnique({ where: { login: p.data.login } })) return Errors.conflict('That login already exists.');
  const temporaryPassword = generateToken(9);
  const u = await prisma.staffUser.create({ data: { login: p.data.login, displayName: p.data.displayName, role: p.data.role, passwordHash: await hashPassword(temporaryPassword), active: true } });
  await prisma.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'CREATE_STAFF', target: u.id, detail: `${u.role} ${u.login}` } });
  return apiOk({ id: u.id, login: u.login, temporaryPassword }, 201);
}
