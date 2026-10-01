'use client';

import { useEffect, useRef, useState } from 'react';
import AutoMapView, { MapMarker } from '@/components/AutoMapView';
import { Logo } from '@/components/Brand';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import type { MsgKey } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

export const dynamic = 'force-dynamic';

// Read-only "share my trip" page (2026-10-01 audit). The token lives only in the link fragment and
// is POSTed to the API; the view never includes the start code, phone numbers, chat or cancel.

interface ShareView {
  reference: string;
  status: string;
  pickup: { label: string; lat: number; lng: number };
  dropoff: { label: string; lat: number; lng: number };
  vehicle: null | { driverName: string; make: string; model: string; color: string; plate: string };
  location: null | { lat: number; lng: number; freshness: string; sampledAt: string };
  pickupEta: string | null;
  pickupEtaMin: number | null;
  pickupEtaApprox: boolean;
}

const STATUS_KEYS = new Set(['REQUESTED', 'SEARCHING', 'NO_DRIVER', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']);

export default function SharePage() {
  const { t, tp, tError } = useT();
  const [view, setView] = useState<ShareView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const token = useRef<string>('');

  useEffect(() => {
    token.current = new URLSearchParams(window.location.hash.slice(1)).get('t') || '';
    if (!token.current) { setError(t('track.share.incomplete')); return; }
    let alive = true;
    const load = async () => {
      try {
        const v = await api<ShareView>('/share/view', { method: 'POST', body: { token: token.current }, timeoutMs: 9000 });
        if (alive) { setView(v); setError(null); }
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiRequestError && e.status === 404) setError(tError(e));
      }
    };
    load();
    const iv = setInterval(load, 5000);
    return () => { alive = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error && !view) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center px-4">
        <div className="card max-w-sm p-6 text-center">
          <Logo className="mb-4 justify-center" />
          <p className="text-sm text-muted">{error}</p>
        </div>
      </div>
    );
  }
  if (!view) return <div className="flex min-h-[100dvh] items-center justify-center text-muted">{t('track.share.loading')}</div>;

  const markers: MapMarker[] = [];
  if (view.status === 'IN_PROGRESS') markers.push({ id: 'd', lat: view.dropoff.lat, lng: view.dropoff.lng, kind: 'dropoff', label: view.dropoff.label });
  else markers.push({ id: 'p', lat: view.pickup.lat, lng: view.pickup.lng, kind: 'pickup', label: view.pickup.label });
  if (view.location) markers.push({ id: 'v', lat: view.location.lat, lng: view.location.lng, kind: 'vehicle', label: t('track.share.car'), stale: view.location.freshness === 'stale' });

  const etaMinText = view.pickupEtaMin != null ? tp('common.minutes', view.pickupEtaMin) : null;
  const etaText = etaMinText ? (view.pickupEtaApprox ? t('track.etaApprox', { min: etaMinText }) : etaMinText) : null;
  const statusLabel = STATUS_KEYS.has(view.status) ? t(`track.share.status.${view.status}` as MsgKey) : view.status;

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden">
      <header className="z-20 flex items-center justify-between border-b border-edge bg-page/90 px-4 py-3 backdrop-blur">
        <Logo />
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted min-[400px]:inline">{t('track.share.headerTag')}</span>
          <LanguageSwitcher compact />
        </div>
      </header>
      <div className="relative flex-1">
        <div className="absolute inset-0">
          <AutoMapView markers={markers} center={view.location ?? view.pickup} zoom={13} interactive className="h-full w-full" />
        </div>
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end sm:block">
          <div className="pointer-events-auto w-full sm:absolute sm:bottom-4 sm:left-4 sm:w-[400px]">
            <div className="card max-h-[60dvh] overflow-y-auto p-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
              <h1 className="text-xl font-bold" role="status" aria-live="polite">
                {etaText && view.status !== 'IN_PROGRESS' ? t('track.share.headlineEta', { status: statusLabel, eta: etaText }) : statusLabel}
              </h1>
              {view.vehicle && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-[12px] border border-edge bg-elevated p-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{view.vehicle.driverName}</div>
                    <div className="truncate text-sm text-muted">{view.vehicle.color} {view.vehicle.make} {view.vehicle.model}</div>
                  </div>
                  <span className="shrink-0 rounded-[8px] border border-edge px-2 py-1 font-mono text-base font-bold">{view.vehicle.plate}</span>
                </div>
              )}
              <div className="mt-3 space-y-1 text-sm">
                <div className="flex gap-2"><span className="text-accent">●</span><span className="min-w-0">{view.pickup.label}</span></div>
                <div className="flex gap-2"><span className="text-muted">○</span><span className="min-w-0">{view.dropoff.label}</span></div>
              </div>
              {!view.location && ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(view.status) && (
                <p className="mt-2 text-xs text-muted">{t('track.share.noPosition')}</p>
              )}
              <p className="mt-3 text-xs text-muted">{(() => {
                const [before, after = ''] = t('track.share.footer', { ref: view.reference, phone: '\u0000' }).split('\u0000');
                return <>{before}<a href="tel:112" className="font-semibold text-danger">112</a>{after}</>;
              })()}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
