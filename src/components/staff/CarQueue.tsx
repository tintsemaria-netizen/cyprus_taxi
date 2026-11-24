'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { useRefreshOnReturn } from '@/components/useRefreshOnReturn';
import { DOCS_CHANGED } from '@/components/staff/StaffShell';

// «Мои машины» requests (2026-11-24) at the top of the admin's «Машины»: drivers asking to work on a car the
// admin decides on (an ownerless car, or another driver's — that driver says yes too), and new cars to check.
interface Q {
  access: { id: string; driverName: string; plate: string; car: string; ownerName: string | null; ownerOk: boolean }[];
  requests: { id: string; driverName: string; vehicle: Record<string, string>; submittedAt: string | null }[];
}

export function CarQueue() {
  const { t, tError } = useT();
  const [q, setQ] = useState<Q | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { api<Q>('/admin/cars').then(setQ).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  useRefreshOnReturn(load);
  async function decide(id: string, yes: boolean) {
    setErr(null);
    try { await api('/admin/cars', { method: 'POST', body: { id, yes } }); load(); window.dispatchEvent(new Event(DOCS_CHANGED)); }
    catch (e) { setErr(e instanceof ApiRequestError ? tError(e) : String(e)); }
  }
  if (!q || (q.access.length === 0 && q.requests.length === 0)) return null;
  return (
    <section className="card row-alert mb-4 p-4" data-testid="car-queue">
      <h2 className="label mb-2">{t('staff.cars.queueTitle')}</h2>
      {err && <p className="mb-2 text-sm text-danger">{err}</p>}
      {q.requests.map((r) => (
        <a key={r.id} href={`/admin/cars/${r.id}`} className="flex flex-wrap items-center gap-2 border-t border-edge py-2 text-sm first:border-0">
          <span className="font-semibold text-danger">{t('staff.cars.newCar')}</span>
          <span className="rounded-[6px] border border-edge px-1.5 font-mono font-bold">{r.vehicle.plate}</span>
          <span className="text-muted">{r.vehicle.make} {r.vehicle.model} · {r.driverName}</span>
          <span className="ms-auto rounded-full bg-danger px-2.5 py-0.5 text-xs font-semibold text-white">{t('staff.docs.check')} ›</span>
        </a>
      ))}
      {q.access.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-2 border-t border-edge py-2 text-sm first:border-0">
          <span className="min-w-0 flex-1">
            {t('staff.cars.accessLine', { who: a.driverName, plate: a.plate })} <span className="text-muted">({a.car})</span>
            {a.ownerName && <span className={`block text-xs ${a.ownerOk ? 'text-accent' : 'text-warn'}`}>{a.ownerOk ? t('staff.cars.ownerYes', { owner: a.ownerName }) : t('staff.cars.ownerWait', { owner: a.ownerName })}</span>}
          </span>
          <button className="btn-primary !min-h-0 !py-1.5 text-xs" onClick={() => decide(a.id, true)}>{t('staff.cars.allow')}</button>
          <button className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => decide(a.id, false)}>{t('staff.cars.deny')}</button>
        </div>
      ))}
    </section>
  );
}
