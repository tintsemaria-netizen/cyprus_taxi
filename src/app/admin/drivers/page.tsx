'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

export const dynamic = 'force-dynamic';

interface DriverRow { id: string; login: string; publicName: string; phone: string; active: boolean; onDuty: boolean; available: boolean; vehicle: { plate: string; label: string } | null; }
interface VehicleRow { id: string; plate: string; make: string; model: string; active: boolean; }

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{() => <Drivers />}</StaffShell>;
}

function Drivers() {
  const { t } = useT();
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ login: '', publicName: '', phone: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [d, v] = await Promise.all([
      api<{ drivers: DriverRow[] }>('/admin/drivers'),
      api<{ vehicles: VehicleRow[] }>('/admin/vehicles'),
    ]);
    setDrivers(d.drivers);
    setVehicles(v.vehicles);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ temporaryPassword: string; login: string }>('/admin/drivers', { method: 'POST', body: form });
      setMsg(t('staff.drivers.created', { login: r.login, pw: r.temporaryPassword }));
      setForm({ login: '', publicName: '', phone: '' });
      await load();
    } catch (e) {
      if (e instanceof ApiRequestError) setMsg(e.body.message + (e.body.fieldErrors ? ' ' + Object.values(e.body.fieldErrors).join(' ') : ''));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(d: DriverRow) {
    await api(`/admin/drivers/${d.id}`, { method: 'PATCH', body: { active: !d.active } }).catch(() => {});
    await load();
  }
  async function resetPw(d: DriverRow) {
    const r = await api<{ temporaryPassword?: string }>(`/admin/drivers/${d.id}`, { method: 'PATCH', body: { resetPassword: true } }).catch(() => null);
    if (r?.temporaryPassword) setMsg(t('staff.drivers.newPw', { login: d.login, pw: r.temporaryPassword }));
    await load();
  }
  async function bind(d: DriverRow, vehicleId: string) {
    if (!vehicleId) return;
    setMsg(null);
    try {
      await api('/admin/vehicle-bindings', { method: 'POST', body: { driverId: d.id, vehicleId } });
      await load();
    } catch (e) {
      if (e instanceof ApiRequestError) setMsg(e.body.message);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <h1 className="text-xl font-bold">{t('staff.drivers.title')}</h1>
      {msg && <p className="mt-3 rounded-[12px] border border-accent/40 bg-accent/10 px-3 py-2 text-sm">{msg}</p>}

      <form onSubmit={create} className="card mt-4 grid gap-3 p-4 sm:grid-cols-4">
        <input className="field" placeholder={t('staff.drivers.login')} value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
        <input className="field" placeholder={t('staff.drivers.publicName')} value={form.publicName} onChange={(e) => setForm({ ...form, publicName: e.target.value })} />
        <input className="field" placeholder="+357…" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <button className="btn-primary" disabled={busy}>{t('staff.drivers.add')}</button>
      </form>

      <div className="card mt-4 divide-y divide-edge">
        {drivers.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-[140px] flex-1">
              <div className="font-medium">{d.publicName} <span className="text-xs text-muted">@{d.login}</span></div>
              <div className="text-xs text-muted">{d.phone} · {d.onDuty ? t('staff.drivers.onDuty') : t('staff.drivers.off')} · {d.vehicle ? `${d.vehicle.label} (${d.vehicle.plate})` : t('staff.drivers.noVehicle')}</div>
            </div>
            <span className={`chip ${d.active ? '!text-accent' : '!text-danger'}`}>{d.active ? t('staff.active') : t('staff.inactive')}</span>
            <select className="field !min-h-0 !w-auto !py-1.5 text-xs" defaultValue="" onChange={(e) => bind(d, e.target.value)}>
              <option value="">{t('staff.drivers.bind')}</option>
              {vehicles.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.make} {v.model} · {v.plate}</option>)}
            </select>
            <button className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => resetPw(d)}>{t('staff.drivers.resetPw')}</button>
            <button className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => toggleActive(d)}>{d.active ? t('staff.deactivate') : t('staff.activate')}</button>
          </div>
        ))}
        {drivers.length === 0 && <p className="p-4 text-sm text-muted">{t('staff.drivers.empty')}</p>}
      </div>
    </div>
  );
}
