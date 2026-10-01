import crypto from 'crypto';

// RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits) — what Google Authenticator, 1Password, Authy etc.
// use by default. Pure functions; persistence/replay protection live in src/server/staff-mfa.ts.

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20)); // 160-bit, RFC 4226 recommendation
}

export function timeStep(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 1000 / STEP_SECONDS);
}

export function totpForStep(secretB32: string, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

// Returns the matching time step (±1 step for clock drift) or null. Constant-time compare.
export function matchTotp(secretB32: string, code: string, at: Date = new Date(), window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = timeStep(at);
  let found: number | null = null;
  for (let d = -window; d <= window; d++) {
    const expected = totpForStep(secretB32, now + d);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code)) && found === null) found = now + d;
  }
  return found;
}

export function otpauthUri(secretB32: string, account: string, issuer = 'IL-Y'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
