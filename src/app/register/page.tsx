'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { api, ApiRequestError } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

// Bolt-style passenger sign-up (Task 018): name + email + password + phone, phone verified by SMS
// OTP. No KYC. On the beta SMS isn't configured, so a clearly-labelled test code is shown.
export default function Register() {
  const router = useRouter();
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await api<{ sent: boolean; provider: string; devCode?: string }>('/passenger/register', { method: 'POST', body: { name, email, password, phone } });
      setDevCode(r.devCode ?? null); setStep('code');
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.body.code === 'EMAIL_TAKEN' ? 'That email is already registered — sign in instead.' : (Object.values(err.body.fieldErrors ?? {})[0] as string) ?? err.body.message);
      else setError('Could not start sign-up. Try again.');
    } finally { setBusy(false); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api('/passenger/register/verify', { method: 'POST', body: { name, email, password, phone, code } });
      router.push('/');
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.body.code === 'BAD_CODE' ? 'Incorrect or expired code.' : err.body.message);
      else setError('Could not verify. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {step === 'form' ? (
          <form onSubmit={requestCode} className="card p-6">
            <a href="/" className="inline-block"><Logo /></a>
            <h1 className="mt-6 text-xl font-bold">Create your account</h1>
            <p className="mt-1 text-sm text-muted">Book rides across Cyprus. No documents needed.</p>
            {error && <p className="mt-4 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="mt-4 space-y-3">
              <div><label className="label">Name</label><input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
              <div><label className="label">Email</label><input type="email" className="field mt-1" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" autoComplete="email" inputMode="email" /></div>
              <div><label className="label">Password</label><input type="password" className="field mt-1" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /><p className="mt-1 text-[11px] text-muted">At least 8 characters.</p></div>
              <div><label className="label">Phone</label><input type="tel" className="field mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+357…" autoComplete="tel" inputMode="tel" /><p className="mt-1 text-[11px] text-muted">We’ll send a verification code by SMS.</p></div>
            </div>
            <button className="btn-primary mt-5 min-h-[44px] w-full" disabled={busy || !name || !email || password.length < 8 || !phone}>{busy ? 'Sending…' : 'Continue'}</button>
            <a href="/login" className="mt-4 block text-center text-sm text-muted hover:text-ink">Already have an account? Sign in</a>
          </form>
        ) : (
          <form onSubmit={verify} className="card p-6">
            <a href="/" className="inline-block"><Logo /></a>
            <h1 className="mt-6 text-xl font-bold">Verify your phone</h1>
            <p className="mt-1 text-sm text-muted">Enter the code we sent to {phone}.</p>
            {devCode && <p className="mt-3 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">Test verification (SMS not configured): code <b>{devCode}</b></p>}
            {error && <p className="mt-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="field mt-4 text-center font-mono text-lg tracking-[0.4em]" placeholder="••••••" />
            <button className="btn-primary mt-4 min-h-[44px] w-full" disabled={busy || code.length < 4}>{busy ? 'Verifying…' : 'Create account'}</button>
            <button type="button" onClick={() => { setStep('form'); setError(null); }} className="mt-4 block w-full text-center text-sm text-muted hover:text-ink">‹ Change details</button>
          </form>
        )}
      </div>
    </div>
  );
}
