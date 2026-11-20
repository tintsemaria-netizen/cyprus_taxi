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
  // 2026-11-20 (operator): an owner may also drive — then his DRIVER login owns the fleet.
  if (ctx.user.role !== 'FLEET_OWNER' && ctx.user.role !== 'DRIVER') return { error: 403 };
  if (ctx.user.role === 'FLEET_OWNER' && config.staffMfaEnforce && !ctx.user.totpEnabledAt) return { error: 403 };
  const fleet = await prisma.fleet.findUnique({ where: { ownerId: ctx.user.id } });
  if (!fleet || !fleet.active) return { error: 403 };
  return { user: ctx.user, fleet };
}

/** The fleet a user owns (any role), for /auth/me and the driver's menu. */
export async function ownedFleet(userId: string): Promise<{ id: string; name: string } | null> {
  const f = await prisma.fleet.findUnique({ where: { ownerId: userId }, select: { id: true, name: true, active: true } });
  return f && f.active ? { id: f.id, name: f.name } : null;
}

export function isFleetCtx(v: FleetCtx | { error: 401 | 403 }): v is FleetCtx {
  return (v as FleetCtx).fleet !== undefined;
}

/** True only for a driver of this fleet — anything else is answered as «not found». */
export async function fleetHasDriver(fleetId: string, driverId: string): Promise<boolean> {
  return !!(await prisma.driver.findFirst({ where: { id: driverId, fleetId }, select: { id: true } }));
}
