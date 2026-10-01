'use client';

import { useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

interface Me { mfa?: { eligible: boolean; enabled: boolean; setupRequired: boolean } }

// Two-factor (TOTP) for admins and dispatchers (2026-10-01 audit Stage 1.2).
function Security() {
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
    try { await fn(); } catch (e) { setMsg({ kind: 'err', text: e instanceof ApiRequestError ? e.body.message : 'Something went wrong. Try again.' }); }
    finally { setBusy(false); }
  }

  const start = () => run(async () => { setSetup(await api('/auth/mfa/setup', { method: 'POST' })); setCode(''); });
  const enable = () => run(async () => {
    await api('/auth/mfa/enable', { method: 'POST', body: { code } });
    setSetup(null); setCode(''); setMsg({ kind: 'ok', text: 'Two-factor authentication is on. Other sessions were signed out.' }); await load();
  });
  const disable = () => run(async () => {
    await api('/auth/mfa/disable', { method: 'POST', body: { password, code } });
    setPassword(''); setCode(''); setMsg({ kind: 'ok', text: 'Two-factor authentication is off.' }); await load();
  });

  const mfa = me?.mfa;
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-bold">Security</h1>
      {mfa?.setupRequired && (
        <p className="rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">Two-factor authentication is required for your role. Set it up to continue.</p>
      )}
      {msg && <p role="status" className={`rounded-[12px] border px-3 py-2 text-sm ${msg.kind === 'ok' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-danger/40 bg-danger/10 text-danger'}`}>{msg.text}</p>}

      <section className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Two-factor authentication</h2>
          <span className={`chip ${mfa?.enabled ? 'text-accent' : 'text-muted'}`}>{mfa ? (mfa.enabled ? 'On' : 'Off') : '…'}</span>
        </div>
        <p className="mt-1 text-sm text-muted">Sign-in will also ask for a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy, Microsoft Authenticator).</p>

        {mfa && !mfa.eligible && <p className="mt-3 text-sm text-muted">Not available for this account type.</p>}

        {mfa?.eligible && !mfa.enabled && !setup && (
          <button className="btn-primary mt-4 w-full" disabled={busy} onClick={start}>Set up two-factor</button>
        )}

        {setup && (
          <div className="mt-4 space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>Scan this QR code with your authenticator app.</li>
              <li>Or enter the key manually.</li>
              <li>Type the 6-digit code it shows to confirm.</li>
            </ol>
            {/* SVG produced server-side by the qrcode library from our own otpauth URI. */}
            <div className="mx-auto w-48 rounded-[12px] bg-white p-2" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
            <div className="rounded-[12px] border border-edge bg-elevated px-3 py-2 text-center font-mono text-sm tracking-wider break-all" aria-label="Manual setup key">{setup.secret.match(/.{1,4}/g)?.join(' ')}</div>
            <a href={setup.uri} className="block text-center text-xs text-accent hover:underline">Open in authenticator app (on this phone)</a>
            <label className="label" htmlFor="code">Code from the app</label>
            <input id="code" className="field text-center font-mono text-lg tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <button className="btn-primary w-full" disabled={busy || code.length !== 6} onClick={enable}>{busy ? 'Checking…' : 'Turn on'}</button>
            <button className="block w-full text-center text-xs text-muted hover:text-ink" onClick={() => setSetup(null)}>Cancel</button>
          </div>
        )}

        {mfa?.enabled && !mfa.setupRequired && (
          <div className="mt-4 space-y-3 border-t border-edge pt-3">
            <div className="text-sm font-medium">Turn off</div>
            <div><label className="label" htmlFor="pw">Password</label><input id="pw" type="password" className="field mt-1" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <div><label className="label" htmlFor="code2">Current code</label><input id="code2" className="field mt-1 text-center font-mono tracking-widest" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
            <button className="btn-ghost w-full" disabled={busy || !password || code.length !== 6} onClick={disable}>Turn off two-factor</button>
          </div>
        )}
      </section>
    </div>
  );
}

export default function Page() {
  return <StaffShell roles={['ADMIN', 'DISPATCHER']}>{() => <Security />}</StaffShell>;
}
