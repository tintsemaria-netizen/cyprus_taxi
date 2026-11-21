import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
// «Продолжить с Google» (2026-11-22): PKCE start, Google's answer checked (iss / aud / exp / nonce), passenger found by
// the permanent Google id, linked by a Google-verified e-mail, never sent to another site after sign-in.
import { prisma } from '@/lib/db';
import { googleStart, googleExchange, passengerFromGoogle, safeNext, googleEnabled } from '@/server/oauth-google';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
const RUN = Date.now().toString(36);

beforeAll(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-secret';
});
afterEach(() => vi.unstubAllGlobals());

function stubToken(claims: Record<string, unknown>, status = 200) {
  const f = vi.fn(async () => new Response(JSON.stringify({ id_token: idToken(claims) }), { status }));
  vi.stubGlobal('fetch', f);
  return f;
}
const good = (nonce: string, extra: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com', aud: 'test-client.apps.googleusercontent.com', sub: `g-${RUN}`, email: `tourist-${RUN}@gmail.com`,
  email_verified: true, name: 'Maria Tourist', nonce, exp: Math.floor(Date.now() / 1000) + 3600, ...extra,
});

describe('Google sign-in', () => {
  it('is on only with both keys; start URL carries PKCE, state and nonce; next stays on our site', () => {
    expect(googleEnabled()).toBe(true);
    const { url, cookie } = googleStart('https://il-y.taxi/api/v1/passenger/oauth/google/callback', '/rides');
    const u = new URL(url), c = JSON.parse(cookie);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe(c.state);
    expect(u.searchParams.get('nonce')).toBe(c.nonce);
    expect(c.next).toBe('/rides');
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)']) expect(safeNext(bad)).toBe('/');
  });

  it('accepts Google\'s answer only for our app, unexpired, with our nonce', async () => {
    stubToken(good('n1'));
    expect((await googleExchange('code', 'https://x/cb', 'v', 'n1')).sub).toBe(`g-${RUN}`);
    stubToken(good('n1', { aud: 'someone-else' }));
    await expect(googleExchange('code', 'https://x/cb', 'v', 'n1')).rejects.toThrow('bad aud');
    stubToken(good('other'));
    await expect(googleExchange('code', 'https://x/cb', 'v', 'n1')).rejects.toThrow('bad nonce');
    stubToken(good('n1', { iss: 'https://evil.example' }));
    await expect(googleExchange('code', 'https://x/cb', 'v', 'n1')).rejects.toThrow('bad iss');
    stubToken(good('n1', { exp: Math.floor(Date.now() / 1000) - 3600 }));
    await expect(googleExchange('code', 'https://x/cb', 'v', 'n1')).rejects.toThrow('expired');
    stubToken(good('n1'), 400);
    await expect(googleExchange('code', 'https://x/cb', 'v', 'n1')).rejects.toThrow('token endpoint');
  });

  it('first sign-in creates the passenger; next time the same Google id finds the same account', async () => {
    const p1 = await passengerFromGoogle({ sub: `g-${RUN}`, email: `tourist-${RUN}@gmail.com`, emailVerified: true, name: 'Maria Tourist' });
    const p2 = await passengerFromGoogle({ sub: `g-${RUN}`, email: `changed-${RUN}@gmail.com`, emailVerified: true, name: 'X' });
    expect(p2.id).toBe(p1.id);
    expect(p1.email).toBe(`tourist-${RUN}@gmail.com`);
  });

  it('links an existing e-mail account only when Google verified that e-mail', async () => {
    const existing = await prisma.passenger.create({ data: { email: `old-${RUN}@gmail.com`, name: 'Old' } });
    const unverified = await passengerFromGoogle({ sub: `u-${RUN}`, email: `old-${RUN}@gmail.com`, emailVerified: false, name: 'Imposter' });
    expect(unverified.id).not.toBe(existing.id);
    expect(unverified.email).toBeNull();
    const linked = await passengerFromGoogle({ sub: `v-${RUN}`, email: `old-${RUN}@gmail.com`, emailVerified: true, name: 'Old' });
    expect(linked.id).toBe(existing.id);
    expect(linked.googleSub).toBe(`v-${RUN}`);
  });
});
