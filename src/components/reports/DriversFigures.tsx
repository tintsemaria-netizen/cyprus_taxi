'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { useReportFmt } from './format';
import type { DriverFigures } from '@/server/reports/driver-report';

// Shared report tool (2026-11-20): «all drivers today / this week» cards and the per-driver figures
// line — the admin's «Водители» and the fleet owner's list use the very same pieces.

/** Re-reads every 30 s. `load` returns the figures array (from /admin/drivers/figures or /fleet/drivers). */
export function useDriverFigures(load: () => Promise<DriverFigures[]>): Record<string, DriverFigures> {
  const [figs, setFigs] = useState<Record<string, DriverFigures>>({});
  useEffect(() => {
    let alive = true;
    const go = () => load().then((r) => { if (alive) setFigs(Object.fromEntries(r.map((f) => [f.driverId, f]))); }).catch(() => {});
    go();
    const id = setInterval(go, 30_000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return figs;
}

export function FiguresTotals({ figs }: { figs: Record<string, DriverFigures> }) {
  const { t } = useT();
  const { dur, km, money } = useReportFmt();
  const all = Object.values(figs);
  if (all.length === 0) return null;
  const sum = (k: 'onlineSec' | 'km' | 'weekSec' | 'weekKm' | 'done' | 'notDone' | 'earnedCents') => all.reduce((a, f) => a + f[k], 0);
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="fleet-figures">
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
  );
}

export function DriverFiguresLine({ f }: { f?: DriverFigures }) {
  const { t } = useT();
  const { dur, km } = useReportFmt();
  if (!f) return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs">
      <div className="flex flex-wrap gap-x-2"><span className="text-muted">{t('staff.drivers.today')}:</span>
        <span className="whitespace-nowrap"><span className="text-accent">{dur(f.onlineSec)}</span> · <span className="text-danger">{km(f.km)}</span></span>
        <span className="whitespace-nowrap"><span className="text-accent">✓ {f.done}</span> <span className="text-danger">✕ {f.notDone}</span></span></div>
      <div className="flex flex-wrap gap-x-2 text-muted"><span>{t('staff.drivers.week')}:</span><span className="whitespace-nowrap">{dur(f.weekSec)} · {km(f.weekKm)}</span></div>
    </div>
  );
}
