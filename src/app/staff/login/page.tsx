'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { api, ApiRequestError } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

export default function StaffLogin() {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api<{ role: string }>('/auth/login', { method: 'POST', body: { login, password } });
      if (me.role === 'DRIVER') router.push('/driver');
      else router.push('/dispatch');
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) setError('Invalid login or password.');
      else if (err instanceof ApiRequestError && err.status === 429) setError('Too many attempts. Wait a minute and retry.');
      else setError('Could not sign in. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <a href="/" className="inline-block"><Logo /></a>
        <h1 className="mt-6 text-xl font-bold">Login</h1>
        {/* Driver entry points */}
        <div className="mt-4 rounded-[12px] border border-edge bg-elevated p-3">
          <div className="text-sm font-medium">Drivers</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <a href="/driver/login" className="btn-ghost !min-h-0 !py-2 text-sm">Driver sign in</a>
            <a href="/driver/register" className="btn-primary !min-h-0 !py-2 text-sm">Register as a driver</a>
          </div>
        </div>
        <h2 className="mt-5 text-sm font-semibold text-muted">Staff / admin</h2>
        <p className="mt-1 text-xs text-muted">Dispatchers and administrators.</p>
        {error && <p className="mt-4 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 space-y-3">
          <div>
            <label className="label">Login</label>
            <input className="field mt-1" value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="none" autoComplete="username" />
          </div>
          <div>
            <label className="label">Password</label>
            <input type="password" className="field mt-1" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
        </div>
        <button className="btn-primary mt-5 w-full" disabled={busy || !login || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <a href="/" className="mt-4 block text-center text-sm text-muted hover:text-ink">‹ Back to booking</a>
      </form>
    </div>
  );
}
