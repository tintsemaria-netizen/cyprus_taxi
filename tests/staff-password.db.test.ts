import { describe, it, expect, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';

// Driver/staff self-service password change (2026-11-14).
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => new Headers(),
}));

const RUN = `${Date.now()}`;
const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/v1/auth/password/route');
  return POST(new Request('http://x/api/v1/auth/password', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
};

describe('staff password change', () => {
  it('requires the current password; changes hash, keeps this device, signs out others', async () => {
    const { createStaffSession, getStaff } = await import('@/lib/auth');
    const u = await prisma.staffUser.create({ data: { login: `pwdrv${RUN}`, role: 'DRIVER', displayName: 'Pw Driver', passwordHash: await hashPassword('OldPassword1') } });
    await createStaffSession(u);
    const otherDevice = await prisma.authSession.findFirstOrThrow({ where: { userId: u.id } });
    expect((await getStaff())?.user.id).toBe(u.id);

    expect((await post({ current: 'wrong-one', next: 'NewPassword2' })).status).toBe(401);
    expect((await post({ current: 'OldPassword1', next: 'short' })).status).toBe(422);
    expect((await post({ current: 'OldPassword1', next: 'NewPassword2' })).status).toBe(200);

    const after = await prisma.staffUser.findUniqueOrThrow({ where: { id: u.id } });
    expect(await verifyPassword('NewPassword2', after.passwordHash)).toBe(true);
    expect(after.sessionVersion).toBe(u.sessionVersion + 1);
    expect(otherDevice.sessionVersion).not.toBe(after.sessionVersion); // old sessions are now invalid
    expect((await getStaff())?.user.id).toBe(u.id);                     // this device re-issued
    expect(await prisma.auditEvent.count({ where: { action: 'CHANGE_OWN_PASSWORD', target: u.id } })).toBe(1);
  });
});
