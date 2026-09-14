import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { generateToken, sessionDigest } from '@/lib/crypto';
import type { DriverApplicant } from '@prisma/client';

// Driver-applicant identity + session (Task 015). Separate from StaffUser so an
// application can NEVER by itself grant operational driver privileges.
const COOKIE = 'tc_applicant';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (onboarding can span days)
const secure = (process.env.APP_BASE_URL || '').startsWith('https');

export function normalizePhone(raw: string): string | null {
  const t = (raw || '').replace(/[^\d+]/g, '');
  return /^\+\d{7,15}$/.test(t) ? t : null; // E.164 international
}

// Create-or-fetch the applicant for a just-verified phone; stamps phoneVerifiedAt.
export async function verifiedApplicant(phone: string): Promise<DriverApplicant> {
  const existing = await prisma.driverApplicant.findUnique({ where: { phone } });
  if (existing) return prisma.driverApplicant.update({ where: { id: existing.id }, data: { phoneVerifiedAt: new Date() } });
  return prisma.driverApplicant.create({ data: { phone, phoneVerifiedAt: new Date() } });
}

export async function createApplicantSession(applicantId: string): Promise<void> {
  const token = generateToken();
  await prisma.applicantSession.create({ data: { applicantId, sessionDigest: sessionDigest(token), expiresAt: new Date(Date.now() + TTL_MS) } });
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: TTL_MS / 1000 });
}

export async function getApplicant(): Promise<DriverApplicant | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const s = await prisma.applicantSession.findUnique({ where: { sessionDigest: sessionDigest(token) } });
  if (!s || s.revokedAt || s.expiresAt < new Date()) return null;
  return prisma.driverApplicant.findUnique({ where: { id: s.applicantId } });
}

export async function destroyApplicantSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await prisma.applicantSession.updateMany({ where: { sessionDigest: sessionDigest(token), revokedAt: null }, data: { revokedAt: new Date() } });
  jar.delete(COOKIE);
}
