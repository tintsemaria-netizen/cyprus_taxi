'use client';

import { useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { PasswordInput } from '@/components/PasswordInput';

export const dynamic = 'force-dynamic';

interface Me { mfa?: { eligible: boolean; enabled: boolean; setupRequired: boolean } }

// Two-factor (TOTP) for admins and dispatchers (2026-10-01 audit Stage 1.2).
function Security() {
  const { t } = useT();
  const [me, setMe] = useState<Me | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<Me>('/auth/me').then(setMe).catch(() => {});
  useEffect(() => { load(); }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ kind: 'err', text: e instanceof ApiRequestError ? e.body.message : t('staff.sec.failed') }); }
    finally { setBusy(false); }
  }

  const start = () => run(async () => { setSetup(await api('/auth/mfa/setup', { method: 'POST' })); setCode(''); });
  const enable = () => run(async () => {
    await api('/auth/mfa/enable', { method: 'POST', body: { code } });
    setSetup(null); setCode(''); setMsg({ kind: 'ok', text: t('staff.sec.enabled') }); await load();
  });
  const disable = () => run(async () => {
    await api('/auth/mfa/disable', { method: 'POST', body: { password, code } });
    setPassword(''); setCode(''); setMsg({ kind: 'ok', text: t('staff.sec.disabled') }); await load();
  });

  const mfa = me?.mfa;
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-bold">{t('staff.sec.title')}</h1>
      {mfa?.setupRequired && (
        <p className="rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{t('staff.sec.required')}</p>
      )}
      {msg && <p role="status" className={`rounded-[12px] border px-3 py-2 text-sm ${msg.kind === 'ok' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-danger/40 bg-danger/10 text-danger'}`}>{msg.text}</p>}

      <section className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{t('staff.sec.tfa')}</h2>
          <span className={`chip ${mfa?.enabled ? 'text-accent' : 'text-muted'}`}>{mfa ? (mfa.enabled ? t('staff.sec.on') : t('staff.sec.off')) : '…'}</span>
        </div>
        <p className="mt-1 text-sm text-muted">{t('staff.sec.explain')}</p>

        {mfa && !mfa.eligible && <p className="mt-3 text-sm text-muted">{t('staff.sec.notAvailable')}</p>}

        {mfa?.eligible && !mfa.enabled && !setup && (
          <button className="btn-primary mt-4 w-full" disabled={busy} onClick={start}>{t('staff.sec.setup')}</button>
        )}

        {setup && (
          <div className="mt-4 space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>{t('staff.sec.step1')}</li>
              <li>{t('staff.sec.step2')}</li>
              <li>{t('staff.sec.step3')}</li>
            </ol>
            {/* SVG produced server-side by the qrcode library from our own otpauth URI. */}
            <div className="mx-auto w-48 rounded-[12px] bg-white p-2" aria-label={t('staff.sec.qrAria')} dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
            <div className="rounded-[12px] border border-edge bg-elevated px-3 py-2 text-center font-mono text-sm tracking-wider break-all" aria-label={t('staff.sec.keyAria')}>{setup.secret.match(/.{1,4}/g)?.join(' ')}</div>
            <a href={setup.uri} className="block text-center text-xs text-accent hover:underline">{t('staff.sec.openApp')}</a>
            <label className="label" htmlFor="code">{t('staff.sec.code')}</label>
            <input id="code" className="field text-center font-mono text-lg tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <button className="btn-primary w-full" disabled={busy || code.length !== 6} onClick={enable}>{busy ? t('staff.sec.checking') : t('staff.sec.turnOn')}</button>
            <button className="block w-full text-center text-xs text-muted hover:text-ink" onClick={() => setSetup(null)}>{t('staff.sec.cancel')}</button>
          </div>
        )}

        {mfa?.enabled && !mfa.setupRequired && (
          <div className="mt-4 space-y-3 border-t border-edge pt-3">
            <div className="text-sm font-medium">{t('staff.sec.turnOff')}</div>
            <div><label className="label" htmlFor="pw">{t('staff.sec.password')}</label><PasswordInput id="pw" className="field mt-1" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <div><label className="label" htmlFor="code2">{t('staff.sec.currentCode')}</label><input id="code2" className="field mt-1 text-center font-mono tracking-widest" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
            <button className="btn-ghost w-full" disabled={busy || !password || code.length !== 6} onClick={disable}>{t('staff.sec.turnOffBtn')}</button>
          </div>
        )}
      </section>
    </div>
  );
}

export default function Page() {
  return <StaffShell roles={['ADMIN', 'DISPATCHER']}>{() => <Security />}</StaffShell>;
}
