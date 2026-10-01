'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

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
  const { t, tError } = useT();

  async function requestCode(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await api<{ sent: boolean; provider: string; devCode?: string }>('/passenger/register', { method: 'POST', body: { name, email, password, phone } });
      setDevCode(r.devCode ?? null); setStep('code');
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.body.code === 'EMAIL_TAKEN' ? t('auth.register.emailTaken') : (Object.values(err.body.fieldErrors ?? {})[0] as string) ?? tError(err));
      else setError(t('auth.register.couldNotStart'));
    } finally { setBusy(false); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api('/passenger/register/verify', { method: 'POST', body: { name, email, password, phone, code } });
      router.push('/');
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.body.code === 'BAD_CODE' ? t('auth.register.badCode') : tError(err));
      else setError(t('auth.register.couldNotVerify'));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {step === 'form' ? (
          <form onSubmit={requestCode} className="card p-6">
            <div className="flex items-center justify-between gap-2"><a href="/" className="inline-block"><Logo /></a><LanguageSwitcher /></div>
            <h1 className="mt-6 text-xl font-bold">{t('auth.register.title')}</h1>
            <p className="mt-1 text-sm text-muted">{t('auth.register.subtitle')}</p>
            {error && <p className="mt-4 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="mt-4 space-y-3">
              <div><label className="label" htmlFor="register-f1">{t('auth.name')}</label><input id="register-f1" className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
              <div><label className="label" htmlFor="register-f2">{t('auth.email')}</label><input id="register-f2" type="email" className="field mt-1" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" autoComplete="email" inputMode="email" /></div>
              <div><label className="label" htmlFor="register-f3">{t('auth.password')}</label><input id="register-f3" type="password" className="field mt-1" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /><p className="mt-1 text-xs text-muted">{t('auth.register.passwordHint')}</p></div>
              <div><label className="label" htmlFor="register-f4">{t('auth.phone')}</label><input id="register-f4" type="tel" className="field mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+357…" autoComplete="tel" inputMode="tel" /><p className="mt-1 text-xs text-muted">{t('auth.register.phoneHint')}</p></div>
            </div>
            <button className="btn-primary mt-5 min-h-[44px] w-full" disabled={busy || !name || !email || password.length < 8 || !phone}>{busy ? t('auth.sending') : t('auth.register.continue')}</button>
            <a href="/login" className="mt-4 block text-center text-sm text-muted hover:text-ink">{t('auth.register.haveAccount')}</a>
          </form>
        ) : (
          <form onSubmit={verify} className="card p-6">
            <div className="flex items-center justify-between gap-2"><a href="/" className="inline-block"><Logo /></a><LanguageSwitcher /></div>
            <h1 className="mt-6 text-xl font-bold">{t('auth.register.verifyTitle')}</h1>
            <p className="mt-1 text-sm text-muted">{t('auth.register.enterCode', { phone })}</p>
            {devCode && <p className="mt-3 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{t('auth.testCodePrefix')} <b>{devCode}</b></p>}
            {error && <p className="mt-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="field mt-4 text-center font-mono text-lg tracking-[0.4em]" placeholder="••••••" />
            <button className="btn-primary mt-4 min-h-[44px] w-full" disabled={busy || code.length < 4}>{busy ? t('auth.verifying') : t('auth.register.createAccount')}</button>
            <button type="button" onClick={() => { setStep('form'); setError(null); }} className="mt-4 block w-full text-center text-sm text-muted hover:text-ink">{t('auth.register.changeDetails')}</button>
          </form>
        )}
      </div>
    </div>
  );
}
