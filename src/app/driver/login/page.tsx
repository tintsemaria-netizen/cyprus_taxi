'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';
import { PasswordInput } from '@/components/PasswordInput';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

export const dynamic = 'force-dynamic';

// The drivers' own entrance (2026-11-21, operator: «водитель отдельно, стать водителем отдельно»). It is what the
// «IL-Y Driver» home-screen app opens on when signed out. Two cards: «Я уже водитель» (phone + SMS code, or the
// login and password the admin gave) and «Хочу стать водителем». Passengers and staff have their own pages.
export default function DriverLogin() {
  const router = useRouter();
  const { t, tError } = useT();
  const [mode, setMode] = useState<'phone' | 'password'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [dev, setDev] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ sent: boolean; devCode?: string; unavailable?: boolean }>('/driver/otp/request', { method: 'POST', body: { phone } });
      if (!r.sent) { setErr(t('driver.login.smsUnavailable')); return; }
      setDev(r.devCode ?? null); setStage('code');
    } catch (e) { if (e instanceof ApiRequestError) setErr(tError(e)); } finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setErr(null);
    try {
      await api('/driver/otp/verify', { method: 'POST', body: { phone, code } });
      router.push('/driver');
    } catch (e) { if (e instanceof ApiRequestError) setErr(tError(e)); } finally { setBusy(false); }
  }
  async function byPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const me = await api<{ role: string; mfaSetupRequired?: boolean }>('/auth/login', { method: 'POST', body: { login, password } });
      // Somebody from the staff typed their login here: send them where they belong.
      if (me.role === 'DRIVER') router.push('/driver');
      else if (me.mfaSetupRequired) router.push('/staff/security');
      else if (me.role === 'FLEET_OWNER') router.push('/fleet');
      else router.push('/dispatch');
    } catch (e2) {
      if (e2 instanceof ApiRequestError && e2.body.code === 'MFA_REQUIRED') { router.push('/staff/login'); return; }
      if (e2 instanceof ApiRequestError && e2.status === 401) setErr(t('auth.staff.invalid'));
      else if (e2 instanceof ApiRequestError && e2.status === 429) setErr(t('auth.tooManyAttempts'));
      else setErr(t('auth.couldNotSignIn'));
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-[100dvh] items-start justify-center px-4 py-6 sm:items-center">
      <div className="w-full max-w-sm" data-testid="driver-entrance">
        <div className="flex items-center justify-between gap-2"><a href="/" className="inline-block"><Logo /></a><LanguageSwitcher /></div>
        <h1 className="mt-6 text-2xl font-bold">{t('driver.login.heading')}</h1>
        <p className="mt-1 text-sm text-muted">{t('driver.login.headingSub')}</p>

        <div className="card mt-5 p-4" data-testid="driver-have-account">
          <div className="text-lg font-semibold">{t('driver.login.haveAccount')}</div>
          {err && <p className="mt-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
          {mode === 'phone' ? (
            stage === 'phone' ? (
              <div className="mt-2 space-y-3">
                <p className="text-sm text-muted">{t('driver.login.haveAccountSub')}</p>
                <div><label className="label" htmlFor="login-f1">{t('driver.login.phoneLabel')}</label>
                  <input id="login-f1" className="field mt-1" placeholder="+35799123456" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" /></div>
                <button className="btn-primary w-full" disabled={busy || !phone} onClick={requestCode}>{busy ? t('driver.login.sending') : t('driver.login.sendCode')}</button>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {dev && <p className="rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{t('driver.login.demoCode')} <b>{dev}</b></p>}
                <div><label className="label" htmlFor="login-f2">{t('driver.login.codeLabel')}</label>
                  <input id="login-f2" className="field mt-1 text-center font-mono text-lg tracking-widest" inputMode="numeric" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
                <button className="btn-primary w-full" disabled={busy || code.length < 4} onClick={verify}>{busy ? t('driver.login.verifying') : t('driver.login.signIn')}</button>
                <button className="w-full text-sm text-muted hover:text-ink" onClick={() => setStage('phone')}>{t('driver.login.differentNumber')}</button>
              </div>
            )
          ) : (
            <form onSubmit={byPassword} className="mt-3 space-y-3" data-testid="driver-password-form">
              <div><label className="label" htmlFor="login-f3">{t('driver.login.loginLabel')}</label>
                <input id="login-f3" className="field mt-1" value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="none" autoComplete="username" /></div>
              <div><label className="label" htmlFor="login-f4">{t('driver.login.passwordLabel')}</label>
                <PasswordInput id="login-f4" className="field mt-1" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
              <button className="btn-primary w-full" disabled={busy || !login || !password}>{busy ? t('auth.signingIn') : t('driver.login.signIn')}</button>
            </form>
          )}
          <button type="button" className="mt-3 w-full text-center text-sm text-accent" data-testid="driver-login-mode"
            onClick={() => { setErr(null); setMode(mode === 'phone' ? 'password' : 'phone'); }}>
            {mode === 'phone' ? t('driver.login.byPassword') : t('driver.login.byPhone')}
          </button>
        </div>

        <div className="card mt-3 p-4" data-testid="driver-join">
          <div className="text-lg font-semibold">{t('driver.login.wantJoin')}</div>
          <p className="mt-1 text-sm text-muted">{t('driver.login.wantJoinSub')}</p>
          <a href="/driver/register" className="btn-ghost mt-3 flex min-h-[44px] w-full items-center justify-center font-semibold">{t('driver.login.wantJoinBtn')}</a>
        </div>

        <a href="/" className="mt-5 block text-center text-sm text-muted hover:text-ink">{t('driver.login.passengerLink')} ›</a>
      </div>
    </div>
  );
}
