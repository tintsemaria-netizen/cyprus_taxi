import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => {
  try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; }
})();

import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { base32Encode, base32Decode, totpForStep, matchTotp, timeStep } from '@/lib/totp';
import { beginEnrollment, confirmEnrollment, verifyStaffTotp, disableMfa } from '@/server/staff-mfa';

const LOGIN = `mfa-test-${Date.now()}`;

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await prisma.staffUser.create({ data: { login: LOGIN, passwordHash: await hashPassword('correct-horse-1'), role: 'ADMIN', displayName: 'MFA Test' } });
});
afterAll(async () => {
  await prisma.authSession.deleteMany({ where: { user: { login: LOGIN } } });
  await prisma.staffUser.deleteMany({ where: { login: LOGIN } });
});

describe('TOTP core (RFC 6238)', () => {
  const rfcSecret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the RFC 6238 SHA-1 test vectors (6-digit truncation)', () => {
    expect(rfcSecret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpForStep(rfcSecret, Math.floor(59 / 30))).toBe('287082');
    expect(totpForStep(rfcSecret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpForStep(rfcSecret, Math.floor(1234567890 / 30))).toBe('005924');
    expect(totpForStep(rfcSecret, Math.floor(2000000000 / 30))).toBe('279037');
  });
  it('base32 round-trips and accepts ±1 step of clock drift only', () => {
    expect(base32Decode(rfcSecret).toString()).toBe('12345678901234567890');
    const at = new Date(1_700_000_000_000);
    const s = timeStep(at);
    expect(matchTotp(rfcSecret, totpForStep(rfcSecret, s - 1), at)).toBe(s - 1);
    expect(matchTotp(rfcSecret, totpForStep(rfcSecret, s + 1), at)).toBe(s + 1);
    expect(matchTotp(rfcSecret, totpForStep(rfcSecret, s + 3), at)).toBeNull();
    expect(matchTotp(rfcSecret, 'abcdef', at)).toBeNull();
  });
  it('secrets are encrypted at rest', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP', 'staff-totp-v1');
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(enc, 'staff-totp-v1')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptSecret(enc, 'other-label')).toThrow();
  });
});

describe('staff MFA lifecycle', () => {
  it('enroll → confirm (signs out other sessions) → login code works once → disable', async () => {
    let user = (await prisma.staffUser.findUnique({ where: { login: LOGIN } }))!;
    const { secret, uri, qrSvg } = await beginEnrollment(user);
    expect(uri).toContain('otpauth://totp/');
    expect(qrSvg).toContain('<svg');
    const stored = (await prisma.staffUser.findUnique({ where: { login: LOGIN } }))!;
    expect(stored.totpPendingSecret).not.toContain(secret);

    const t0 = new Date();
    expect(await confirmEnrollment(user, '000000' === totpForStep(secret, timeStep(t0)) ? '111111' : '000000', t0)).toBeNull();
    const enabled = await confirmEnrollment(user, totpForStep(secret, timeStep(t0)), t0);
    expect(enabled?.totpEnabledAt).toBeTruthy();
    expect(enabled!.sessionVersion).toBe(user.sessionVersion + 1);

    // The enrollment code's step is already used — a login code must come from a later step.
    user = (await prisma.staffUser.findUnique({ where: { login: LOGIN } }))!;
    const t1 = new Date(t0.getTime() + 30_000);
    const c1 = totpForStep(secret, timeStep(t1));
    expect(await verifyStaffTotp(user, c1, t1)).toBe(true);
    user = (await prisma.staffUser.findUnique({ where: { login: LOGIN } }))!;
    expect(await verifyStaffTotp(user, c1, t1)).toBe(false); // replay refused

    // Concurrent use of the next code: exactly one wins.
    const t2 = new Date(t0.getTime() + 60_000);
    const c2 = totpForStep(secret, timeStep(t2));
    user = (await prisma.staffUser.findUnique({ where: { login: LOGIN } }))!;
    const race = await Promise.all(Array.from({ length: 5 }, () => verifyStaffTotp(user, c2, t2)));
    expect(race.filter(Boolean).length).toBe(1);

    // Disabling needs the password AND a fresh code.
    user = (await prisma.staffUser.findUnique({ where: { login: LOGIN } }))!;
    const t3 = new Date(t0.getTime() + 90_000);
    const c3 = totpForStep(secret, timeStep(t3));
    expect(await disableMfa(user, 'wrong-password', c3, t3)).toBe(false);
    expect(await disableMfa(user, 'correct-horse-1', '000000' === c3 ? '111111' : '000000', t3)).toBe(false);
    expect(await disableMfa(user, 'correct-horse-1', c3, t3)).toBe(true);
    expect((await prisma.staffUser.findUnique({ where: { login: LOGIN } }))!.totpEnabledAt).toBeNull();
  });
});
