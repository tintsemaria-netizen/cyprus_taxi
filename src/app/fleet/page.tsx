'use client';

import { useEffect, useState } from 'react';
import { StaffShell, type Me } from '@/components/staff/StaffShell';
import { BackArrow } from '@/components/BackArrow';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { useDriverFigures, FiguresTotals, DriverFiguresLine } from '@/components/reports/DriversFigures';
import type { DriverFigures } from '@/server/reports/driver-report';
import { useDocAttention, withDocsFirst, DocAttentionLines } from '@/components/staff/DocAttention';

export const dynamic = 'force-dynamic';

// «Мой автопарк» (2026-11-20, operator): the fleet owner's only screen — read-only. Today / week totals,
// his drivers with the same figures as the admin's list (tap → the driver's full report), his cars.
interface DriverRow { id: string; login: string; publicName: string; phone: string; active: boolean; onDuty: boolean; vehicle: { plate: string; label: string } | null }
interface CarRow { id: string; plate: string; make: string; model: string; color: string; vClass: string; seats: number; active: boolean; driver: { id: string; publicName: string; onDuty: boolean } | null }

export default function Page() {
  return <StaffShell roles={['FLEET_OWNER', 'DRIVER']}>{(me) => <Fleet me={me} />}</StaffShell>;
}

function Fleet({ me }: { me: Me }) {
  const { t } = useT();
  // A driver who owns a fleet comes here from his menu: «‹» takes him back to the map.
  const isDriver = me.role === 'DRIVER';
  useEffect(() => { if (isDriver && !me.fleet) window.location.replace('/driver'); }, [isDriver, me.fleet]);
  const [name, setName] = useState('');
  const [drivers, setDrivers] = useState<DriverRow[] | null>(null);
  const [cars, setCars] = useState<CarRow[] | null>(null);
  // Documents (2026-11-24): the same red rows on top as the admin's — driving licence on the driver,
  // taxi licence / insurance / roadworthiness on the car.
  const drvDocs = useDocAttention('drivers', '/fleet/doc-attention');
  const carDocs = useDocAttention('vehicles', '/fleet/doc-attention');
  // A car document of a car that isn't his (his driver drives someone else's car): show it on the driver.
  const drvAll = { ...drvDocs };
  for (const items of Object.values(carDocs)) for (const it of items) {
    if (cars?.some((c) => c.id === it.vehicleId)) continue;
    (drvAll[it.driverId] ??= []).push(it);
  }
  const figs = useDriverFigures(() => api<{ drivers: DriverRow[]; figures: DriverFigures[] }>('/fleet/drivers').then((r) => { setDrivers(r.drivers); return r.figures; }));
  useEffect(() => {
    api<{ fleet: { name: string } }>('/fleet/me').then((r) => setName(r.fleet.name)).catch(() => {});
    api<{ vehicles: CarRow[] }>('/fleet/vehicles').then((r) => setCars(r.vehicles)).catch(() => setCars([]));
  }, []);
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6" data-testid="fleet-home">
      <div className="flex items-center gap-1">
        {isDriver && <BackArrow fallback="/driver" className="-ms-2" />}
        <h1 className="min-w-0 truncate text-xl font-bold">{name || t('staff.fleet.title')}</h1>
      </div>
      <div className="mt-4"><FiguresTotals figs={figs} /></div>

      <h2 className="mt-5 font-semibold">{t('staff.fleet.drivers')}</h2>
      <div className="card mt-2 divide-y divide-edge">
        {drivers && withDocsFirst(drivers, (d) => d.id, drvAll).map((d) => (
          <a key={d.id} href={`/fleet/drivers/${d.id}`} className={`block p-3 ${drvAll[d.id] ? 'row-alert' : ''}`} data-testid={`fleet-driver-${d.login}`}>
            <DocAttentionLines items={drvAll[d.id]} owner />
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 font-medium">{d.publicName} <span className="text-xs text-muted">@{d.login}</span></div>
              <span className={`chip shrink-0 ${d.onDuty ? '!text-accent' : ''}`}>{d.onDuty ? t('staff.drivers.onDuty') : t('staff.drivers.off')}</span>
            </div>
            <div className="text-xs text-muted">{d.phone} · {d.vehicle ? `${d.vehicle.label} (${d.vehicle.plate})` : t('staff.drivers.noVehicle')}</div>
            <DriverFiguresLine f={figs[d.id]} />
            <div className="mt-0.5 text-xs font-semibold text-accent">{t('staff.drivers.report')} ›</div>
          </a>
        ))}
        {drivers && drivers.length === 0 && <p className="p-4 text-sm text-muted">{t('staff.fleet.noDrivers')}</p>}
        {!drivers && <p className="p-4 text-sm text-muted">{t('staff.loading')}</p>}
      </div>

      <h2 className="mt-5 font-semibold">{t('staff.fleet.vehicles')}</h2>
      <div className="card mt-2 divide-y divide-edge" data-testid="fleet-cars">
        {cars && withDocsFirst(cars, (v) => v.id, carDocs).map((v) => (
          <div key={v.id} className={`p-3 ${carDocs[v.id] ? 'row-alert' : ''}`}>
            <DocAttentionLines items={carDocs[v.id]} owner />
            <div className="font-medium">{v.color} {v.make} {v.model} <span className="font-mono text-xs text-muted">{v.plate}</span></div>
            <div className="text-xs text-muted">{v.vClass} · {t('staff.vehicles.seatsN', { n: v.seats })} · {v.driver ? t('staff.fleet.drivenBy', { name: v.driver.publicName }) : t('staff.fleet.noDriver')}{v.active ? '' : ` · ${t('staff.inactive')}`}</div>
          </div>
        ))}
        {cars && cars.length === 0 && <p className="p-4 text-sm text-muted">{t('staff.fleet.noVehicles')}</p>}
      </div>
    </div>
  );
}
