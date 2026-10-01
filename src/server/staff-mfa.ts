import QRCode from 'qrcode';
import type { StaffUser } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { generateTotpSecret, matchTotp, otpauthUri } from '@/lib/totp';
import { verifyPassword } from '@/lib/auth';

// Staff two-factor (TOTP) for privileged roles (2026-10-01 audit Stage 1.2).

const LABEL = 'staff-totp-v1';
export const MFA_ROLES = ['ADMIN', 'DISPATCHER'] as const;

export function isPrivileged(u: Pick<StaffUser, 'role'>): boolean {
  return (MFA_ROLES as readonly string[]).includes(u.role);
}

// Enforcement: a privileged account WITHOUT TOTP may only reach the enrollment endpoints.
export function mfaSetupRequired(u: Pick<StaffUser, 'role' | 'totpEnabledAt'>): boolean {
  return config.staffMfaEnforce && isPrivileged(u) && !u.totpEnabledAt;
}

export async function beginEnrollment(user: StaffUser): Promise<{ secret: string; uri: string; qrSvg: string }> {
  const secret = generateTotpSecret();
  await prisma.staffUser.update({ where: { id: user.id }, data: { totpPendingSecret: encryptSecret(secret, LABEL) } });
  const uri = otpauthUri(secret, user.login);
  const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { secret, uri, qrSvg };
}

// Confirms the pending secret with a current code; enables TOTP and bumps sessionVersion so every
// OTHER existing session (created without the second factor) is logged out. Returns the updated user.
export async function confirmEnrollment(user: StaffUser, code: string, at: Date = new Date()): Promise<StaffUser | null> {
  const fresh = await prisma.staffUser.findUnique({ where: { id: user.id } });
  if (!fresh?.totpPendingSecret) return null;
  const secret = decryptSecret(fresh.totpPendingSecret, LABEL);
  const step = matchTotp(secret, code, at);
  if (step === null) return null;
  return prisma.staffUser.update({
    where: { id: user.id },
    data: {
      totpSecret: fresh.totpPendingSecret, totpPendingSecret: null, totpEnabledAt: at, totpLastStep: step,
      sessionVersion: { increment: 1 },
    },
  });
}

// Verifies a login code. Atomic replay protection: a code's time step can be used at most once,
// even by concurrent requests (conditional update on totpLastStep).
export async function verifyStaffTotp(user: StaffUser, code: string, at: Date = new Date()): Promise<boolean> {
  if (!user.totpSecret || !user.totpEnabledAt) return false;
  const step = matchTotp(decryptSecret(user.totpSecret, LABEL), code, at);
  if (step === null) return false;
  const r = await prisma.staffUser.updateMany({
    where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  return r.count === 1;
}

// Turning 2FA off needs BOTH the password and a current code (a stolen session alone can't).
export async function disableMfa(user: StaffUser, password: string, code: string, at: Date = new Date()): Promise<boolean> {
  const fresh = await prisma.staffUser.findUnique({ where: { id: user.id } });
  if (!fresh || !(await verifyPassword(password, fresh.passwordHash))) return false;
  if (!(await verifyStaffTotp(fresh, code, at))) return false;
  await prisma.staffUser.update({
    where: { id: user.id },
    data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null },
  });
  return true;
}
