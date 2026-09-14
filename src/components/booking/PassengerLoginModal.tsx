'use client';

import { useState } from 'react';
import { api, ApiRequestError } from '@/lib/api-client';

// Task 014: mandatory passenger login/registration (verified phone) before requesting a
// ride. One flow handles both new and returning passengers.
export function PassengerLoginModal({ onDone, onClose }: { onDone: (p: { phone: string; name?: string }) => void; onClose: () => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [dev, setDev] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function req() {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ sent: boolean; provider?: string; devCode?: string; unavailable?: boolean }>('/passenger/otp/request', { method: 'POST', body: { phone } });
      if (!r.sent) { setErr('SMS verification is not available right now. Please try again later.'); return; }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Sign in to book</h2>
        <p className="mt-1 text-sm text-muted">Verify your phone to request a ride and keep your trip history.</p>
        {dev && <p className="mt-3 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">Test verification (SMS not configured): code <b>{dev}</b></p>}
        {err && <p className="mt-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
        {stage === 'phone' ? (
          <div className="mt-4 space-y-3">
            <div><label className="label">Name (optional)</label><input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><label className="label">Phone (international)</label><input className="field mt-1" placeholder="+35799123456" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" /></div>
            <button className="btn-primary w-full" disabled={busy || !phone} onClick={req}>{busy ? 'Sending…' : 'Send code'}</button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <input className="field text-center font-mono text-lg tracking-widest" inputMode="numeric" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <button className="btn-primary w-full" disabled={busy || code.length < 4} onClick={ver}>{busy ? 'Verifying…' : 'Verify & continue'}</button>
            <button className="w-full text-sm text-muted hover:text-ink" onClick={() => setStage('phone')}>Change number</button>
          </div>
        )}
        <button className="mt-3 block w-full text-center text-xs text-muted hover:text-ink" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
