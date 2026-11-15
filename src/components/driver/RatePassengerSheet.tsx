'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

// After the ride (2026-11-15): the driver rates the passenger 1–5 stars (optional comment).
export function RatePassengerSheet({ bookingId, passengerName, onDone }: { bookingId: string; passengerName: string; onDone: () => void }) {
  const { t, tp, tError } = useT();
  const [stars, setStars] = useState(0);
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="ratepax-title">
      <div className="w-full max-w-md rounded-t-[20px] border border-edge bg-elevated p-5 sm:rounded-[20px]" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        <div className="text-sm font-semibold text-accent">✓ {t('driver.close.completed')}</div>
        <h2 id="ratepax-title" className="mt-1 text-xl font-bold">{t('driver.ratePax.title', { name: passengerName })}</h2>
        <div className="mt-4 flex justify-center gap-1" role="radiogroup" aria-label={t('rides.rate.starsLabel')}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={tp('rides.rate.star', n)} onClick={() => setStars(n)} className="p-1 text-4xl leading-none">
              <span className={stars >= n ? 'text-accent' : 'text-muted/40'}>★</span>
            </button>
          ))}
        </div>
        {stars > 0 && <textarea className="field mt-3 h-20 resize-none" maxLength={500} placeholder={t('rides.rate.commentPlaceholder')} value={comment} onChange={(e) => setComment(e.target.value)} />}
        {err && <p className="mt-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
        <button className="btn-primary mt-4 min-h-[52px] w-full text-base" disabled={busy || stars < 1} onClick={submit}>{busy ? t('rides.rate.submitting') : t('rides.rate.submit')}</button>
        <button className="mt-2 block w-full py-2 text-center text-sm text-muted hover:text-ink" onClick={onDone}>{t('driver.ratePax.skip')}</button>
      </div>
    </div>
  );
}
