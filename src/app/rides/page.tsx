'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { PassengerLoginModal } from '@/components/booking/PassengerLoginModal';
import { RateTripModal } from '@/components/booking/RateTripModal';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

export const dynamic = 'force-dynamic';

interface Ride { id: string; reference: string; status: string; active: boolean; at: string; pickup: string; dropoff: string; fareCents: number | null; ratedStars: number | null }

export default function Page() {
  const router = useRouter();
  const { t, fmt } = useT();
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [show, setShow] = useState(false);
  const [rating, setRating] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try { const r = await api<{ rides: Ride[] }>('/passenger/rides'); setRides(r.rides); setNeedLogin(false); }
    catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) { setNeedLogin(true); setRides([]); }
      else setLoadError(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function openTracking(id: string) {
    try {
      const r = await api<{ token: string }>(`/passenger/rides/${id}/track`, { method: 'POST' });
      await api('/tracking/exchange', { method: 'POST', body: { token: r.token } });
      router.push('/track');
    } catch {
      setToast(t('rides.trackingFailed'));
      setTimeout(() => setToast(null), 5000);
    }
  }

  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6">
      <header className="mb-4 flex items-center justify-between">
        <a href="/"><Logo className="h-8" /></a>
        <a href="/" className="text-sm text-muted hover:text-ink">{t('common.book')}</a>
      </header>
      <h1 className="mb-3 text-xl font-bold">{t('rides.title')}</h1>
      {needLogin ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-muted">{t('rides.signInPrompt')}</p>
          <button className="btn-primary mt-3" onClick={() => setShow(true)}>{t('rides.signIn')}</button>
        </div>
      ) : loadError && rides === null ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-muted">{t('rides.loadError')}</p>
          <button className="btn-primary mt-3" onClick={load}>{t('common.retry')}</button>
        </div>
      ) : rides === null ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : rides.length === 0 ? (
        <p className="text-sm text-muted">{t('rides.empty')} <a href="/" className="text-accent hover:underline">{t('rides.bookFirst')}</a></p>
      ) : (
        <div className="card divide-y divide-edge">
          {rides.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{r.pickup} → {r.dropoff}</div>
                <div className="text-xs text-muted">{fmt.dateTime(r.at)} · {r.fareCents != null ? `≈ ${fmt.money(r.fareCents)}` : '—'}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="chip">{t(`common.status.${r.status}` as 'common.status.COMPLETED')}</div>
                {r.active && <button className="mt-1 block text-xs text-accent hover:underline" onClick={() => openTracking(r.id)}>{t('rides.trackLive')}</button>}
                {!r.active && r.status === 'COMPLETED' && (
                  <>
                    {r.ratedStars != null
                      ? <div className="mt-1 text-xs text-accent" aria-label={t('rides.youRated', { stars: r.ratedStars })}>{'★'.repeat(r.ratedStars)}<span className="text-muted/40">{'★'.repeat(5 - r.ratedStars)}</span></div>
                      : <button className="mt-1 block text-xs text-accent hover:underline" onClick={() => setRating(r.id)}>{t('rides.rateTrip')}</button>}
                    <a className="mt-1 block text-xs text-muted hover:text-ink" href={`/rides/${r.id}`}>{t('rides.receiptLink')}</a>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {toast && <p role="alert" className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-lg rounded-[12px] border border-danger/40 bg-panel px-3 py-2 text-sm text-danger shadow-card">{toast}</p>}
      {show && <PassengerLoginModal onClose={() => setShow(false)} onDone={() => { setShow(false); load(); }} />}
      {rating && <RateTripModal rideId={rating} onClose={() => setRating(null)} onDone={(stars) => { setRides((rs) => rs ? rs.map((x) => x.id === rating ? { ...x, ratedStars: stars } : x) : rs); setRating(null); }} />}
    </div>
  );
}
