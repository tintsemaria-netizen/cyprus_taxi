// Launch fixes §3 (2026-11-19): what the running service actually has — for staff, never secrets.
// Each dependency reports ok / warn / missing plus a plain note. Used by GET /admin/system and the
// boot check in instrumentation (production refuses to start without its required secrets).
import { config } from '@/lib/config';
import { emailConfigured } from '@/server/email/provider';
import { scannerConfigured, scanFile } from '@/server/scan';
import { googleConfigured } from '@/server/google';

export type DepState = 'ok' | 'warn' | 'missing';
/** `note` is a text key (staff.alerts.dep.<note>) so staff read it in their language; `n` fills {n}. */
export interface Dep { key: string; state: DepState; note: string; n?: number; names?: string }

const has = (name: string) => !!(process.env[name] && process.env[name]!.length > 0);

/** Required secrets (names only). Production must not start without them. */
export function missingRequiredSecrets(): string[] {
  return ['SESSION_SECRET', 'TRACKING_RECEIPT_SECRET', 'DATABASE_URL'].filter((n) => !has(n));
}

export async function systemStatus(opts: { probeScanner?: boolean } = {}): Promise<{ env: string; production: boolean; deps: Dep[] }> {
  const deps: Dep[] = [];
  const miss = missingRequiredSecrets();
  deps.push(miss.length ? { key: 'secrets', state: 'missing', note: 'secretsMissing', names: miss.join(', ') } : { key: 'secrets', state: 'ok', note: 'secretsOk' });

  if (config.sms.provider === 'twilio') deps.push({ key: 'sms', state: 'ok', note: 'smsTwilio' });
  else if (config.sms.allowDevOtp) deps.push({ key: 'sms', state: 'warn', note: 'smsTest', n: config.sms.devOtpAllowlist.size });
  else deps.push({ key: 'sms', state: 'missing', note: 'smsNone' });

  if (!scannerConfigured()) deps.push({ key: 'malwareScan', state: 'missing', note: 'scanNone' });
  else if (opts.probeScanner) {
    const st = await scanFile(Buffer.from('il-y readiness probe'));
    deps.push(st === 'CLEAN' ? { key: 'malwareScan', state: 'ok', note: 'scanOk' } : { key: 'malwareScan', state: 'warn', note: 'scanBad', names: st });
  } else deps.push({ key: 'malwareScan', state: 'ok', note: 'scanSet' });

  deps.push(emailConfigured() ? { key: 'email', state: 'ok', note: 'emailOk' } : { key: 'email', state: 'warn', note: 'emailNone' });
  deps.push(config.push.vapidPublic && config.push.vapidPrivate() ? { key: 'push', state: 'ok', note: 'pushOk' } : { key: 'push', state: 'warn', note: 'pushNone' });
  deps.push(googleConfigured() ? { key: 'maps', state: 'ok', note: 'mapsOk' } : { key: 'maps', state: 'warn', note: 'mapsNone' });

  deps.push(config.staffMfaEnforce ? { key: 'staffMfa', state: 'ok', note: 'mfaOn' } : { key: 'staffMfa', state: 'warn', note: 'mfaOff' });
  deps.push(config.demoMode ? { key: 'demoMode', state: 'warn', note: 'demoOn' } : { key: 'demoMode', state: 'ok', note: 'demoOff' });
  return { env: config.env, production: config.isProduction, deps };
}
