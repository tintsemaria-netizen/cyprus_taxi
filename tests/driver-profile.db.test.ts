import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { isValidIban, normalizeIban, formatIban } from '@/lib/iban';
import { driverProfile, updateDriverProfile, phoneTaken, changeDriverPhone, newEmailCode, checkEmailCode, normalizeEmail } from '@/server/driver/profile';
import { driverReliability } from '@/server/admin/reliability';

// Driver profile (2026-11-27, operator): own data, emergency contact, IBAN, phone / e-mail change with a code,
// and «Моя надёжность» from the same function as the admin's.
const dbUrl = process.env.DATABASE_URL || '';
let driverId = '', userId = '', origPhone = '', origLogin = '';

beforeAll(async () => {
  if (!new URL(dbUrl).pathname.endsWith('_test')) throw new Error('Refusing: not a _test database.');
  const d = await prisma.driver.findFirst({ where: { publicName: 'Maria' }, include: { user: true } });
  if (!d) throw new Error('fixture Maria missing');
  driverId = d.id; userId = d.userId; origPhone = d.phone; origLogin = d.user.login;
});
afterAll(async () => {
  await prisma.driver.update({ where: { id: driverId }, data: { phone: origPhone, emergencyName: null, emergencyPhone: null, iban: null, ibanHolder: null } });
  await prisma.staffUser.update({ where: { id: userId }, data: { login: origLogin } });
});

describe('IBAN', () => {
  it('checks the mod-97 sum and the Cyprus length; stores without spaces, shows in fours', () => {
    expect(isValidIban('CY17 0020 0128 0000 0012 0052 7600')).toBe(true);
    expect(isValidIban('CY18 0020 0128 0000 0012 0052 7600')).toBe(false);
    expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(isValidIban('CY17 0020 0128')).toBe(false);
    expect(normalizeIban(' cy17 0020 0128 0000 0012 0052 7600 ')).toBe('CY17002001280000001200527600');
    expect(formatIban('CY17002001280000001200527600')).toBe('CY17 0020 0128 0000 0012 0052 7600');
  });
});

describe('driver profile', () => {
  it('saves the emergency contact and a valid IBAN; refuses a wrong IBAN or phone', async () => {
    expect(await updateDriverProfile(driverId, { iban: 'CY18 0020 0128 0000 0012 0052 7600' })).toEqual({ iban: 'IBAN' });
    expect(await updateDriverProfile(driverId, { emergencyPhone: '12' })).toEqual({ emergencyPhone: 'PHONE' });
    expect(await updateDriverProfile(driverId, { emergencyName: ' Anna (wife) ', emergencyPhone: '+357 99 111222', iban: 'cy17 0020 0128 0000 0012 0052 7600', ibanHolder: 'Maria K' })).toBeNull();
    const p = await driverProfile(driverId);
    expect(p).toMatchObject({ emergencyName: 'Anna (wife)', emergencyPhone: '+35799111222', iban: 'CY17002001280000001200527600', ibanHolder: 'Maria K' });
    expect(await updateDriverProfile(driverId, { iban: '' })).toBeNull();
    expect((await driverProfile(driverId))!.iban).toBeNull();
  });

  it('a new phone must be free; the change moves the sign-in too', async () => {
    const other = await prisma.driver.findFirst({ where: { publicName: 'Andreas' }, include: { user: true } });
    expect(await phoneTaken(driverId, other!.user.login)).toBe(true);
    const fresh = `+3579${String(Date.now()).slice(-7)}`;
    expect(await phoneTaken(driverId, fresh)).toBe(false);
    await changeDriverPhone(driverId, fresh);
    const d = await prisma.driver.findUnique({ where: { id: driverId }, include: { user: true } });
    expect([d!.phone, d!.user.login]).toEqual([fresh, fresh]);
  });

  it('e-mail code: 6 digits, single use, wrong codes count', async () => {
    const email = normalizeEmail(' Driver.Test@Example.com ')!;
    expect(email).toBe('driver.test@example.com');
    expect(normalizeEmail('nope')).toBeNull();
    const code = await newEmailCode(email);
    expect(await checkEmailCode(email, code === '000000' ? '111111' : '000000')).toBe(false);
    expect(await checkEmailCode(email, code)).toBe(true);
    expect(await checkEmailCode(email, code)).toBe(false); // used
  });

  it('«Моя надёжность» is the admin row for this one driver', async () => {
    const to = new Date(), from = new Date(to.getTime() - 30 * 86_400_000);
    const one = await driverReliability(from, to, driverId);
    expect(one).toHaveLength(1);
    const all = await driverReliability(from, to);
    expect(all.find((r) => r.driverId === driverId)?.offers).toEqual(one[0].offers);
  });
});

import { reportMonthly } from '@/server/reports/driver-report';
describe('monthly statement (2026-11-28)', () => {
  it('a Cyprus calendar month: from the 1st, earnings, trips, km; a future month falls back to this one', async () => {
    const r = await reportMonthly(driverId, new URL('http://x/?month=2026-02'));
    expect(r.month).toBe('2026-02');
    expect(r.from).toBe('2026-01-31T22:00:00.000Z'); // 1 Feb 00:00 Cyprus (UTC+2)
    expect(r.driver?.name).toBe('Maria');
    expect(typeof r.km).toBe('number');
    expect(Array.isArray(r.summary.byCurrency)).toBe(true);
    const bad = await reportMonthly(driverId, new URL('http://x/?month=2999-01'));
    expect(bad.month).not.toBe('2999-01');
  });
});
