import crypto from 'crypto';
import { config } from './config';

// Opaque bearer token: >=256 bits CSPRNG entropy, url-safe.
export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

// We only ever persist a digest of tokens/sessions, never the raw value.
export function digest(token: string, salt: string): string {
  return crypto.createHmac('sha256', salt).update(token).digest('hex');
}

export function sessionDigest(token: string): string {
  return digest(token, config.sessionSecret());
}

export function trackingDigest(token: string): string {
  return digest(token, config.trackingReceiptSecret());
}

// Constant-time compare helper.
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Short human booking reference, e.g. "CY-7QK2-4M9X".
export function bookingReference(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n: number) =>
    Array.from({ length: n }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `CY-${pick(4)}-${pick(4)}`;
}
