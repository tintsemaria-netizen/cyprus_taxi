'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { api, ApiRequestError } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

// Clean consumer sign-in (Task 018): email + password only, with Register and Become Driver below.
export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('/passenger/login', { method: 'POST', body: { email, password } });
      router.push('/');
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) setError('Incorrect email or password.');
      else if (err instanceof ApiRequestError && err.status === 429) setError('Too many attempts. Wait a minute and retry.');
      else setError('Could not sign in. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <form onSubmit={submit} className="card p-6">
          <a href="/" className="inline-block"><Logo /></a>
          <h1 className="mt-6 text-xl font-bold">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use your email and password.</p>
          {error && <p className="mt-4 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="mt-4 space-y-3">
            <div>
              <label className="label">Email</label>
              <input type="email" className="field mt-1" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" autoComplete="email" inputMode="email" />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" className="field mt-1" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
          </div>
          <button className="btn-primary mt-5 min-h-[44px] w-full" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>

          <div className="mt-5 border-t border-edge pt-4">
            <a href="/register" className="btn-ghost min-h-[44px] flex w-full items-center justify-center">Create an account</a>
            <a href="/driver/register" className="mt-2 btn-ghost min-h-[44px] flex w-full items-center justify-center">Become a driver</a>
          </div>
        </form>
        <div className="mt-3 flex justify-between px-1 text-xs text-muted">
          <a href="/" className="hover:text-ink">‹ Back to booking</a>
          <a href="/staff/login" className="hover:text-ink">Staff sign in</a>
        </div>
      </div>
    </div>
  );
}
