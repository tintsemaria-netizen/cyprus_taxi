import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { saveSubscription, BrowserSubscription } from '@/server/push';

export const dynamic = 'force-dynamic';

// Driver registers a Web Push subscription for their account.
export async function POST(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: { subscription?: BrowserSubscription };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  if (!body.subscription) return Errors.validation({ subscription: 'Required.' });
  const ok = await saveSubscription(`DRIVER:${ctx.userId}`, body.subscription);
  if (!ok) return Errors.validation({ subscription: 'Invalid subscription.' });
  return apiOk({ ok: true });
}
