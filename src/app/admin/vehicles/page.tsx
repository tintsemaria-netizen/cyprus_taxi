'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

export const dynamic = 'force-dynamic';

interface VehicleRow { id: string; plate: string; make: string; model: string; color: string; vClass: string; seats: number; active: boolean; boundDriver: string | null; }

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{() => <Vehicles />}</StaffShell>;
}

function Vehicles() {
  const { t } = useT();
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ plate: '', make: '', model: '', color: '', vClass: 'COMFORT', seats: 4 });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRows((await api<{ vehicles: VehicleRow[] }>('/admin/vehicles')).vehicles);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api('/admin/vehicles', { method: 'POST', body: { ...form, seats: Number(form.seats), vClass: form.vClass as 'COMFORT' | 'XL' } });
      setForm({ plate: '', make: '', model: '', color: '', vClass: 'COMFORT', seats: 4 });
      await load();
    } catch (e) {
      if (e instanceof ApiRequestError) setMsg(e.body.message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(v: VehicleRow) {
    try {
      await api(`/admin/vehicles/${v.id}`, { method: 'PATCH', body: { active: !v.active } });
      await load();
    } catch (e) {
      if (e instanceof ApiRequestError) setMsg(e.body.message);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <h1 className="text-xl font-bold">{t('staff.vehicles.title')}</h1>
      {msg && <p className="mt-3 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{msg}</p>}

      <form onSubmit={create} className="card mt-4 grid gap-3 p-4 sm:grid-cols-7">
        <input className="field sm:col-span-1" placeholder={t('staff.vehicles.plate')} value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} />
        <input className="field" placeholder={t('staff.vehicles.make')} value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
        <input className="field" placeholder={t('staff.vehicles.model')} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        <input className="field" placeholder={t('staff.vehicles.color')} value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
        <select className="field" value={form.vClass} onChange={(e) => setForm({ ...form, vClass: e.target.value })}>
          <option value="COMFORT">Comfort</option>
          <option value="XL">XL</option>
        </select>
        <input className="field" type="number" min={1} max={16} placeholder={t('staff.vehicles.seats')} value={form.seats} onChange={(e) => setForm({ ...form, seats: Number(e.target.value) })} />
        <button className="btn-primary" disabled={busy}>{t('staff.vehicles.add')}</button>
      </form>

      <div className="card mt-4 divide-y divide-edge">
        {rows.map((v) => (
          <div key={v.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-[160px] flex-1">
              <div className="font-medium">{v.color} {v.make} {v.model} <span className="font-mono text-xs text-muted">{v.plate}</span></div>
              <div className="text-xs text-muted">{v.vClass} · {t('staff.vehicles.seatsN', { n: v.seats })} · {v.boundDriver ? t('staff.vehicles.boundTo', { name: v.boundDriver }) : t('staff.vehicles.unbound')}</div>
            </div>
            <span className={`chip ${v.active ? '!text-accent' : '!text-danger'}`}>{v.active ? t('staff.active') : t('staff.inactive')}</span>
            <button className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => toggle(v)}>{v.active ? t('staff.deactivate') : t('staff.activate')}</button>
          </div>
        ))}
        {rows.length === 0 && <p className="p-4 text-sm text-muted">{t('staff.vehicles.empty')}</p>}
      </div>
    </div>
  );
}
