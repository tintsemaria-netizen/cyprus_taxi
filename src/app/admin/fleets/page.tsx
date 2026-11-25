'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

export const dynamic = 'force-dynamic';

// Fleets (2026-11-20, operator): the admin creates a fleet with its owner's login; drivers and cars
// are put into it on «Водители» / «Автомобили». The owner only looks.
interface FleetRow { id: string; name: string; active: boolean; owner: { login: string; displayName: string; isDriver: boolean }; drivers: number; vehicles: number }

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{() => <Fleets />}</StaffShell>;
}

function Fleets() {
  const { t } = useT();
  const [rows, setRows] = useState<FleetRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', login: '', displayName: '' });
  // Owner: a new login, or a driver who keeps driving (2026-11-20, operator: «владелец тоже может работать»).
  const [ownerDriver, setOwnerDriver] = useState('');
  const [drivers, setDrivers] = useState<{ id: string; login: string; publicName: string }[]>([]);
  useEffect(() => { api<{ drivers: { id: string; login: string; publicName: string }[] }>('/admin/drivers').then((r) => setDrivers(r.drivers)).catch(() => {}); }, []);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setRows((await api<{ fleets: FleetRow[] }>('/admin/fleets')).fleets); }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const r = await api<{ login: string; temporaryPassword?: string }>('/admin/fleets', { method: 'POST', body: ownerDriver ? { name: form.name, driverId: ownerDriver } : form });
      setMsg(r.temporaryPassword ? t('staff.fleets.created', { login: r.login, pw: r.temporaryPassword }) : t('staff.fleets.createdDriver', { login: r.login }));
      setForm({ name: '', login: '', displayName: '' }); setOwnerDriver('');
      await load();
    } catch (e) {
      if (e instanceof ApiRequestError) setMsg(e.body.message + (e.body.fieldErrors ? ' ' + Object.entries(e.body.fieldErrors).map(([k, v]) => `${k}: ${v}`).join(' ') : ''));
    } finally { setBusy(false); }
  }
  async function patch(f: FleetRow, body: Record<string, unknown>) {
    const r = await api<{ temporaryPassword?: string }>(`/admin/fleets/${f.id}`, { method: 'PATCH', body }).catch(() => null);
    if (r?.temporaryPassword) setMsg(t('staff.fleets.newPw', { login: f.owner.login, pw: r.temporaryPassword }));
    await load();
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6" data-testid="admin-fleets">
      <h1 className="text-xl font-bold">{t('staff.fleets.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('staff.fleets.sub')}</p>
      {msg && <p className="mt-3 rounded-[12px] border border-accent/40 bg-accent/10 px-3 py-2 text-sm">{msg}</p>}
      <form onSubmit={create} className="card mt-4 grid gap-3 p-4 sm:grid-cols-5">
        <input className="field" placeholder={t('staff.fleets.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select className="field" value={ownerDriver} onChange={(e) => setOwnerDriver(e.target.value)} aria-label={t('staff.fleets.owner')} data-testid="fleet-owner-select">
          <option value="">{t('staff.fleets.ownerNew')}</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{t('staff.fleets.ownerDriver', { name: `${d.publicName} @${d.login}` })}</option>)}
        </select>
        {!ownerDriver && <input className="field" placeholder={t('staff.fleets.displayName')} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />}
        {!ownerDriver && <input className="field" placeholder={t('staff.fleets.login')} autoCapitalize="none" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />}
        <button className="btn-primary" disabled={busy}>{t('staff.fleets.add')}</button>
      </form>
      <div className="card mt-4 divide-y divide-edge">
        {rows.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-[160px] flex-1">
              <div className="font-medium">{f.name}</div>
              <div className="text-xs text-muted">{f.owner.displayName} @{f.owner.login}{f.owner.isDriver ? ` (${t('staff.fleets.ownerIsDriver')})` : ''} · {t('staff.fleets.counts', { d: f.drivers, v: f.vehicles })}</div>
            </div>
            <span className={`chip ${f.active ? '!text-accent' : '!text-danger'}`}>{f.active ? t('staff.active') : t('staff.inactive')}</span>
            {!f.owner.isDriver && <button className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => patch(f, { resetPassword: true })}>{t('staff.drivers.resetPw')}</button>}
            <button className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => { if (window.confirm(t(f.active ? 'staff.confirm.deactivate' : 'staff.confirm.activate', { name: f.name }))) void patch(f, { active: !f.active }); }}>{f.active ? t('staff.deactivate') : t('staff.activate')}</button>
          </div>
        ))}
        {rows.length === 0 && <p className="p-4 text-sm text-muted">{t('staff.fleets.empty')}</p>}
      </div>
    </div>
  );
}
