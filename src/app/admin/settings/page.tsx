'use client';

import { useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

export const dynamic = 'force-dynamic';

interface Settings {
  operatorName: string | null;
  supportPhone: string | null;
  supportEmail: string | null;
  scheduleMinMinutes: number;
  scheduleMaxDays: number;
  minStopDistanceMeters: number;
  serviceAreaPolygon: { lat: number; lng: number }[];
}

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{() => <SettingsForm />}</StaffShell>;
}

function SettingsForm() {
  const { t } = useT();
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<Settings>('/admin/settings').then(setS).catch(() => {}); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!s) return;
    setBusy(true);
    setMsg(null);
    try {
      await api('/admin/settings', {
        method: 'PATCH',
        body: {
          operatorName: s.operatorName || null,
          supportPhone: s.supportPhone || null,
          supportEmail: s.supportEmail || null,
          scheduleMinMinutes: Number(s.scheduleMinMinutes),
          scheduleMaxDays: Number(s.scheduleMaxDays),
          minStopDistanceMeters: Number(s.minStopDistanceMeters),
        },
      });
      setMsg(t('staff.settings.saved'));
    } catch (e) {
      if (e instanceof ApiRequestError) setMsg(e.body.message);
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <div className="p-8 text-muted">{t('staff.settings.loading')}</div>;

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="text-xl font-bold">{t('staff.settings.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('staff.settings.sub')}</p>
      {msg && <p className="mt-3 rounded-[12px] border border-accent/40 bg-accent/10 px-3 py-2 text-sm">{msg}</p>}
      <form onSubmit={save} className="card mt-4 space-y-4 p-4">
        <Row label={t('staff.settings.operator')}><input className="field" value={s.operatorName ?? ''} onChange={(e) => setS({ ...s, operatorName: e.target.value })} placeholder={t('staff.settings.operatorPh')} /></Row>
        <Row label={t('staff.settings.supportPhone')}><input className="field" value={s.supportPhone ?? ''} onChange={(e) => setS({ ...s, supportPhone: e.target.value })} placeholder={t('staff.settings.hiddenPh')} /></Row>
        <Row label={t('staff.settings.supportEmail')}><input className="field" value={s.supportEmail ?? ''} onChange={(e) => setS({ ...s, supportEmail: e.target.value })} placeholder={t('staff.settings.hiddenPh')} /></Row>
        <div className="grid grid-cols-3 gap-3">
          <Row label={t('staff.settings.schedMin')}><input type="number" className="field" value={s.scheduleMinMinutes} onChange={(e) => setS({ ...s, scheduleMinMinutes: Number(e.target.value) })} /></Row>
          <Row label={t('staff.settings.schedMax')}><input type="number" className="field" value={s.scheduleMaxDays} onChange={(e) => setS({ ...s, scheduleMaxDays: Number(e.target.value) })} /></Row>
          <Row label={t('staff.settings.minStop')}><input type="number" className="field" value={s.minStopDistanceMeters} onChange={(e) => setS({ ...s, minStopDistanceMeters: Number(e.target.value) })} /></Row>
        </div>
        <Row label={t('staff.settings.area')}>
          <p className="text-xs text-muted">{t('staff.settings.areaNote', { n: s.serviceAreaPolygon.length })}</p>
        </Row>
        <button className="btn-primary" disabled={busy}>{busy ? t('staff.settings.saving') : t('staff.settings.save')}</button>
      </form>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
