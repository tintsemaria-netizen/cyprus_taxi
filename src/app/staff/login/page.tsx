'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

export const dynamic = 'force-dynamic';

export default function StaffLogin() {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t, tError } = useT();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api<{ role: string; mfaSetupRequired?: boolean }>('/auth/login', { method: 'POST', body: { login, password, ...(needCode ? { totp } : {}) } });
      if (me.role === 'DRIVER') router.push('/driver');
      else if (me.mfaSetupRequired) router.push('/staff/security');
      else router.push('/dispatch');
    } catch (err) {
      if (err instanceof ApiRequestError && err.body.code === 'MFA_REQUIRED') { setNeedCode(true); setError(null); setBusy(false); return; }
      if (err instanceof ApiRequestError && err.body.code === 'MFA_INVALID') setError(tError(err));
      else if (err instanceof ApiRequestError && err.status === 401) setError(t('auth.staff.invalid'));
      else if (err instanceof ApiRequestError && err.status === 429) setError(t('auth.tooManyAttempts'));
      else setError(t('auth.couldNotSignIn'));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="flex items-center justify-between gap-2"><a href="/" className="inline-block"><Logo /></a><LanguageSwitcher /></div>
        <h1 className="mt-6 text-xl font-bold">{t('auth.staff.title')}</h1>
        {/* Driver entry points */}
        <div className="mt-4 rounded-[12px] border border-edge bg-elevated p-3">
          <div className="text-sm font-medium">{t('auth.staff.drivers')}</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <a href="/driver/login" className="btn-ghost !min-h-0 !py-2 text-sm">{t('auth.staff.driverSignIn')}</a>
            <a href="/driver/register" className="btn-primary !min-h-0 !py-2 text-sm">{t('auth.staff.registerDriver')}</a>
          </div>
        </div>
        <h2 className="mt-5 text-sm font-semibold text-muted">{t('auth.staff.staffAdmin')}</h2>
        <p className="mt-1 text-xs text-muted">{t('auth.staff.staffSubtitle')}</p>
        {error && <p className="mt-4 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 space-y-3">
          <div>
            <label className="label" htmlFor="login-f1">{t('auth.staff.login')}</label>
            <input id="login-f1" className="field mt-1" value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="none" autoComplete="username" />
          </div>
          <div>
            <label className="label" htmlFor="login-f2">{t('auth.password')}</label>
            <input id="login-f2" type="password" className="field mt-1" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {needCode && (
            <div>
              <label className="label" htmlFor="totp">{t('auth.staff.totpLabel')}</label>
              <input id="totp" className="field mt-1 text-center font-mono text-lg tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} />
              <p className="mt-1 text-xs text-muted">{t('auth.staff.totpHint')}</p>
            </div>
          )}
        </div>
        <button className="btn-primary mt-5 w-full" disabled={busy || !login || !password || (needCode && totp.length !== 6)}>{busy ? t('auth.signingIn') : t('auth.signIn')}</button>
        <a href="/" className="mt-4 block text-center text-sm text-muted hover:text-ink">{t('auth.backToBooking')}</a>
      </form>
    </div>
  );
}
