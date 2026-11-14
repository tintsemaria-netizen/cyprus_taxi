import { apiOk, apiError, Errors } from '@/lib/http';
import { getPassenger } from '@/server/passenger';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// The signed-in client changes (or sets, if the account has none) their password (2026-11-14).
export async function POST(req: Request) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  let body: { current?: string; next?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const next = body.next ?? '';
  if (next.length < 8 || next.length > 200) return Errors.validation({ next: 'At least 8 characters.' });
  const rl = await rateLimit('ppw-change', p.id, 10, 600);
  if (!rl.ok) return Errors.throttled(rl.retryAfter ?? 600);
  if (p.passwordHash && !(await verifyPassword(body.current ?? '', p.passwordHash))) {
    return apiError(401, 'BAD_CREDENTIALS', 'Incorrect email or password.');
  }
  await prisma.passenger.update({ where: { id: p.id }, data: { passwordHash: await hashPassword(next) } });
  return apiOk({ ok: true });
}
