// Launch fixes §3 (2026-11-19): what the running service actually has — for staff, never secrets.
// Each dependency reports ok / warn / missing plus a plain note. Used by GET /admin/system and the
// boot check in instrumentation (production refuses to start without its required secrets).
import { config } from '@/lib/config';
import { emailConfigured } from '@/server/email/provider';
import { scannerConfigured, scanFile } from '@/server/scan';
import { googleConfigured } from '@/server/google';

export type DepState = 'ok' | 'warn' | 'missing';
export interface Dep { key: string; state: DepState; note: string }

const has = (name: string) => !!(process.env[name] && process.env[name]!.length > 0);

/** Required secrets (names only). Production must not start without them. */
export function missingRequiredSecrets(): string[] {
  return ['SESSION_SECRET', 'TRACKING_RECEIPT_SECRET', 'DATABASE_URL'].filter((n) => !has(n));
}

export async function systemStatus(opts: { probeScanner?: boolean } = {}): Promise<{ env: string; production: boolean; deps: Dep[] }> {
  const deps: Dep[] = [];
  const miss = missingRequiredSecrets();
  deps.push(miss.length ? { key: 'secrets', state: 'missing', note: `Missing: ${miss.join(', ')}` } : { key: 'secrets', state: 'ok', note: 'Session, tracking and database secrets are set.' });

  if (config.sms.provider === 'twilio') deps.push({ key: 'sms', state: 'ok', note: 'Twilio Verify configured.' });
  else if (config.sms.allowDevOtp) deps.push({ key: 'sms', state: 'warn', note: `TEST codes only, for ${config.sms.devOtpAllowlist.size} allow-listed number(s). Not for real passengers.` });
  else deps.push({ key: 'sms', state: 'missing', note: 'No SMS provider: phone verification and driver sign-in by code are unavailable.' });

  if (!scannerConfigured()) deps.push({ key: 'malwareScan', state: 'missing', note: 'No ClamAV: driver documents cannot be accepted or approved.' });
  else if (opts.probeScanner) {
    const st = await scanFile(Buffer.from('il-y readiness probe'));
    deps.push(st === 'CLEAN' ? { key: 'malwareScan', state: 'ok', note: 'ClamAV reachable.' } : { key: 'malwareScan', state: 'warn', note: `ClamAV configured but answered ${st}.` });
  } else deps.push({ key: 'malwareScan', state: 'ok', note: 'ClamAV configured.' });

  deps.push(emailConfigured() ? { key: 'email', state: 'ok', note: 'Receipt e-mail provider configured.' } : { key: 'email', state: 'warn', note: 'No e-mail provider: receipt e-mails are skipped (in-app receipts still work).' });
  deps.push(config.push.vapidPublic && config.push.vapidPrivate() ? { key: 'push', state: 'ok', note: 'Web push keys set.' } : { key: 'push', state: 'warn', note: 'No web push keys: no background notifications.' });
  deps.push(googleConfigured() ? { key: 'maps', state: 'ok', note: 'Google Maps server key set.' } : { key: 'maps', state: 'warn', note: 'No Google server key: road ETAs fall back to estimates.' });

  deps.push(config.passengerTestMode ? { key: 'passengerTestMode', state: 'warn', note: 'ON — orders without a verified phone are allowed (testing only).' } : { key: 'passengerTestMode', state: 'ok', note: 'Off — real orders need an SMS-verified phone.' });
  deps.push({ key: 'rideShare', state: config.share.enabled ? 'warn' : 'ok', note: config.share.enabled ? 'ON — ride-share offered to passengers.' : 'Off — no new shared rides.' });
  deps.push(config.staffMfaEnforce ? { key: 'staffMfa', state: 'ok', note: 'Staff two-factor enforced.' } : { key: 'staffMfa', state: 'warn', note: 'Staff two-factor NOT enforced (set APP_ENV=production or STAFF_MFA_ENFORCE=true).' });
  deps.push(config.demoMode ? { key: 'demoMode', state: 'warn', note: 'DEMO_MODE on: place/route fixtures may be used.' } : { key: 'demoMode', state: 'ok', note: 'Demo fixtures off.' });
  return { env: config.env, production: config.isProduction, deps };
}
