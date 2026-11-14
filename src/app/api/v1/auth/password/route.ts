import { apiOk, apiError, Errors } from '@/lib/http';
import { getStaff, verifyPassword, hashPassword, createStaffSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// A signed-in driver / dispatcher / admin changes their own password (2026-11-14).
// Bumps sessionVersion so every OTHER device is signed out, then re-issues this device's session.
export async function POST(req: Request) {
  const ctx = await getStaff();
  if (!ctx) return Errors.unauthorized();
  let body: { current?: unknown; next?: unknown };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const current = String(body.current ?? '');
  const next = String(body.next ?? '');
  if (next.length < 8 || next.length > 200) return Errors.validation({ next: 'At least 8 characters.' });
  const rl = await rateLimit('staff-pw-change', ctx.user.id, 10, 600);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  if (!(await verifyPassword(current, ctx.user.passwordHash))) {
    return apiError(401, 'BAD_CREDENTIALS', 'Incorrect email or password.');
  }
  const user = await prisma.staffUser.update({
    where: { id: ctx.user.id },
    data: { passwordHash: await hashPassword(next), sessionVersion: { increment: 1 } },
  });
  await prisma.auditEvent.create({ data: { actorId: user.id, actorRole: user.role, action: 'CHANGE_OWN_PASSWORD', target: user.id } });
  await createStaffSession(user);
  return apiOk({ ok: true });
}
