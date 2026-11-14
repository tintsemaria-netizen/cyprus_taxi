'use client';

import { useState } from 'react';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { PasswordInput } from '@/components/PasswordInput';

// Change own password for drivers and staff (2026-11-14). Other devices are signed out.
export function StaffPasswordForm() {
  const { t, tError } = useT();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await api('/auth/password', { method: 'POST', body: { current, next } });
      setMsg(t('auth.pw.changed')); setCurrent(''); setNext(''); setOpen(false);
    } catch (err) { setMsg(err instanceof ApiRequestError ? tError(err) : t('auth.account.couldNotSave')); }
    finally { setBusy(false); }
  }
  if (!open) {
    return (
      <div className="card flex items-center justify-between gap-3 p-4">
        <div>
          <div className="font-medium">{t('auth.pw.title')}</div>
          {msg && <p className="text-sm text-accent">{msg}</p>}
        </div>
        <button className="btn-ghost !py-1.5 text-sm" onClick={() => { setOpen(true); setMsg(null); }}>{t('auth.pw.title')}</button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <div className="font-medium">{t('auth.pw.title')}</div>
      <div>
        <label className="label" htmlFor="spw-current">{t('auth.pw.current')}</label>
        <PasswordInput id="spw-current" className="field mt-1" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </div>
      <div>
        <label className="label" htmlFor="spw-next">{t('auth.pw.next')}</label>
        <PasswordInput id="spw-next" className="field mt-1" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <p className="mt-1 text-xs text-muted">{t('auth.register.passwordHint')} {t('auth.pw.otherDevices')}</p>
      </div>
      {msg && <p className="text-sm text-danger">{msg}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={() => { setOpen(false); setMsg(null); }}>{t('common.cancel')}</button>
        <button className="btn-primary flex-1" disabled={busy || !current || next.length < 8}>{busy ? t('auth.saving') : t('auth.pw.save')}</button>
      </div>
    </form>
  );
}
