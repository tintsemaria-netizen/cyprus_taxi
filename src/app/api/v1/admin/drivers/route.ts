import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx, hashPassword } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { driverSchema, zodFieldErrors } from '@/lib/validation';
import { generateToken } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const drivers = await prisma.driver.findMany({
    include: { user: true, bindings: { where: { endedAt: null }, include: { vehicle: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return apiOk({
    drivers: drivers.map((d) => ({
      id: d.id,
      login: d.user.login,
      publicName: d.publicName,
      phone: d.phone,
      active: d.active && d.user.active,
      onDuty: d.onDuty,
      available: d.available,
      vehicle: d.bindings[0] ? { plate: d.bindings[0].vehicle.plate, label: `${d.bindings[0].vehicle.make} ${d.bindings[0].vehicle.model}` } : null,
    })),
  });
}

export async function POST(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  const parsed = driverSchema.safeParse(raw);
  if (!parsed.success) return Errors.validation(zodFieldErrors(parsed.error));

  const existing = await prisma.staffUser.findUnique({ where: { login: parsed.data.login } });
  if (existing) return Errors.conflict('That login already exists.');

  // Generate a one-time temporary password, returned exactly once (never stored plaintext).
  const tempPassword = generateToken(9);
  const passwordHash = await hashPassword(tempPassword);
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.staffUser.create({
      data: { login: parsed.data.login, passwordHash, role: 'DRIVER', displayName: parsed.data.publicName, active: true },
    });
    const driver = await tx.driver.create({
      data: { userId: user.id, publicName: parsed.data.publicName, phone: parsed.data.phone, active: true },
    });
    await tx.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'CREATE_DRIVER', target: driver.id } });
    return driver;
  });
  return apiOk({ id: created.id, login: parsed.data.login, temporaryPassword: tempPassword }, 201);
}
