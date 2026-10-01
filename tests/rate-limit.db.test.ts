import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => {
  try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; }
})();

import { prisma } from '@/lib/db';
import { rateLimit, pruneRateLimits } from '@/lib/rate-limit';

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await prisma.$queryRaw`SELECT 1`;
});
beforeEach(async () => {
  await prisma.rateLimitBucket.deleteMany({});
  await prisma.phoneVerification.deleteMany({ where: { phone: '+35799000777' } });
});

describe('atomic rate limiter (2026-10-01 audit Stage 1.1)', () => {
  it('a concurrent burst is counted request-by-request (only `limit` pass)', async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => rateLimit('burst', '203.0.113.9', 5, 60)));
    expect(results.filter((r) => r.ok).length).toBe(5);
    expect(results.filter((r) => !r.ok).every((r) => r.retryAfter >= 1)).toBe(true);
    const row = await prisma.rateLimitBucket.findUnique({ where: { key: 'burst:203.0.113.9' } });
    expect(row!.count).toBe(30);
  });

  it('an expired window resets to 1 and old buckets are pruned', async () => {
    await prisma.rateLimitBucket.create({ data: { key: 'win:x', count: 99, resetAt: new Date(Date.now() - 1000) } });
    const r = await rateLimit('win', 'x', 5, 60);
    expect(r.ok).toBe(true);
    expect((await prisma.rateLimitBucket.findUnique({ where: { key: 'win:x' } }))!.count).toBe(1);
    await prisma.rateLimitBucket.create({ data: { key: 'old:y', count: 3, resetAt: new Date(Date.now() - 60_000) } });
    expect(await pruneRateLimits()).toBeGreaterThanOrEqual(1);
    expect(await prisma.rateLimitBucket.findUnique({ where: { key: 'old:y' } })).toBeNull();
  });

  it('parallel dev-OTP guesses cannot exceed the attempt limit', async () => {
    vi.resetModules();
    Object.assign(process.env, { SMS_ALLOW_DEV_OTP: 'true', SMS_DEV_OTP_ALLOWLIST: '+35799000777' });
    delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN;
    const sms = await import('@/server/sms');
    const { devCode } = await sms.sendOtp('+35799000777');
    const wrong = devCode === '000000' ? '111111' : '000000';
    const guesses = await Promise.all(Array.from({ length: 20 }, () => sms.checkOtp('+35799000777', wrong)));
    expect(guesses.every((g) => g === false)).toBe(true);
    const v = await prisma.phoneVerification.findFirst({ where: { phone: '+35799000777' }, orderBy: { createdAt: 'desc' } });
    expect(v!.attempts).toBeLessThanOrEqual(5);
    // Locked out now: even the right code fails.
    expect(await sms.checkOtp('+35799000777', devCode!)).toBe(false);
  });
});
