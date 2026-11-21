import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

// 2026-11-21: http://il-y.taxi (Cloudflare → nginx → app) must go to https, or the Secure login cookie is dropped.
const r = (url: string, scheme?: string, method = 'GET') =>
  new NextRequest(url, { method, headers: { host: 'il-y.taxi', ...(scheme ? { 'cf-visitor': `{"scheme":"${scheme}"}` } : {}) } });

describe('plain-http visitors go to https', () => {
  it('redirects GET over http with path and query kept', () => {
    const res = proxy(r('https://il-y.taxi/staff/login?next=%2Fadmin', 'http'));
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('https://il-y.taxi/staff/login?next=%2Fadmin');
  });
  it('leaves https and direct (no Cloudflare) requests alone; https gets HSTS', () => {
    const https = proxy(r('https://il-y.taxi/staff/login', 'https'));
    expect(https.status).toBe(200);
    expect(https.headers.get('strict-transport-security')).toContain('max-age=');
    const direct = proxy(r('http://localhost:3000/staff/login'));
    expect(direct.status).toBe(200);
    expect(direct.headers.get('strict-transport-security')).toBeNull();
  });
});
