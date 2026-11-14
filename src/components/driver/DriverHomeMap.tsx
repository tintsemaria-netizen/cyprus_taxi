'use client';

import { useEffect, useMemo, useState } from 'react';
import AutoMapView, { type MapMarker } from '@/components/AutoMapView';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

type FleetCar = { lat: number; lng: number; stale?: boolean; state?: 'available' | 'busy' };

const CYPRUS = { lat: 34.92, lng: 33.2 };

// Driver home map: the driver's own car (from the live GPS fix, when sharing) and the other
// on-duty cars (anonymised, available/busy), refreshed every 10 s while the page is visible.
// Without a GPS fix the map shows the whole island (zoom 8) so cars on the coast stay in view.
// `fullscreen`: the map fills the screen behind the driver Home overlays (2026-11-12); counts are
// reported through `onCounts` so the overlay can show them as a button.
// `pickup`: a new offer's pickup point — drawn as the client marker, and the map frames the driver's
// car and the client together (fitPadding keeps both clear of the overlays).
export function DriverHomeMap({ pos, fullscreen = false, onCounts, pickup = null, fitPadding }: {
  pos: { lat: number; lng: number } | null; fullscreen?: boolean; onCounts?: (free: number, busy: number) => void;
  pickup?: { lat: number; lng: number; label: string } | null; fitPadding?: { top: number; right: number; bottom: number; left: number };
}) {
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

  const markers = useMemo<MapMarker[]>(() => [
    ...(pos ? [{ id: 'me', kind: 'vehicle' as const, self: true, lat: pos.lat, lng: pos.lng, label: t('driver.map.you') }] : []),
    ...(pickup ? [{ id: 'pickup', kind: 'pickup' as const, lat: pickup.lat, lng: pickup.lng, label: pickup.label }] : []),
  ], [pos, pickup, t]);
  const free = fleet.filter((v) => v.state !== 'busy').length;
  const busy = fleet.length - free;
  useEffect(() => { onCounts?.(free, busy); }, [free, busy, onCounts]);

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-0">
        <AutoMapView markers={markers} fleet={pickup ? [] : fleet} focus={pickup ? null : pos} center={pos ?? CYPRUS} zoom={pos ? 14 : 8} interactive fitPadding={fitPadding} className="h-full w-full" />
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="relative h-60">
        <AutoMapView markers={markers} fleet={fleet} focus={pos} center={pos ?? CYPRUS} zoom={pos ? 13 : 8} interactive className="h-full w-full" />
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
