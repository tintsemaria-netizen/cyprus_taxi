import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { generateToken, sessionDigest } from './crypto';
import { Role, StaffUser } from '@prisma/client';

const STAFF_COOKIE = 'tc_staff';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

const secureCookies = (process.env.APP_BASE_URL || '').startsWith('https');

export async function createStaffSession(user: StaffUser): Promise<void> {
  const token = generateToken();
  await prisma.authSession.create({
    data: {
      sessionDigest: sessionDigest(token),
      userId: user.id,
      sessionVersion: user.sessionVersion,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  const jar = await cookies();
  jar.set(STAFF_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroyStaffSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(STAFF_COOKIE)?.value;
  if (token) {
    await prisma.authSession.updateMany({
      where: { sessionDigest: sessionDigest(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  jar.delete(STAFF_COOKIE);
}

export interface StaffContext {
  user: StaffUser;
}

// Returns the authenticated staff user, honouring expiry/revocation and
// sessionVersion (bumped on password reset / deactivation → instant logout).
export async function getStaff(): Promise<StaffContext | null> {
  const jar = await cookies();
  const token = jar.get(STAFF_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.authSession.findUnique({
    where: { sessionDigest: sessionDigest(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (!session.user.active) return null;
  if (session.sessionVersion !== session.user.sessionVersion) return null;
  return { user: session.user };
}

export async function requireStaff(roles?: Role[]): Promise<StaffContext | { error: 401 | 403 }> {
  const ctx = await getStaff();
  if (!ctx) return { error: 401 };
  if (roles && !roles.includes(ctx.user.role)) return { error: 403 };
  return ctx;
}

export function isStaffCtx(v: StaffContext | { error: 401 | 403 }): v is StaffContext {
  return (v as StaffContext).user !== undefined;
}
