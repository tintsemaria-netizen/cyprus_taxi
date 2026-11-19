import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { answerShare } from '@/server/share';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({ groupId: z.string().uuid(), accept: z.boolean() });

// Driver answers a live co-rider proposal on their running trip (Task 022).
export async function POST(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let raw: unknown;
  try { raw = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const p = schema.safeParse(raw);
  if (!p.success) return Errors.validation({ _: 'groupId and accept are required.' });
  const r = await answerShare(p.data.groupId, { kind: 'DRIVER', driverId: ctx.driver.id }, p.data.accept);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ ok: true, status: r.status });
}
