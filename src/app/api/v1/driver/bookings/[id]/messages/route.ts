import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { listMessages, postMessage, driverOwnsBooking } from '@/server/chat';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Driver chat — only on the booking of the driver's CURRENT active assignment.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  if (!(await driverOwnsBooking(ctx.driver.id, id))) return Errors.forbidden();
  const since = new URL(req.url).searchParams.get('after') || undefined;
  return apiOk(await listMessages(id, since));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  if (!(await driverOwnsBooking(ctx.driver.id, id))) return Errors.forbidden();
  const rl = await rateLimit('chat-send', clientIp(req, config.trustedProxyHops), 20, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  let body: { body?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const r = await postMessage(id, 'DRIVER', body.body ?? '');
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ ok: true, message: r.message }, 201);
}
