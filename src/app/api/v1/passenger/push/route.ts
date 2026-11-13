import { apiOk, Errors } from '@/lib/http';
import { getPassenger } from '@/server/passenger';
import { saveSubscription, BrowserSubscription } from '@/server/push';

export const dynamic = 'force-dynamic';

// Signed-in passenger registers a Web Push subscription for their ACCOUNT (all their rides,
// including pre-booking reminders).
export async function POST(req: Request) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  let body: { subscription?: BrowserSubscription };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  if (!body.subscription) return Errors.validation({ subscription: 'Required.' });
  const ok = await saveSubscription(`PASSENGER_ACCOUNT:${p.id}`, body.subscription);
  if (!ok) return Errors.validation({ subscription: 'Invalid subscription.' });
  return apiOk({ ok: true });
}
