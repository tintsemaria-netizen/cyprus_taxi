import { getStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import type { Fleet, StaffUser } from '@prisma/client';

// Fleet owner (2026-11-20, operator): read-only. He sees only the drivers and vehicles the admin
// put into his fleet. Everything he can read goes through these checks.

export type FleetCtx = { user: StaffUser; fleet: Fleet };

export async function requireFleetOwner(): Promise<FleetCtx | { error: 401 | 403 }> {
  const ctx = await getStaff();
  if (!ctx) return { error: 401 };
  if (ctx.user.role !== 'FLEET_OWNER') return { error: 403 };
  if (config.staffMfaEnforce && !ctx.user.totpEnabledAt) return { error: 403 };
  const fleet = await prisma.fleet.findUnique({ where: { ownerId: ctx.user.id } });
  if (!fleet || !fleet.active) return { error: 403 };
  return { user: ctx.user, fleet };
}

export function isFleetCtx(v: FleetCtx | { error: 401 | 403 }): v is FleetCtx {
  return (v as FleetCtx).fleet !== undefined;
}

/** True only for a driver of this fleet — anything else is answered as «not found». */
export async function fleetHasDriver(fleetId: string, driverId: string): Promise<boolean> {
  return !!(await prisma.driver.findFirst({ where: { id: driverId, fleetId }, select: { id: true } }));
}
