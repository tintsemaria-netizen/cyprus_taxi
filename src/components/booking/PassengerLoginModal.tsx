'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiRequestError } from '@/lib/api-client';

// Task 014: mandatory passenger sign-in before requesting a ride. Email + password is the default
// (it works without SMS); the phone-code tab is used when SMS verification is available.
export function PassengerLoginModal({ onDone, onClose }: { onDone: (p: { phone: string; name?: string }) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [dev, setDev] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, mode]);

  async function finish() {
    const me = await api<{ phone: string; name?: string }>('/passenger/me');
    onDone({ phone: me.phone, name: me.name });
  }

  async function emailLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await api('/passenger/login', { method: 'POST', body: { email, password } }); await finish(); }
    catch (e2) { setErr(e2 instanceof ApiRequestError ? e2.body.message : 'Could not sign in. Try again.'); }
    finally { setBusy(false); }
  }
  async function req() {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ sent: boolean; provider?: string; devCode?: string; unavailable?: boolean }>('/passenger/otp/request', { method: 'POST', body: { phone } });
      if (!r.sent) { setErr('Sign-in by SMS code is not available right now. Use email and password instead.'); return; }
      setDev(r.devCode ?? null); setStage('code');
    } catch (e) { if (e instanceof ApiRequestError) setErr(e.body.message); } finally { setBusy(false); }
  }
  async function ver() {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ phone: string; name?: string }>('/passenger/otp/verify', { method: 'POST', body: { phone, code, name: name.trim() || undefined } });
      onDone({ phone: r.phone, name: r.name || name.trim() || undefined });
    } catch (e) { if (e instanceof ApiRequestError) setErr(e.body.message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-4 sm:items-center sm:pb-0" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="plm-title" className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 id="plm-title" className="text-lg font-bold">Sign in to book</h2>
        <p className="mt-1 text-sm text-muted">Your ride, receipt and history are kept in your account.</p>

        <div className="mt-4 flex gap-1 rounded-[12px] border border-edge bg-elevated p-1" role="tablist" aria-label="Sign-in method">
          {(['email', 'phone'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErr(null); }}
              className={`flex-1 rounded-[9px] px-3 py-2 text-sm font-medium transition ${mode === m ? 'bg-accent text-[#0d1608]' : 'text-muted hover:text-ink'}`}>
              {m === 'email' ? 'Email' : 'Phone code'}
            </button>
          ))}
        </div>

        {dev && mode === 'phone' && <p className="mt-3 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">Test verification (SMS not configured): code <b>{dev}</b></p>}
        {err && <p role="alert" className="mt-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}

        {mode === 'email' ? (
          <form className="mt-4 space-y-3" onSubmit={emailLogin}>
            <div><label className="label" htmlFor="plm-email">Email</label><input id="plm-email" type="email" className="field mt-1" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><label className="label" htmlFor="plm-pw">Password</label><input id="plm-pw" type="password" className="field mt-1" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <button className="btn-primary w-full" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <a href="/register" className="block text-center text-sm text-accent hover:underline">Create an account</a>
          </form>
        ) : stage === 'phone' ? (
          <div className="mt-4 space-y-3">
            <div><label className="label" htmlFor="plm-name">Name (optional)</label><input id="plm-name" className="field mt-1" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><label className="label" htmlFor="plm-phone">Phone (international)</label><input id="plm-phone" className="field mt-1" placeholder="+35799123456" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" /></div>
            <button className="btn-primary w-full" disabled={busy || !phone} onClick={req}>{busy ? 'Sending…' : 'Send code'}</button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="label" htmlFor="plm-code">Verification code</label>
            <input id="plm-code" className="field text-center font-mono text-lg tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <button className="btn-primary w-full" disabled={busy || code.length < 4} onClick={ver}>{busy ? 'Verifying…' : 'Verify & continue'}</button>
            <button type="button" className="w-full text-sm text-muted hover:text-ink" onClick={() => setStage('phone')}>Change number</button>
          </div>
        )}
        <button type="button" className="mt-3 block w-full text-center text-sm text-muted hover:text-ink" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
