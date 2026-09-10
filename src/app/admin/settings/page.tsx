'use client';

import { useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';

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
      setMsg('Saved.');
    } catch (e) {
      if (e instanceof ApiRequestError) setMsg(e.body.message);
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <div className="p-8 text-muted">Loading settings…</div>;

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="text-xl font-bold">Operational settings</h1>
      <p className="mt-1 text-sm text-muted">Timezone fixed to Europe/Nicosia in beta. Secrets are never stored or shown here.</p>
      {msg && <p className="mt-3 rounded-[12px] border border-accent/40 bg-accent/10 px-3 py-2 text-sm">{msg}</p>}
      <form onSubmit={save} className="card mt-4 space-y-4 p-4">
        <Row label="Operator name"><input className="field" value={s.operatorName ?? ''} onChange={(e) => setS({ ...s, operatorName: e.target.value })} placeholder="Not published if empty" /></Row>
        <Row label="Support phone"><input className="field" value={s.supportPhone ?? ''} onChange={(e) => setS({ ...s, supportPhone: e.target.value })} placeholder="Hidden if empty" /></Row>
        <Row label="Support email"><input className="field" value={s.supportEmail ?? ''} onChange={(e) => setS({ ...s, supportEmail: e.target.value })} placeholder="Hidden if empty" /></Row>
        <div className="grid grid-cols-3 gap-3">
          <Row label="Schedule min (min)"><input type="number" className="field" value={s.scheduleMinMinutes} onChange={(e) => setS({ ...s, scheduleMinMinutes: Number(e.target.value) })} /></Row>
          <Row label="Schedule max (days)"><input type="number" className="field" value={s.scheduleMaxDays} onChange={(e) => setS({ ...s, scheduleMaxDays: Number(e.target.value) })} /></Row>
          <Row label="Min stop dist (m)"><input type="number" className="field" value={s.minStopDistanceMeters} onChange={(e) => setS({ ...s, minStopDistanceMeters: Number(e.target.value) })} /></Row>
        </div>
        <Row label="Service area">
          <p className="text-xs text-muted">{s.serviceAreaPolygon.length}-point polygon configured (synthetic Cyprus area in demo). Editing the polygon geometry is available via the API in this beta.</p>
        </Row>
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
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
