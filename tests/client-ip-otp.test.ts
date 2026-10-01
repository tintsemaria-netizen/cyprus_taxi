import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clientIp } from '@/lib/http';

const req = (xff?: string, realIp?: string) =>
  new Request('http://x/', { headers: { ...(xff ? { 'x-forwarded-for': xff } : {}), ...(realIp ? { 'x-real-ip': realIp } : {}) } });
const CF_EDGE = '162.158.1.1'; // inside Cloudflare 162.158.0.0/15

describe('clientIp (rate-limit identity)', () => {
  it('via Cloudflare: returns the client CF appended, not the edge', () => {
    expect(clientIp(req(`203.0.113.7, ${CF_EDGE}`), 1)).toBe('203.0.113.7');
  });
  it('ignores a client-forged X-Forwarded-For prefix', () => {
    expect(clientIp(req(`1.2.3.4, 203.0.113.7, ${CF_EDGE}`), 1)).toBe('203.0.113.7');
    expect(clientIp(req(`9.9.9.9, 8.8.8.8, 203.0.113.7, ${CF_EDGE}`), 1)).toBe('203.0.113.7');
  });
  it('a forged Cloudflare-looking prefix does not help', () => {
    expect(clientIp(req(`173.245.48.5, 203.0.113.7, ${CF_EDGE}`), 1)).toBe('203.0.113.7');
  });
  it('direct-to-origin (bypassing Cloudflare): returns the real caller, not the forged value', () => {
    expect(clientIp(req('1.2.3.4, 198.51.100.9'), 1)).toBe('198.51.100.9');
  });
  it('a client whose own egress is a Cloudflare IP (e.g. WARP) cannot smuggle a forged address', () => {
    expect(clientIp(req(`5.5.5.5, 104.28.1.2, ${CF_EDGE}`), 1)).toBe('104.28.1.2');
  });
  it('IPv6 Cloudflare edge is skipped', () => {
    expect(clientIp(req('2001:db8::1, 2606:4700::1'), 1)).toBe('2001:db8::1');
  });
  it('falls back to X-Real-IP, then unknown', () => {
    expect(clientIp(req(undefined, '198.51.100.2'), 1)).toBe('198.51.100.2');
    expect(clientIp(req(), 1)).toBe('unknown');
  });
});

describe('dev OTP is never handed to an arbitrary caller', () => {
  beforeEach(() => { vi.resetModules(); });
  async function loadSms(env: Record<string, string>) {
    for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SMS_DEV_OTP_ALLOWLIST']) delete process.env[k];
    Object.assign(process.env, { DEMO_MODE: 'true', SMS_ALLOW_DEV_OTP: 'true', ...env });
    return import('@/server/sms');
  }
  it('empty allowlist: sendOtp is unavailable and checkOtp rejects, even in demo mode', async () => {
    const sms = await loadSms({});
    await expect(sms.sendOtp('+35799000001')).rejects.toThrow('sms-unconfigured');
    expect(await sms.checkOtp('+35799000001', '123456')).toBe(false);
  });
  it('a phone outside the allowlist is refused', async () => {
    const sms = await loadSms({ SMS_DEV_OTP_ALLOWLIST: '+35799000002' });
    await expect(sms.sendOtp('+35799000001')).rejects.toThrow('sms-unconfigured');
    expect(await sms.checkOtp('+35799000001', '123456')).toBe(false);
  });
});
