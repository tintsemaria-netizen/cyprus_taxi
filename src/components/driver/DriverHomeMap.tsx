'use client';

import { useEffect, useMemo, useState } from 'react';
import AutoMapView, { type MapMarker } from '@/components/AutoMapView';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

type FleetCar = { lat: number; lng: number; stale?: boolean; state?: 'available' | 'busy' };

const CYPRUS = { lat: 34.92, lng: 33.2 };

// Driver home map: the driver's own car (from the live GPS fix, when sharing) and the other
// on-duty cars (anonymised, available/busy), refreshed every 10 s while the page is visible.
export function DriverHomeMap({ pos }: { pos: { lat: number; lng: number } | null }) {
  const { t } = useT();
  const [fleet, setFleet] = useState<FleetCar[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      api<{ vehicles: FleetCar[] }>('/driver/fleet', { timeoutMs: 8000 })
        .then((r) => { if (alive) setFleet(r.vehicles); })
        .catch(() => { /* keep last known */ });
    };
    load();
    const id = setInterval(load, 10_000);
    document.addEventListener('visibilitychange', load);
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', load); };
  }, []);

  const markers = useMemo<MapMarker[]>(() => (pos ? [{ id: 'me', kind: 'vehicle', lat: pos.lat, lng: pos.lng, label: t('driver.map.you') }] : []), [pos, t]);
  const free = fleet.filter((v) => v.state !== 'busy').length;
  const busy = fleet.length - free;

  return (
    <div className="card overflow-hidden">
      <div className="relative h-60">
        <AutoMapView markers={markers} fleet={fleet} focus={pos} center={pos ?? CYPRUS} zoom={pos ? 13 : 9} interactive className="h-full w-full" />
        {!pos && (
          <div className="pointer-events-none absolute inset-x-2 top-2 rounded-[10px] bg-page/85 px-3 py-1.5 text-xs text-muted">{t('driver.map.noGps')}</div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-4 py-2 text-xs text-muted">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent align-middle" />{t('driver.map.free', { n: free })}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-muted align-middle" />{t('driver.map.busy', { n: busy })}</span>
      </div>
    </div>
  );
}
