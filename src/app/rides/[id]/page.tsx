'use client';

import { use, useEffect, useState } from 'react';
import { PassengerTopBar } from '@/components/PassengerTopBar';
import AutoMapView, { type MapMarker } from '@/components/AutoMapView';
import { RateTripModal } from '@/components/booking/RateTripModal';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import type { MsgKey } from '@/i18n/I18nProvider';
import { useRefreshOnReturn } from '@/components/useRefreshOnReturn';

export const dynamic = 'force-dynamic';

// A ride from «Мои поездки» (2026-11-20): map with the whole route, when, how it ended and — for a
// completed ride — driver, car, distance, time on the way, total, rating and the «Чек» button.
interface Pt { label: string; lat: number; lng: number }
interface Ride {
  id: string; reference: string; status: string; at: string;
  pickup: Pt; stop: Pt | null; dropoff: Pt;
  vClass: string; passengerCount: number; luggageCount: number;
  completed: null | {
    at: string | null; startedAt: string | null; driver: { name: string; vehicle: string; plate: string } | null;
    totalCents: number | null; currency: string; paymentMethod: string; distanceKm: number | null; durationMin: number | null;
  };
  rating: { stars: number } | null;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [reloadN, setReloadN] = useState(0);
  const { t, tp, fmt } = useT();
  const [ride, setRide] = useState<Ride | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [route, setRoute] = useState<[number, number][]>([]);
  const [rating, setRating] = useState(false);

  useEffect(() => {
    (async () => {
      try { setRide(await api<Ride>(`/passenger/rides/${id}`)); }
      catch (e) {
        if (e instanceof ApiRequestError) { setNeedLogin(e.status === 401); setError(e.status === 401 ? t('rides.signInPrompt') : e.body.message); }
        else setError(t('rides.loadError'));
      }
    })();
  }, [id, t, reloadN]);
  useRefreshOnReturn(() => setReloadN((n) => n + 1)); // e.g. the driver's final amount arrived meanwhile

  // The road route (pickup → stop → drop-off) for the map.
  useEffect(() => {
    if (!ride) return;
    let alive = true;
    api<{ available?: boolean; path?: [number, number][] }>('/routes/estimate', {
      method: 'POST', body: { from: ride.pickup, to: ride.dropoff, ...(ride.stop ? { via: ride.stop } : {}) },
    }).then((r) => { if (alive && r.available !== false && r.path) setRoute(r.path.map(([la, ln]) => [ln, la] as [number, number])); })
      .catch(() => { /* markers only */ });
    return () => { alive = false; };
  }, [ride]);

  const markers: MapMarker[] = ride ? [
    { id: 'p', kind: 'pickup', lat: ride.pickup.lat, lng: ride.pickup.lng },
    ...(ride.stop ? [{ id: 's', kind: 'stop' as const, lat: ride.stop.lat, lng: ride.stop.lng }] : []),
    { id: 'd', kind: 'dropoff', lat: ride.dropoff.lat, lng: ride.dropoff.lng },
  ] : [];

  const statusText = (s: string) => s === 'NO_DRIVER' ? t('rides.detail.notHappened') : t(`common.status.${s}` as MsgKey);
  const c = ride?.completed ?? null;
  const stars = ride?.rating?.stars ?? null;

  return (
    <div>
      <PassengerTopBar back="/rides" />
      <div className="mx-auto max-w-lg p-4 sm:p-6">
        {error ? (
          <div className="card p-6 text-center text-sm text-muted">
            {error}
            {needLogin && <a href={`/login?next=${encodeURIComponent(`/rides/${id}`)}`} className="btn-primary mt-4 w-full">{t('auth.signIn')}</a>}
          </div>
        ) : !ride ? (
          <p className="text-muted">{t('common.loading')}</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-[16px] border border-edge" data-testid="ride-map">
              <AutoMapView markers={markers} route={route.length ? route : undefined} center={ride.pickup} zoom={12} fitRoute
                interactive className="h-60 w-full" fitPadding={{ top: 40, right: 40, bottom: 40, left: 40 }} />
            </div>

            <div className="card mt-3 p-4" data-testid="ride-detail">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-lg font-bold">{fmt.dateTime(ride.at)}</h1>
                  <p className="text-xs text-muted">#{ride.reference}</p>
                </div>
                <span className="chip shrink-0">{statusText(ride.status)}</span>
              </div>

              <div className="mt-3 space-y-1.5 text-sm">
                <div className="flex gap-2"><span className="text-accent">●</span><span className="min-w-0">{ride.pickup.label}</span></div>
                {ride.stop && <div className="flex gap-2"><span className="text-[#FFC83D]">◆</span><span className="min-w-0">{ride.stop.label}</span></div>}
                <div className="flex gap-2"><span className="text-muted">○</span><span className="min-w-0">{ride.dropoff.label}</span></div>
              </div>

              {c && (
                <dl className="mt-4 divide-y divide-edge border-t border-edge text-sm">
                  {c.driver && <Row k={t('rides.detail.driver')} v={c.driver.name} />}
                  {c.driver && <Row k={t('rides.detail.car')} v={<>{c.driver.vehicle} · <span className="font-mono">{c.driver.plate}</span></>} />}
                  <Row k={t('booking.review.class')} v={t(`common.vClass.${ride.vClass}` as MsgKey)} />
                  {c.distanceKm != null && <Row k={t('rides.detail.distance')} v={t('rides.detail.km', { km: c.distanceKm.toLocaleString(undefined, { maximumFractionDigits: 1 }) })} />}
                  {c.durationMin != null && <Row k={t('rides.detail.duration')} v={tp('common.minutes', c.durationMin)} />}
                  <Row k={t('rides.detail.payment')} v={c.paymentMethod === 'CASH_TO_DRIVER' ? t('common.payment.CASH_TO_DRIVER') : c.paymentMethod} />
                  <div className="flex items-baseline justify-between py-2.5">
                    <dt className="font-semibold">{t('rides.receipt.total')}</dt>
                    <dd className="text-lg font-bold tabular-nums">{c.totalCents != null ? fmt.money(c.totalCents, c.currency) : '—'}</dd>
                  </div>
                </dl>
              )}

              {ride.status === 'COMPLETED' && (
                <div className="mt-2 flex items-center justify-between border-t border-edge pt-3 text-sm">
                  <span className="text-muted">{t('rides.receipt.yourRating')}</span>
                  {stars != null
                    ? <span className="text-lg text-accent">{'★'.repeat(stars)}<span className="text-muted/40">{'★'.repeat(5 - stars)}</span></span>
                    : <button type="button" className="text-accent hover:underline" onClick={() => setRating(true)}>{t('rides.rateTrip')}</button>}
                </div>
              )}
            </div>

            {ride.status === 'COMPLETED' && (
              <a href={`/rides/${ride.id}/receipt`} className="btn-primary mt-3 w-full" data-testid="ride-receipt">🧾 {t('rides.detail.receipt')}</a>
            )}
          </>
        )}
      </div>
      {rating && ride && <RateTripModal rideId={ride.id} onClose={() => setRating(false)} onDone={(s) => { setRide({ ...ride, rating: { stars: s } }); setRating(false); }} />}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <dt className="text-muted">{k}</dt>
      <dd className="min-w-0 text-end">{v}</dd>
    </div>
  );
}
