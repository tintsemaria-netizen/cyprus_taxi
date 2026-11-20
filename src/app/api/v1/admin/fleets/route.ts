import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx, hashPassword } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateToken } from '@/lib/crypto';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// Fleets and their owners (2026-11-20, operator). The admin creates an owner login + fleet; the
// owner gets a one-time temporary password and can only look at his fleet.
export async function GET() {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const fleets = await prisma.fleet.findMany({ include: { owner: true, _count: { select: { drivers: true, vehicles: true } } }, orderBy: { createdAt: 'asc' } });
  return apiOk({
    fleets: fleets.map((f) => ({
      id: f.id, name: f.name, active: f.active && f.owner.active,
      owner: { login: f.owner.login, displayName: f.owner.displayName, isDriver: f.owner.role === 'DRIVER' },
      drivers: f._count.drivers, vehicles: f._count.vehicles,
    })),
  });
}

// Owner = a new FLEET_OWNER login, or (2026-11-20, operator: «владелец тоже может работать») an existing
// driver — he keeps his driver login and gets «Мой автопарк» in his menu; he is put into his own fleet.
const createSchema = z.union([
  z.object({ name: z.string().trim().min(1).max(80), driverId: z.string().min(1).max(64) }),
  z.object({
    name: z.string().trim().min(1).max(80),
    login: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/),
    displayName: z.string().trim().min(1).max(100),
  }),
]);

export async function POST(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let raw: unknown;
  try { raw = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return Errors.validation({ _: 'Fill in the fleet name and the owner.' });
  if ('driverId' in parsed.data) {
    const { name, driverId } = parsed.data;
    const d = await prisma.driver.findUnique({ where: { id: driverId }, include: { user: true } });
    if (!d) return Errors.validation({ driverId: 'Unknown driver.' });
    if (await prisma.fleet.findUnique({ where: { ownerId: d.userId } })) return Errors.conflict('This driver already owns a fleet.');
    const fleet = await prisma.$transaction(async (tx) => {
      const f = await tx.fleet.create({ data: { name, ownerId: d.userId } });
      await tx.driver.update({ where: { id: d.id }, data: { fleetId: f.id } });
      await tx.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'CREATE_FLEET', target: f.id, detail: `owner driver ${d.user.login}` } });
      return f;
    });
    return apiOk({ id: fleet.id, login: d.user.login }, 201);
  }
  const nd = parsed.data;
  if (await prisma.staffUser.findUnique({ where: { login: nd.login } })) return Errors.conflict('That login already exists.');
  const temporaryPassword = generateToken(9);
  const passwordHash = await hashPassword(temporaryPassword);
  const fleet = await prisma.$transaction(async (tx) => {
    const owner = await tx.staffUser.create({ data: { login: nd.login, passwordHash, role: 'FLEET_OWNER', displayName: nd.displayName, active: true } });
    const f = await tx.fleet.create({ data: { name: nd.name, ownerId: owner.id } });
    await tx.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'CREATE_FLEET', target: f.id, detail: `owner ${owner.login}` } });
    return f;
  });
  return apiOk({ id: fleet.id, login: nd.login, temporaryPassword }, 201);
}
