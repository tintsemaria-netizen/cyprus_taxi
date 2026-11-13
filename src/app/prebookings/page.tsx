'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { PassengerLoginModal } from '@/components/booking/PassengerLoginModal';
import { NotifyToggle } from '@/components/NotifyToggle';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

export const dynamic = 'force-dynamic';

interface Prebooking {
  id: string; reference: string; status: string; at: string; pickup: string; dropoff: string;
  note: string | null; fareCents: number | null; driverConfirmed: string | null; soon: boolean;
}

// "My pre-bookings" (2026-11-13): the passenger's upcoming scheduled rides, soonest first, with a
// switch for reminder notifications (account-wide) and a way to open each ride.
export default function Page() {
  const router = useRouter();
  const { t, fmt } = useT();
  const [items, setItems] = useState<Prebooking[] | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [show, setShow] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await api<{ prebookings: Prebooking[] }>('/passenger/prebookings'); setItems(r.prebookings); setNeedLogin(false); }
    catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) { setNeedLogin(true); setItems([]); }
      else setItems((x) => x ?? []);
    }
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 60_000); return () => clearInterval(iv); }, [load]);

  async function open(id: string) {
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
      <h1 className="mb-1 text-xl font-bold">{t('rides.prebookings.title')}</h1>
      <p className="mb-3 text-sm text-muted">{t('rides.prebookings.subtitle')}</p>
      {needLogin ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-muted">{t('rides.signInPrompt')}</p>
          <button className="btn-primary mt-3" onClick={() => setShow(true)}>{t('rides.signIn')}</button>
        </div>
      ) : items === null ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : (
        <>
          <div className="card mb-3 px-3 py-2"><NotifyToggle pushUrl="/passenger/push" /></div>
          {items.length === 0 ? (
            <p className="text-sm text-muted">{t('rides.prebookings.empty')}</p>
          ) : (
            <div className="space-y-2">
              {items.map((b) => (
                <button key={b.id} onClick={() => open(b.id)} className={`card block w-full p-3 text-left ${b.soon ? 'border-2 border-accent' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{fmt.dateTime(b.at)}</span>
                    {b.soon ? <span className="chip !text-accent">⏰ {t('rides.prebookings.soon')}</span> : <span className="chip">{t(`common.status.${b.status}` as 'common.status.COMPLETED')}</span>}
                  </div>
                  <div className="mt-2 space-y-1 text-sm">
                    <div className="flex gap-2"><span className="text-accent">●</span><span className="min-w-0">{b.pickup}</span></div>
                    <div className="flex gap-2"><span className="text-muted">○</span><span className="min-w-0">{b.dropoff}</span></div>
                  </div>
                  {b.note && <p className="mt-2 text-xs text-muted">💬 {b.note}</p>}
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-muted">{b.driverConfirmed ? `✓ ${t('rides.prebookings.driver', { name: b.driverConfirmed })}` : t('rides.prebookings.noDriverYet')}</span>
                    <span className="text-accent">{t('rides.prebookings.open')} ›</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          <a href="/" className="btn-ghost mt-4 w-full">＋ {t('booking.prebooked.another')}</a>
        </>
      )}
      {toast && <p role="alert" className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-lg rounded-[12px] border border-danger/40 bg-panel px-3 py-2 text-sm text-danger shadow-card">{toast}</p>}
      {show && <PassengerLoginModal onClose={() => setShow(false)} onDone={() => { setShow(false); load(); }} />}
    </div>
  );
}
