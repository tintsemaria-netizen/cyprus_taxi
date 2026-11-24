import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { saveSubscription, BrowserSubscription } from '@/server/push';

export const dynamic = 'force-dynamic';

// An admin turns on notifications on this phone / computer (2026-11-24): new driver documents to check.
export async function POST(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: { subscription?: BrowserSubscription };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  if (!body.subscription) return Errors.validation({ subscription: 'Required.' });
  const ok = await saveSubscription(`STAFF:${ctx.user.id}`, body.subscription);
  if (!ok) return Errors.validation({ subscription: 'Invalid subscription.' });
  return apiOk({ ok: true });
}
