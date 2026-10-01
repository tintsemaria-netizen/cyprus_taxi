'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

export const dynamic = 'force-dynamic';

// Clean consumer sign-in (Task 018): email + password only, with Register and Become Driver below.
export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useT();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('/passenger/login', { method: 'POST', body: { email, password } });
      router.push('/');
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) setError(t('errors.BAD_CREDENTIALS'));
      else if (err instanceof ApiRequestError && err.status === 429) setError(t('auth.tooManyAttempts'));
      else setError(t('auth.couldNotSignIn'));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <form onSubmit={submit} className="card p-6">
          <div className="flex items-center justify-between gap-2"><a href="/" className="inline-block"><Logo /></a><LanguageSwitcher /></div>
          <h1 className="mt-6 text-xl font-bold">{t('auth.signIn')}</h1>
          <p className="mt-1 text-sm text-muted">{t('auth.login.subtitle')}</p>
          {error && <p className="mt-4 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="mt-4 space-y-3">
            <div>
              <label className="label" htmlFor="login-f1">{t('auth.email')}</label>
              <input id="login-f1" type="email" className="field mt-1" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" autoComplete="email" inputMode="email" />
            </div>
            <div>
              <label className="label" htmlFor="login-f2">{t('auth.password')}</label>
              <input id="login-f2" type="password" className="field mt-1" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
          </div>
          <button className="btn-primary mt-5 min-h-[44px] w-full" disabled={busy || !email || !password}>{busy ? t('auth.signingIn') : t('auth.signIn')}</button>

          <div className="mt-5 border-t border-edge pt-4">
            <a href="/register" className="btn-ghost min-h-[44px] flex w-full items-center justify-center">{t('auth.createAccount')}</a>
            <a href="/driver/register" className="mt-2 btn-ghost min-h-[44px] flex w-full items-center justify-center">{t('auth.becomeDriver')}</a>
          </div>
        </form>
        <div className="mt-3 flex justify-between px-1 text-xs text-muted">
          <a href="/" className="hover:text-ink">{t('auth.backToBooking')}</a>
          <a href="/staff/login" className="hover:text-ink">{t('auth.login.staffSignIn')}</a>
        </div>
      </div>
    </div>
  );
}
