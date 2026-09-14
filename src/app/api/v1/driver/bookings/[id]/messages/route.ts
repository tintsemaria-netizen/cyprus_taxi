import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { listMessages, postMessage, driverOwnsBooking } from '@/server/chat';
import { notifyNewMessage } from '@/server/push';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Driver chat — only on the booking of the driver's CURRENT active assignment.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  if (!(await driverOwnsBooking(ctx.driver.id, id))) return Errors.forbidden();
  const sp = new URL(req.url).searchParams;
  return apiOk(await listMessages(id, { after: sp.get('after') || undefined, before: sp.get('before') || undefined, limit: sp.get('limit') ? Number(sp.get('limit')) : undefined }));
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
  void notifyNewMessage(id, 'DRIVER', r.message.body).catch(() => {}); // best-effort
  return apiOk({ ok: true, message: r.message }, 201);
}
