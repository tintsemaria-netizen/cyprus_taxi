'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

interface Preview { estimateCents: number | null; pickupWaitCents: number; stopWaitCents: number; totalCents: number; upfront: boolean; stopLabel: string | null; pickupLabel: string; dropoffLabel: string; passengerName: string }

// Before the final «Завершить» (2026-11-15): show the driver what the trip costs — the estimate
// plus pickup and stop waiting — so any questions can be settled with the passenger first.
// Only «Завершить окончательно» completes the ride; «Назад» returns to navigation.
export function FarePreviewSheet({ bookingId, passengerName, onConfirm, onCancel }: { bookingId: string; passengerName: string; onConfirm: () => void; onCancel: () => void }) {
  const { t, fmt } = useT();
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    api<Preview>(`/driver/bookings/${bookingId}/fare-preview`).then(setP).catch(() => setErr(true));
  }, [bookingId]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="fare-title">
      <div className="w-full max-w-md rounded-t-[20px] border border-edge bg-elevated p-5 sm:rounded-[20px]" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        <h2 id="fare-title" className="text-xl font-bold">{t('driver.close.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('driver.close.subtitle', { name: passengerName })}</p>
        <div className="mt-4 space-y-2 rounded-[14px] border border-edge bg-page p-4">
          {!p && !err && <p className="text-sm text-muted">{t('common.loading')}</p>}
          {err && <p className="text-sm text-danger">{t('driver.close.loadFailed')}</p>}
          {p && (
            <>
              <Line k={p.upfront ? t('driver.close.fare') : t('driver.close.estimate')} v={p.estimateCents != null ? fmt.money(p.estimateCents) : '—'} />
              {p.pickupWaitCents > 0 && <Line k={t('driver.close.pickupWait')} v={`+ ${fmt.money(p.pickupWaitCents)}`} />}
              {p.stopWaitCents > 0 && <Line k={t('driver.close.stopWait')} v={`+ ${fmt.money(p.stopWaitCents)}`} />}
              <Line k={t('driver.close.total')} v={fmt.money(p.totalCents)} strong />
              {!p.upfront && <p className="pt-1 text-xs text-muted">{t('driver.close.meterNote')}</p>}
            </>
          )}
        </div>
        <button className="btn-primary mt-4 min-h-[52px] w-full text-base" onClick={onConfirm}>{t('driver.close.confirm')}</button>
        <button className="btn-ghost mt-2 min-h-[48px] w-full" onClick={onCancel}>{t('driver.close.back')}</button>
      </div>
    </div>
  );
}

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? 'border-t border-edge pt-2 text-lg font-bold' : 'text-sm'}`}><span className={strong ? '' : 'text-muted'}>{k}</span><span className={strong ? 'text-accent' : ''}>{v}</span></div>
  );
}
