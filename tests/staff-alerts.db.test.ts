import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { staffAlerts, PENDING_APPLICATION } from '@/server/staff-alerts';

// The red menu (2026-11-23): «Заявки» counts waiting applications for every admin; changes only for the owner.
describe('staff alerts', () => {
  beforeAll(async () => { await prisma.$connect(); });
  it('counts waiting applications and owner-only changes', async () => {
    const owner = (await prisma.staffUser.findFirst({ where: { role: 'ADMIN', isOwner: true } }))!;
    const apps = await prisma.driverApplication.count({ where: { status: { in: [...PENDING_APPLICATION] } } });
    const changes = await prisma.staffAction.count({ where: { seenAt: null } });
    const o = await staffAlerts(owner);
    expect(o.applications).toBe(apps);
    expect(o.changes).toBe(changes);
    const other = { ...owner, isOwner: false };
    const a = await staffAlerts(other);
    expect(a.applications).toBe(apps);
    expect(a.changes).toBe(0);
    expect(a.last).toBeNull();
    expect((await staffAlerts({ ...owner, role: 'DISPATCHER' })).applications).toBe(0);
  });
});
