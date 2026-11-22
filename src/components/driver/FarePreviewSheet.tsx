'use client';

import EdgeShine from '@/components/EdgeShine';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

interface Preview { gpsMeter?: { totalCents: number; totalKm: number } | null; estimateCents: number | null; pickupWaitCents: number; stopWaitCents: number; totalCents: number; minCents?: number | null; minZone?: string | null; upfront: boolean; stopLabel: string | null; pickupLabel: string; dropoffLabel: string; passengerName: string }

// Before the final «Завершить» (2026-11-15): show the driver what the trip costs — the total, with
// any pickup / stop waiting listed above it (2026-11-17: no separate estimate line, no subtitle).
// Only «Завершить окончательно» completes the ride; «Назад» returns to navigation.
export function FarePreviewSheet({ bookingId, passengerName: _passengerName, onConfirm, onCancel }: { bookingId: string; passengerName: string; onConfirm: () => void; onCancel: () => void }) {
  const { t, fmt, locale } = useT();
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    api<Preview>(`/driver/bookings/${bookingId}/fare-preview`).then(setP).catch(() => setErr(true));
  }, [bookingId]);

  return (
    // No «Назад» button (2026-11-17): a tap on the dimmed map around the sheet closes it instead.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="fare-title"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="w-full max-w-md rounded-t-[20px] border border-edge bg-elevated p-5 sm:rounded-[20px]" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        <h2 id="fare-title" className="text-xl font-bold">{t('driver.close.title')}</h2>
        {/* Big, centred figures (2026-11-17); no «Окончательная сумма — по таксометру» note. */}
        <div className="mt-4 space-y-3 rounded-[14px] border border-edge bg-page p-4 text-center">
          {!p && !err && <p className="text-sm text-muted">{t('common.loading')}</p>}
          {err && <p className="text-sm text-danger">{t('driver.close.loadFailed')}</p>}
          {p && (
            <>
              {/* Only the total (2026-11-17): waiting is included in it, not listed. */}
              <Line k={t('driver.close.total')} v={fmt.money(p.totalCents)} strong />
              {/* GPS taximeter for comparison with the car's meter (2026-11-19; not charged). */}
              {p.minCents != null && <p className="rounded-[10px] border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-ink" data-testid="prebook-min">{t('driver.close.prebookMin', { amount: fmt.money(p.minCents), zone: p.minZone ?? '' })}</p>}
              {p.gpsMeter && <Line k={`${t('driver.gpsMeter.preview')} · ${t('driver.gpsMeter.km', { km: p.gpsMeter.totalKm.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}`} v={fmt.money(p.gpsMeter.totalCents)} />}
            </>
          )}
        </div>
        {/* Red, like «Завершить поездку» on the navigation screen (2026-11-17). */}
        <button className="relative mx-auto mt-4 block h-[53px] w-[65%] rounded-full bg-[#7A1E1E] text-[16px] font-bold text-white" onClick={onConfirm}><EdgeShine />{t('driver.close.confirm')}</button>
      </div>
    </div>
  );
}

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div>
      <div className={`text-sm ${strong ? 'font-semibold text-ink' : 'text-muted'}`}>{k}</div>
      <div className={`font-bold tabular-nums leading-tight ${strong ? 'text-[44px] text-accent' : 'text-[28px] text-ink'}`}>{v}</div>
    </div>
  );
}
