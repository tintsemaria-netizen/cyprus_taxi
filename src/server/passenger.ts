import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { generateToken, sessionDigest } from '@/lib/crypto';
import type { Passenger } from '@prisma/client';

// Passenger account + session (Task 014). Verified phone; owns booking history.
const COOKIE = 'tc_passenger';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const secure = (process.env.APP_BASE_URL || '').startsWith('https');

export async function verifiedPassenger(phone: string): Promise<Passenger> {
  const existing = await prisma.passenger.findUnique({ where: { phone } });
  if (existing) return prisma.passenger.update({ where: { id: existing.id }, data: { phoneVerifiedAt: new Date() } });
  return prisma.passenger.create({ data: { phone, phoneVerifiedAt: new Date() } });
}

export async function createPassengerSession(passengerId: string): Promise<void> {
  const token = generateToken();
  await prisma.passengerSession.create({ data: { passengerId, sessionDigest: sessionDigest(token), expiresAt: new Date(Date.now() + TTL_MS) } });
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: TTL_MS / 1000 });
}

export async function getPassenger(): Promise<Passenger | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const s = await prisma.passengerSession.findUnique({ where: { sessionDigest: sessionDigest(token) } });
  if (!s || s.revokedAt || s.expiresAt < new Date()) return null;
  return prisma.passenger.findUnique({ where: { id: s.passengerId } });
}

export async function destroyPassengerSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await prisma.passengerSession.updateMany({ where: { sessionDigest: sessionDigest(token), revokedAt: null }, data: { revokedAt: new Date() } });
  jar.delete(COOKIE);
}
