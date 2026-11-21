import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import type { Passenger } from '@prisma/client';

// «Продолжить с Google» for passengers (2026-11-22, operator). OpenID Connect authorization-code flow with PKCE:
// /start sends the browser to Google; /callback swaps the code for an ID token at Google's token endpoint (server to
// server, over TLS, with our client secret — so the token is Google's own answer) and signs the passenger in.
// A passenger is found by the PERMANENT Google id («sub»); an existing account with the same Google-verified e-mail is
// linked to it once.

export const OAUTH_COOKIE = 'tc_oauth_g';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
// A stand-in token endpoint for local end-to-end checks only — ignored in production.
const tokenUrl = () => (process.env.NODE_ENV !== 'production' && process.env.GOOGLE_OAUTH_TOKEN_URL_DEV) || GOOGLE_TOKEN_URL;
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export function googleEnabled(): boolean {
  const c = config.googleOAuth();
  return !!(c.clientId && c.clientSecret);
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Everything the browser round-trip needs; `cookie` is kept httpOnly for 10 minutes and checked on return. */
export function googleStart(redirectUri: string, next: string) {
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({
    client_id: config.googleOAuth().clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  });
  return { url: `${GOOGLE_AUTH_URL}?${q}`, cookie: JSON.stringify({ state, nonce, verifier, next: safeNext(next) }) };
}

/** Only a path on our own site — never another site (no open redirect). */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/(?!\/)[^\s\\]*$/.test(next) ? next : '/';
}

export interface GoogleProfile { sub: string; email: string | null; emailVerified: boolean; name: string | null }

function decodeIdToken(idToken: string): Record<string, unknown> {
  const part = idToken.split('.')[1];
  if (!part) throw new Error('bad id_token');
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

/** Code → Google's checked profile. Throws on any mismatch (state is checked by the caller). */
export async function googleExchange(code: string, redirectUri: string, verifier: string, nonce: string, now = Date.now()): Promise<GoogleProfile> {
  const c = config.googleOAuth();
  const r = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`token endpoint ${r.status}`);
  const j = (await r.json()) as { id_token?: string };
  if (!j.id_token) throw new Error('no id_token');
  const t = decodeIdToken(j.id_token);
  if (!ISSUERS.has(String(t.iss))) throw new Error('bad iss');
  const aud = Array.isArray(t.aud) ? t.aud : [t.aud];
  if (!aud.includes(c.clientId)) throw new Error('bad aud');
  if (typeof t.exp !== 'number' || t.exp * 1000 < now - 60_000) throw new Error('expired');
  if (t.nonce !== nonce) throw new Error('bad nonce');
  if (typeof t.sub !== 'string' || !t.sub) throw new Error('no sub');
  return {
    sub: t.sub,
    email: typeof t.email === 'string' ? t.email.toLowerCase() : null,
    emailVerified: t.email_verified === true || t.email_verified === 'true',
    name: typeof t.name === 'string' ? t.name.slice(0, 100) : null,
  };
}

/** The passenger for this Google account: by Google id; else link the account with that verified e-mail; else new. */
export async function passengerFromGoogle(p: GoogleProfile): Promise<Passenger> {
  const bySub = await prisma.passenger.findUnique({ where: { googleSub: p.sub } });
  if (bySub) return bySub;
  if (p.email && p.emailVerified) {
    const byEmail = await prisma.passenger.findUnique({ where: { email: p.email } });
    if (byEmail) return prisma.passenger.update({ where: { id: byEmail.id }, data: { googleSub: p.sub, ...(byEmail.name ? {} : { name: p.name }) } });
  }
  try {
    return await prisma.passenger.create({ data: { googleSub: p.sub, email: p.email && p.emailVerified ? p.email : null, name: p.name } });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') { // a parallel first sign-in won the race
      const again = await prisma.passenger.findUnique({ where: { googleSub: p.sub } });
      if (again) return again;
    }
    throw e;
  }
}
