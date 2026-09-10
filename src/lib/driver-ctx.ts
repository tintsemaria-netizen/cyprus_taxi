import { getStaff } from './auth';
import { prisma } from './db';
import { Driver } from '@prisma/client';

// Resolve the authenticated user to their Driver record, or an error code.
export async function requireDriver(): Promise<{ driver: Driver; userId: string } | { error: 401 | 403 }> {
  const ctx = await getStaff();
  if (!ctx) return { error: 401 };
  if (ctx.user.role !== 'DRIVER') return { error: 403 };
  const driver = await prisma.driver.findUnique({ where: { userId: ctx.user.id } });
  if (!driver || !driver.active) return { error: 403 };
  return { driver, userId: ctx.user.id };
}

export function isDriverCtx(
  v: { driver: Driver; userId: string } | { error: 401 | 403 },
): v is { driver: Driver; userId: string } {
  return (v as { driver?: Driver }).driver !== undefined;
}
