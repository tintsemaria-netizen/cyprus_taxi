import { apiOk, Errors } from '@/lib/http';
import { saveSubscription, BrowserSubscription } from '@/server/push';
import { requireOwner } from '@/server/accounting';

export const dynamic = 'force-dynamic';

// The owner's phone / browser for «Изменение в админке» notifications (2026-11-23).
export async function POST(req: Request) {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: { subscription?: BrowserSubscription };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  if (!body.subscription) return Errors.validation({ subscription: 'Required.' });
  if (!(await saveSubscription(`STAFF:${ctx.user.id}`, body.subscription))) return Errors.validation({ subscription: 'Invalid subscription.' });
  return apiOk({ ok: true });
}
