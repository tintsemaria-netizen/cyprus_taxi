import { randomInt } from 'crypto';
import { sha256 } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { isValidIban, normalizeIban } from '@/lib/iban';
import { normalizePhone } from '@/server/applicant';

// Driver profile (2026-11-27, operator): his own data, the emergency contact and payout details.
// Phone and e-mail change only through a code (routes under /driver/profile/phone|email).

export interface DriverProfile {
  name: string;
  phone: string;
  email: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  iban: string | null;
  ibanHolder: string | null;
  /** Drivers registered through the app have an application record that holds the e-mail. */
  emailEditable: boolean;
}

export async function applicantOfDriver(driverId: string) {
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { applicationId: true } });
  if (!d?.applicationId) return null;
  const app = await prisma.driverApplication.findUnique({ where: { id: d.applicationId }, select: { applicant: true } });
  return app?.applicant ?? null;
}

export async function driverProfile(driverId: string): Promise<DriverProfile | null> {
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { publicName: true, phone: true, emergencyName: true, emergencyPhone: true, iban: true, ibanHolder: true } });
  if (!d) return null;
  const a = await applicantOfDriver(driverId);
  return { name: d.publicName, phone: d.phone, email: a?.email ?? null, emergencyName: d.emergencyName, emergencyPhone: d.emergencyPhone, iban: d.iban, ibanHolder: d.ibanHolder, emailEditable: !!a };
}

export type ProfilePatch = { emergencyName?: string | null; emergencyPhone?: string | null; iban?: string | null; ibanHolder?: string | null };

/** Validates and saves the free fields. Returns field errors (codes) or null. */
export async function updateDriverProfile(driverId: string, p: ProfilePatch): Promise<Record<string, string> | null> {
  const errs: Record<string, string> = {};
  const data: ProfilePatch = {};
  const clean = (v: string | null | undefined, max: number) => (v == null ? v : v.trim().slice(0, max) || null);
  if (p.emergencyName !== undefined) data.emergencyName = clean(p.emergencyName, 80);
  if (p.emergencyPhone !== undefined) {
    const v = clean(p.emergencyPhone, 30);
    if (v) { const n = normalizePhone(v); if (!n) errs.emergencyPhone = 'PHONE'; else data.emergencyPhone = n; } else data.emergencyPhone = null;
  }
  if (p.iban !== undefined) {
    const v = clean(p.iban, 50);
    if (v) { if (!isValidIban(v)) errs.iban = 'IBAN'; else data.iban = normalizeIban(v); } else data.iban = null;
  }
  if (p.ibanHolder !== undefined) data.ibanHolder = clean(p.ibanHolder, 80);
  if (Object.keys(errs).length) return errs;
  await prisma.driver.update({ where: { id: driverId }, data });
  return null;
}

// ---- Phone change (SMS code to the NEW number) ----
/** The new number must not belong to another account (driver login, applicant). */
export async function phoneTaken(driverId: string, phone: string): Promise<boolean> {
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { userId: true } });
  const u = await prisma.staffUser.findUnique({ where: { login: phone }, select: { id: true } });
  if (u && u.id !== d?.userId) return true;
  const own = await applicantOfDriver(driverId);
  const a = await prisma.driverApplicant.findUnique({ where: { phone }, select: { id: true } });
  return !!a && a.id !== own?.id;
}

/** After the code proved the new number: login, contact phone and the applicant record move together. */
export async function changeDriverPhone(driverId: string, phone: string): Promise<void> {
  const own = await applicantOfDriver(driverId);
  await prisma.$transaction(async (tx) => {
    const d = await tx.driver.update({ where: { id: driverId }, data: { phone }, select: { userId: true } });
    await tx.staffUser.update({ where: { id: d.userId }, data: { login: phone } });
    if (own) await tx.driverApplicant.update({ where: { id: own.id }, data: { phone, phoneVerifiedAt: new Date() } });
  });
}

// ---- E-mail change (code by e-mail) ----
// The code is kept like a phone code (PhoneVerification, provider 'email', key `email:<address>`), hashed,
// 10 minutes, 5 attempts, single use.

const EMAIL_TTL_MS = 10 * 60 * 1000;
const emailKey = (email: string) => `email:${email.toLowerCase()}`;

export function normalizeEmail(raw: string): string | null {
  const e = (raw || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 200 ? e : null;
}

export async function newEmailCode(email: string): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.phoneVerification.create({ data: { phone: emailKey(email), codeHash: sha256(code), provider: 'email', expiresAt: new Date(Date.now() + EMAIL_TTL_MS) } });
  return code;
}

export async function checkEmailCode(email: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const v = await prisma.phoneVerification.findFirst({ where: { phone: emailKey(email), provider: 'email', consumedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!v || v.expiresAt < new Date() || v.attempts >= 5) return false;
  const claimed = await prisma.phoneVerification.updateMany({ where: { id: v.id, consumedAt: null, attempts: { lt: 5 } }, data: { attempts: { increment: 1 } } });
  if (claimed.count === 0 || v.codeHash !== sha256(code)) return false;
  const used = await prisma.phoneVerification.updateMany({ where: { id: v.id, consumedAt: null }, data: { consumedAt: new Date() } });
  return used.count === 1;
}

export async function changeDriverEmail(driverId: string, email: string): Promise<boolean> {
  const own = await applicantOfDriver(driverId);
  if (!own) return false;
  await prisma.driverApplicant.update({ where: { id: own.id }, data: { email } });
  return true;
}
