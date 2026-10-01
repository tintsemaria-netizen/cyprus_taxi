'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

export const dynamic = 'force-dynamic';

export default function DriverLogin() {
  const router = useRouter();
  const { t, tError } = useT();
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

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="flex items-center justify-between gap-2"><a href="/" className="inline-block"><Logo /></a><LanguageSwitcher /></div>
        <h1 className="mt-6 text-xl font-bold">{t('driver.login.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('driver.login.subtitle')}</p>
        {err && <p className="mt-4 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
        {stage === 'phone' ? (
          <div className="mt-4 space-y-3">
            <div><label className="label" htmlFor="login-f1">{t('driver.login.phoneLabel')}</label>
              <input id="login-f1" className="field mt-1" placeholder="+35799123456" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" /></div>
            <button className="btn-primary w-full" disabled={busy || !phone} onClick={requestCode}>{busy ? t('driver.login.sending') : t('driver.login.sendCode')}</button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {dev && <p className="rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{t('driver.login.demoCode')} <b>{dev}</b></p>}
            <div><label className="label" htmlFor="login-f2">{t('driver.login.codeLabel')}</label>
              <input id="login-f2" className="field mt-1 text-center font-mono text-lg tracking-widest" inputMode="numeric" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
            <button className="btn-primary w-full" disabled={busy || code.length < 4} onClick={verify}>{busy ? t('driver.login.verifying') : t('driver.login.signIn')}</button>
            <button className="w-full text-sm text-muted hover:text-ink" onClick={() => setStage('phone')}>{t('driver.login.differentNumber')}</button>
          </div>
        )}
        <a href="/driver/register" className="mt-4 block text-center text-sm text-accent hover:underline">{t('driver.login.register')}</a>
        <a href="/staff/login" className="mt-2 block text-center text-xs text-muted hover:text-ink">{t('driver.login.staffLogin')}</a>
      </div>
    </div>
  );
}
