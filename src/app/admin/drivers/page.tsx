'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { useReportFmt } from '@/components/reports/format';
import type { DriverFigures } from '@/server/reports/driver-report';

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
  // Today + this week per driver (2026-11-20): the same figures the driver sees on his own screens.
  const [figs, setFigs] = useState<Record<string, DriverFigures>>({});
  const { dur, km, money } = useReportFmt();

  const load = useCallback(async () => {
    const [d, v] = await Promise.all([
      api<{ drivers: DriverRow[] }>('/admin/drivers'),
      api<{ vehicles: VehicleRow[] }>('/admin/vehicles'),
    ]);
    setDrivers(d.drivers);
    setVehicles(v.vehicles);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let alive = true;
    const go = () => api<{ figures: DriverFigures[] }>('/admin/drivers/figures').then((r) => { if (alive) setFigs(Object.fromEntries(r.figures.map((f) => [f.driverId, f]))); }).catch(() => {});
    go();
    const id = setInterval(go, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const all = Object.values(figs);
  const sum = (k: keyof Pick<DriverFigures, 'onlineSec' | 'km' | 'weekSec' | 'weekKm' | 'done' | 'notDone' | 'earnedCents'>) => all.reduce((a, f) => a + f[k], 0);

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

      {all.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2" data-testid="fleet-figures">
          <div className="card p-3">
            <div className="text-xs text-muted">{t('staff.drivers.fleetToday')}</div>
            <div className="mt-1 flex flex-wrap gap-x-1.5 text-[15px] font-semibold"><span className="whitespace-nowrap text-accent">{dur(sum('onlineSec'))}</span><span className="whitespace-nowrap text-danger">{km(sum('km'))}</span></div>
            <div className="mt-0.5 text-sm"><span className="text-accent">✓ {sum('done')}</span> <span className="ms-2 text-danger">✕ {sum('notDone')}</span> <span className="ms-2">{money(sum('earnedCents'))}</span></div>
          </div>
          <div className="card p-3">
            <div className="text-xs text-muted">{t('staff.drivers.fleetWeek')}</div>
            <div className="mt-1 flex flex-wrap gap-x-1.5 text-[15px] font-semibold"><span className="whitespace-nowrap text-accent">{dur(sum('weekSec'))}</span><span className="whitespace-nowrap text-danger">{km(sum('weekKm'))}</span></div>
          </div>
        </div>
      )}

      <form onSubmit={create} className="card mt-4 grid gap-3 p-4 sm:grid-cols-4">
        <input className="field" placeholder={t('staff.drivers.login')} value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
        <input className="field" placeholder={t('staff.drivers.publicName')} value={form.publicName} onChange={(e) => setForm({ ...form, publicName: e.target.value })} />
        <input className="field" placeholder="+357…" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <button className="btn-primary" disabled={busy}>{t('staff.drivers.add')}</button>
      </form>

      <div className="card mt-4 divide-y divide-edge">
        {drivers.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-3 p-3">
            <a href={`/admin/drivers/${d.id}`} className="min-w-[140px] flex-1" data-testid={`driver-report-${d.login}`}>
              <div className="font-medium">{d.publicName} <span className="text-xs text-muted">@{d.login}</span></div>
              <div className="text-xs text-muted">{d.phone} · {d.onDuty ? t('staff.drivers.onDuty') : t('staff.drivers.off')} · {d.vehicle ? `${d.vehicle.label} (${d.vehicle.plate})` : t('staff.drivers.noVehicle')}</div>
              {figs[d.id] && (
                <div className="mt-1 space-y-0.5 text-xs">
                  <div className="flex flex-wrap gap-x-2"><span className="text-muted">{t('staff.drivers.today')}:</span>
                    <span className="whitespace-nowrap"><span className="text-accent">{dur(figs[d.id].onlineSec)}</span> · <span className="text-danger">{km(figs[d.id].km)}</span></span>
                    <span className="whitespace-nowrap"><span className="text-accent">✓ {figs[d.id].done}</span> <span className="text-danger">✕ {figs[d.id].notDone}</span></span></div>
                  <div className="flex flex-wrap gap-x-2 text-muted"><span>{t('staff.drivers.week')}:</span><span className="whitespace-nowrap">{dur(figs[d.id].weekSec)} · {km(figs[d.id].weekKm)}</span></div>
                </div>
              )}
              <div className="mt-0.5 text-xs font-semibold text-accent">{t('staff.drivers.report')} ›</div>
            </a>
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
