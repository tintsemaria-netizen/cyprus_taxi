import { apiOk, Errors } from '@/lib/http';
import { getStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await getStaff();
  if (!ctx) return Errors.unauthorized();
  let driverId: string | null = null;
  if (ctx.user.role === 'DRIVER') {
    const d = await prisma.driver.findUnique({ where: { userId: ctx.user.id } });
    driverId = d?.id ?? null;
  }
  return apiOk({ id: ctx.user.id, role: ctx.user.role, displayName: ctx.user.displayName, driverId });
}
