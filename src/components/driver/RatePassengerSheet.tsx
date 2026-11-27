'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

// After the ride (2026-11-15): the driver rates the passenger 1–5 stars (optional comment).
export function RatePassengerSheet({ bookingId, passengerName, onDone }: { bookingId: string; passengerName: string; onDone: () => void }) {
  const { t, tp, tError } = useT();
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setErr(null);
    try { await api(`/driver/bookings/${bookingId}/rate-passenger`, { method: 'POST', body: { stars, comment: comment.trim() || undefined } }); onDone(); }
    catch (e) { setErr(tError(e)); }
    finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 [&>*]:max-h-[calc(100dvh-1.5rem)] [&>*]:overflow-y-auto z-50 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="ratepax-title">
      {/* Bigger window and stars (2026-11-17): easy to hit in the car holder. */}
      <div className="flex min-h-[62dvh] w-full max-w-md flex-col justify-center rounded-t-[24px] border border-edge bg-elevated px-6 pt-7 sm:rounded-[24px]" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
        <div className="text-base font-semibold text-accent">✓ {t('driver.close.completed')}</div>
        <h2 id="ratepax-title" className="mt-1 text-2xl font-bold">{t('driver.ratePax.title', { name: passengerName })}</h2>
        <div className="mt-6 flex justify-center gap-2" role="radiogroup" aria-label={t('rides.rate.starsLabel')}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={tp('rides.rate.star', n)} onClick={() => setStars(n)} className="p-1 text-[60px] leading-none">
              <span className={stars >= n ? 'text-accent' : 'text-muted/40'}>★</span>
            </button>
          ))}
        </div>
        {stars > 0 && <textarea className="field mt-5 h-28 resize-none text-base" maxLength={500} placeholder={t('rides.rate.commentPlaceholder')} value={comment} onChange={(e) => setComment(e.target.value)} />}
        {err && <p className="mt-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
        <button className="btn-primary mt-5 min-h-[60px] w-full text-lg" disabled={busy || stars < 1} onClick={submit}>{busy ? t('rides.rate.submitting') : t('rides.rate.submit')}</button>
        <button className="mt-3 block w-full py-3 text-center text-base text-muted hover:text-ink" onClick={onDone}>{t('driver.ratePax.skip')}</button>
      </div>
    </div>
  );
}
