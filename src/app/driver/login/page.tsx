'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { api, ApiRequestError } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

export default function DriverLogin() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [dev, setDev] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ sent: boolean; devCode?: string; unavailable?: boolean }>('/driver/otp/request', { method: 'POST', body: { phone } });
      if (!r.sent) { setErr('SMS is temporarily unavailable. Try again shortly.'); return; }
      setDev(r.devCode ?? null); setStage('code');
    } catch (e) { if (e instanceof ApiRequestError) setErr(e.body.message); } finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setErr(null);
    try {
      await api('/driver/otp/verify', { method: 'POST', body: { phone, code } });
      router.push('/driver');
    } catch (e) { if (e instanceof ApiRequestError) setErr(e.body.message); } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <a href="/" className="inline-block"><Logo /></a>
        <h1 className="mt-6 text-xl font-bold">Driver sign in</h1>
        <p className="mt-1 text-sm text-muted">Approved drivers sign in with their phone.</p>
        {err && <p className="mt-4 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
        {stage === 'phone' ? (
          <div className="mt-4 space-y-3">
            <div><label className="label">Phone (international)</label>
              <input className="field mt-1" placeholder="+35799123456" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" /></div>
            <button className="btn-primary w-full" disabled={busy || !phone} onClick={requestCode}>{busy ? 'Sending…' : 'Send code'}</button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {dev && <p className="rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">Demo code: <b>{dev}</b></p>}
            <div><label className="label">SMS code</label>
              <input className="field mt-1 text-center font-mono text-lg tracking-widest" inputMode="numeric" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
            <button className="btn-primary w-full" disabled={busy || code.length < 4} onClick={verify}>{busy ? 'Verifying…' : 'Sign in'}</button>
            <button className="w-full text-sm text-muted hover:text-ink" onClick={() => setStage('phone')}>Use a different number</button>
          </div>
        )}
        <a href="/driver/register" className="mt-4 block text-center text-sm text-accent hover:underline">New driver? Register →</a>
        <a href="/staff/login" className="mt-2 block text-center text-xs text-muted hover:text-ink">Staff / admin login</a>
      </div>
    </div>
  );
}
