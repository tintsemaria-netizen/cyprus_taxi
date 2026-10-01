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

// ---- Authenticated encryption for stored idempotency responses (SPEC §3) ----
// The response contains a recoverable tracking token, so it must never be stored
// in plaintext. AES-256-GCM with a random 12-byte nonce and a domain-separated
// key derived from TRACKING_RECEIPT_SECRET. Format: "v1:<base64(nonce|tag|ct)>".
const RECEIPT_PREFIX = 'v1:';

function receiptKey(): Buffer {
  // Domain separation so this key differs from the tracking-digest use of the secret.
  return crypto.createHmac('sha256', config.trackingReceiptSecret()).update('idempotency-receipt-key-v1').digest();
}

export function encryptReceipt(plaintext: string): string {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', receiptKey(), nonce);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return RECEIPT_PREFIX + Buffer.concat([nonce, tag, ct]).toString('base64');
}

// Decrypt an encrypted receipt. Legacy compatibility: pre-encryption receipts were
// stored as raw JSON, so if the value is not in the v1 format we return it as-is,
// which also lets an older build keep reading during rollback.
export function decryptReceipt(stored: string): string {
  if (!stored.startsWith(RECEIPT_PREFIX)) return stored; // legacy plaintext JSON
  const raw = Buffer.from(stored.slice(RECEIPT_PREFIX.length), 'base64');
  const nonce = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', receiptKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// Short human booking reference, e.g. "CY-7QK2-4M9X".
export function bookingReference(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n: number) =>
    Array.from({ length: n }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `CY-${pick(4)}-${pick(4)}`;
}

// Generic at-rest encryption for small secrets (e.g. staff TOTP seeds). AES-256-GCM with a key
// derived from the server secret under its own domain label, so it never equals another key.
const SECRET_PREFIX = 'sec1:';
function secretKey(label: string): Buffer {
  return crypto.createHmac('sha256', config.trackingReceiptSecret()).update(`at-rest-secret:${label}`).digest();
}
export function encryptSecret(plaintext: string, label: string): string {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(label), nonce);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return SECRET_PREFIX + Buffer.concat([nonce, cipher.getAuthTag(), ct]).toString('base64');
}
export function decryptSecret(stored: string, label: string): string {
  if (!stored.startsWith(SECRET_PREFIX)) throw new Error('bad secret format');
  const raw = Buffer.from(stored.slice(SECRET_PREFIX.length), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(label), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
