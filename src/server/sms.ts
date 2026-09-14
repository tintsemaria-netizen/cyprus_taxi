import { randomInt } from 'crypto';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { sha256 } from '@/lib/crypto';

// Phone OTP transport (Task 015). Twilio Verify holds/checks the code when configured;
// otherwise a dev path stores a hashed code locally (returned only in demo mode, never
// logged in production). Real SMS delivery requires TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN
// + TWILIO_VERIFY_SERVICE_SID.

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export interface SendResult { provider: 'twilio' | 'dev'; devCode?: string }

function twilioAuth(): string {
  return 'Basic ' + Buffer.from(`${config.sms.twilioSid()}:${config.sms.twilioToken()}`).toString('base64');
}

export async function sendOtp(phone: string): Promise<SendResult> {
  if (config.sms.provider === 'twilio') {
    const url = `https://verify.twilio.com/v2/Services/${config.sms.verifyService}/Verifications`;
    const body = new URLSearchParams({ To: phone, Channel: 'sms' });
    const res = await fetch(url, { method: 'POST', headers: { Authorization: twilioAuth(), 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) throw new Error(`twilio-send:${res.status}`);
    return { provider: 'twilio' };
  }
  // dev: generate + persist a hashed code.
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.phoneVerification.create({ data: { phone, codeHash: sha256(code), provider: 'dev', expiresAt: new Date(Date.now() + OTP_TTL_MS) } });
  return { provider: 'dev', devCode: config.demoMode ? code : undefined };
}

export async function checkOtp(phone: string, code: string): Promise<boolean> {
  if (!/^\d{4,8}$/.test(code)) return false;
  if (config.sms.provider === 'twilio') {
    const url = `https://verify.twilio.com/v2/Services/${config.sms.verifyService}/VerificationCheck`;
    const body = new URLSearchParams({ To: phone, Code: code });
    const res = await fetch(url, { method: 'POST', headers: { Authorization: twilioAuth(), 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) return false;
    const d = (await res.json()) as { status?: string };
    return d.status === 'approved';
  }
  // dev: newest unconsumed, unexpired challenge; bounded attempts.
  const v = await prisma.phoneVerification.findFirst({ where: { phone, provider: 'dev', consumedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!v || v.expiresAt < new Date() || v.attempts >= MAX_ATTEMPTS) return false;
  if (v.codeHash !== sha256(code)) {
    await prisma.phoneVerification.update({ where: { id: v.id }, data: { attempts: { increment: 1 } } });
    return false;
  }
  await prisma.phoneVerification.update({ where: { id: v.id }, data: { consumedAt: new Date() } });
  return true;
}
