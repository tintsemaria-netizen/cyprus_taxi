import { NextResponse } from 'next/server';
import { requestBaseUrl, Errors } from '@/lib/http';
import { googleEnabled, googleStart, OAUTH_COOKIE } from '@/server/oauth-google';

export const dynamic = 'force-dynamic';

// GET /api/v1/passenger/oauth/google?next=/rides → to Google's account chooser.
export async function GET(req: Request) {
  if (!googleEnabled()) return Errors.notFound();
  const base = requestBaseUrl(req);
  const { url, cookie } = googleStart(`${base}/api/v1/passenger/oauth/google/callback`, new URL(req.url).searchParams.get('next') ?? '/');
  const res = NextResponse.redirect(url, 302);
  res.cookies.set(OAUTH_COOKIE, cookie, { httpOnly: true, secure: base.startsWith('https'), sameSite: 'lax', path: '/api/v1/passenger/oauth', maxAge: 600 });
  return res;
}
