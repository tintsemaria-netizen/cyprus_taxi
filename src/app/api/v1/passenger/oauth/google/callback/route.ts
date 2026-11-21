import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requestBaseUrl, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { rateLimit } from '@/lib/rate-limit';
import { googleEnabled, googleExchange, passengerFromGoogle, safeNext, OAUTH_COOKIE } from '@/server/oauth-google';
import { createPassengerSession } from '@/server/passenger';

export const dynamic = 'force-dynamic';

// Google sends the browser back here with ?code&state. Any problem → back to /login with «?oauth=failed».
export async function GET(req: Request) {
  const base = requestBaseUrl(req);
  const fail = (why: string) => {
    console.warn('[oauth-google] sign-in failed:', why);
    const res = NextResponse.redirect(`${base}/login?oauth=failed`, 302);
    res.cookies.delete({ name: OAUTH_COOKIE, path: '/api/v1/passenger/oauth' });
    return res;
  };
  if (!googleEnabled()) return fail('disabled');
  const rl = await rateLimit('oauth-ip', clientIp(req, config.trustedProxyHops), 30, 600);
  if (!rl.ok) return fail('rate-limited');
  const u = new URL(req.url);
  if (u.searchParams.get('error')) return fail(`google:${u.searchParams.get('error')}`); // e.g. the person pressed «Отмена»
  const code = u.searchParams.get('code'), state = u.searchParams.get('state');
  const jar = await cookies();
  let saved: { state?: string; nonce?: string; verifier?: string; next?: string } = {};
  try { saved = JSON.parse(jar.get(OAUTH_COOKIE)?.value || '{}'); } catch { /* fall through */ }
  if (!code || !state || !saved.state || state !== saved.state || !saved.nonce || !saved.verifier) return fail('state');
  try {
    const profile = await googleExchange(code, `${base}/api/v1/passenger/oauth/google/callback`, saved.verifier, saved.nonce);
    const p = await passengerFromGoogle(profile);
    await createPassengerSession(p.id);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'exchange');
  }
  const res = NextResponse.redirect(`${base}${safeNext(saved.next)}`, 302);
  res.cookies.delete({ name: OAUTH_COOKIE, path: '/api/v1/passenger/oauth' });
  return res;
}
