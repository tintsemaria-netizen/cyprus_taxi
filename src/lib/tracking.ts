import { cookies } from 'next/headers';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { generateToken, trackingDigest } from './crypto';

// Tracking links are scoped bearer credentials (SPEC §3). We store only a digest,
// scope each grant to one booking, and exchange the fragment token for a
// booking-scoped HttpOnly cookie so raw tokens never hit logs/referrers.

const TRACK_COOKIE = 'tc_track';
const secureCookies = (process.env.APP_BASE_URL || '').startsWith('https');

export interface GrantResult {
  token: string; // returned ONCE at creation for the shareable link
  expiresAt: Date;
}

// Grant lifetime: scheduled pickup (or now) + 24h. Summary access continues up
// to 24h after a terminal state, enforced at read time.
export async function createGrant(bookingId: string, pickupAt: Date): Promise<GrantResult> {
  return createGrantTx(prisma, bookingId, pickupAt);
}

// Transaction-aware variant so grant creation commits atomically with the booking.
export async function createGrantTx(
  tx: Prisma.TransactionClient | typeof prisma,
  bookingId: string,
  pickupAt: Date,
): Promise<GrantResult> {
  const token = generateToken(32);
  const expiresAt = new Date(pickupAt.getTime() + 24 * 60 * 60 * 1000);
  await tx.trackingGrant.create({ data: { bookingId, tokenDigest: trackingDigest(token), expiresAt } });
  return { token, expiresAt };
}

export async function revokeGrantsForBooking(bookingId: string): Promise<void> {
  await prisma.trackingGrant.updateMany({
    where: { bookingId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Exchange a raw fragment token for a booking-scoped cookie session.
export async function exchangeToken(token: string): Promise<string | null> {
  const grant = await prisma.trackingGrant.findUnique({
    where: { tokenDigest: trackingDigest(token) },
  });
  if (!grant || grant.revokedAt || grant.expiresAt < new Date()) return null;
  const jar = await cookies();
  // The cookie carries the same opaque token; server re-derives digest each call.
  jar.set(TRACK_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(1, Math.floor((grant.expiresAt.getTime() - Date.now()) / 1000)),
  });
  return grant.bookingId;
}

// Resolve the current tracking session to a bookingId, re-checking revocation.
export async function getTrackingBookingId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(TRACK_COOKIE)?.value;
  if (!token) return null;
  const grant = await prisma.trackingGrant.findUnique({
    where: { tokenDigest: trackingDigest(token) },
  });
  if (!grant || grant.revokedAt || grant.expiresAt < new Date()) return null;
  return grant.bookingId;
}

export async function clearTrackingCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(TRACK_COOKIE);
}
