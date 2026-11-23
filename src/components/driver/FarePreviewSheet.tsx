'use client';

import EdgeShine from '@/components/EdgeShine';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

interface Preview { gpsMeter?: { totalCents: number; totalKm: number } | null; estimateCents: number | null; pickupWaitCents: number; stopWaitCents: number; totalCents: number; minCents?: number | null; minZone?: string | null; upfront: boolean; stopLabel: string | null; pickupLabel: string; dropoffLabel: string; passengerName: string }

// Before the final «Завершить» (2026-11-15): show the driver what the trip costs — the total, with
// any pickup / stop waiting listed above it (2026-11-17: no separate estimate line, no subtitle).
// Only «Завершить окончательно» completes the ride; «Назад» returns to navigation.
export function FarePreviewSheet({ bookingId, passengerName: _passengerName, onConfirm, onCancel }: { bookingId: string; passengerName: string; onConfirm: (meterCents?: number) => void; onCancel: () => void }) {
  const { t, fmt, locale } = useT();
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState(false);
  // Operator 2026-11-24: a meter ride's amount can be changed ONLY here, before «Завершить»; then it is fixed.
  // «Есть вопросы?» → «Изменить цену» → the amount field (operator 2026-11-24): two taps before any change.
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const edit = step === 2;
  const [amount, setAmount] = useState('');
  const typed = amount ? Math.round(parseFloat(amount.replace(',', '.')) * 100) : null;
  const typedBad = typed != null && (!Number.isFinite(typed) || typed < 0 || (p?.minCents != null && typed < p.minCents));
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
              <Line k={t('driver.close.total')} v={fmt.money(typed != null && !typedBad ? typed : p.totalCents)} strong />
              {!p.upfront && step === 0 && <button type="button" className="text-sm text-muted underline underline-offset-2" onClick={() => setStep(1)} data-testid="fare-questions">{t('driver.close.questions')}</button>}
              {!p.upfront && step === 1 && <button type="button" className="mx-auto block rounded-full border border-accent px-4 py-2 text-sm font-semibold text-accent" onClick={() => setStep(2)} data-testid="fare-edit">{t('driver.close.changePrice')}</button>}
              {!p.upfront && edit && (
                <div className="text-start" data-testid="fare-edit-box">
                  <label className="text-xs text-muted" htmlFor="fare-amount">{t('driver.close.editLabel')}</label>
                  <input id="fare-amount" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} placeholder={(p.totalCents / 100).toFixed(2)}
                    className={`mt-1 w-full rounded-[10px] border bg-elevated px-3 py-2 text-lg tabular-nums ${typedBad ? 'border-danger' : 'border-edge'}`} data-testid="fare-amount" />
                  <p className={`mt-1 text-xs ${typedBad ? 'text-danger' : 'text-muted'}`}>{typedBad && p.minCents != null ? t('driver.close.belowMin', { amount: fmt.money(p.minCents) }) : t('driver.close.editNote')}</p>
                </div>
              )}
              {/* GPS taximeter for comparison with the car's meter (2026-11-19; not charged). */}
              {p.minCents != null && <p className="rounded-[10px] border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-ink" data-testid="prebook-min">{t('driver.close.prebookMin', { amount: fmt.money(p.minCents), zone: p.minZone ?? '' })}</p>}
              {p.gpsMeter && <Line k={`${t('driver.gpsMeter.preview')} · ${t('driver.gpsMeter.km', { km: p.gpsMeter.totalKm.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}`} v={fmt.money(p.gpsMeter.totalCents)} />}
            </>
          )}
        </div>
        {/* Red, like «Завершить поездку» on the navigation screen (2026-11-17). */}
        <button className="relative mx-auto mt-4 block h-[53px] w-[65%] rounded-full bg-[#7A1E1E] text-[16px] font-bold text-white" disabled={typedBad} onClick={() => onConfirm(typed != null && !typedBad ? typed : undefined)}><EdgeShine />{t('driver.close.confirm')}</button>
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
