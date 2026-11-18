'use client';

import { PassengerTopBar } from '@/components/PassengerTopBar';
import { use, useEffect, useState } from 'react';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { GoogleReviewCard } from '@/components/GoogleReviewCard';

export const dynamic = 'force-dynamic';

interface Line { label: string; cents: number }
interface Receipt {
  reference: string;
  completedAt: string | null;
  pickup: string;
  dropoff: string;
  stop?: string | null;
  vClass: string;
  passengerCount: number;
  driver: { name: string; vehicle: string; plate: string } | null;
  fare: {
    priceType: string; currency: string; isUpfront: boolean;
    estimateCents: number | null; waitingCents: number; finalCents: number | null; totalCents: number | null;
    lines: Line[]; note: string; paymentMethod: string; paymentStatus: string;
  };
  rating: { stars: number } | null;
  email: { status: string; to: string; sentAt: string | null; canResend: boolean } | null;
  canEmail: boolean;
}


export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, fmt } = useT();
  const eur = (cents: number, ccy: string) => fmt.money(cents, ccy);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [mailBusy, setMailBusy] = useState(false);
  const [mailNote, setMailNote] = useState<string | null>(null);

  async function sendMail() {
    setMailBusy(true); setMailNote(null);
    try {
      await api(`/passenger/rides/${id}/receipt/email`, { method: 'POST' });
      setMailNote(t('rides.receipt.emailRequested'));
      setReceipt(await api<Receipt>(`/passenger/rides/${id}/receipt`));
    } catch (e) {
      setMailNote(e instanceof ApiRequestError && e.body.code === 'RESEND_LIMIT' ? t('rides.receipt.emailLimit') : e instanceof ApiRequestError ? e.body.message : t('rides.receipt.loadFailed'));
    } finally { setMailBusy(false); }
  }

  useEffect(() => {
    (async () => {
      try { setReceipt(await api<Receipt>(`/passenger/rides/${id}/receipt`)); }
      catch (e) {
        if (e instanceof ApiRequestError) { setError(e.status === 401 ? t('rides.receipt.signInToView') : e.body.message); setNeedLogin(e.status === 401); }
        else setError(t('rides.receipt.loadFailed'));
      }
    })();
  }, [id, t]);

  const f = receipt?.fare;

  return (
    <div>
    <PassengerTopBar back={'/rides'} />
    <div className="mx-auto max-w-lg p-4 sm:p-6">

      {error ? (
        <div className="card p-6 text-center text-sm text-muted">
          {error}
          {needLogin && <a href={`/login?next=${encodeURIComponent(`/rides/${id}`)}`} className="btn-primary mt-4 w-full" data-testid="receipt-login">{t('auth.signIn')}</a>}
        </div>
      ) : !receipt ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : (
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold">{t('rides.receipt.title')}</h1>
            <span className="text-xs text-muted">#{receipt.reference}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {receipt.completedAt ? fmt.dateTime(receipt.completedAt) : t('rides.receipt.completed')}
          </p>

          <div className="mt-4 space-y-1 text-sm">
            <div className="flex gap-2"><span className="text-accent">●</span><span className="min-w-0">{receipt.pickup}</span></div>
            {receipt.stop && <div className="flex gap-2"><span className="text-[#FFC83D]">◆</span><span className="min-w-0">{receipt.stop}</span></div>}
            <div className="flex gap-2"><span className="text-muted">○</span><span className="min-w-0">{receipt.dropoff}</span></div>
          </div>


          {f && (
            <div className="mt-4 border-t border-edge pt-3">
              {/* Receipt (2026-11-18): just the total — no class / passengers / driver / fare lines / meter note. */}
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{t('rides.receipt.total')}</span>
                <span className="text-lg font-bold tabular-nums">
                  {f.totalCents != null ? eur(f.totalCents, f.currency) : '—'}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-muted">{f.paymentMethod === 'CASH_TO_DRIVER' ? t('common.payment.CASH_TO_DRIVER') : f.paymentMethod}</span>
                <span className={f.paymentStatus === 'COLLECTED' ? 'text-accent' : 'text-muted'}>
                  {f.paymentStatus === 'COLLECTED' ? t('rides.receipt.paid') : t('rides.receipt.paymentPending')}
                </span>
              </div>
            </div>
          )}

          {/* E-mailed copy (2026-11-17). */}
          {receipt.email && (
            <div className="mt-4 border-t border-edge pt-3 text-sm" data-testid="receipt-email">
              <div className={receipt.email.status === 'FAILED' ? 'text-danger' : 'text-muted'}>
                {receipt.email.status === 'SENT' ? `✉️ ${t('rides.receipt.emailSentTo', { email: receipt.email.to })}` : receipt.email.status === 'FAILED' || receipt.email.status === 'SKIPPED' ? t('rides.receipt.emailFailed', { email: receipt.email.to }) : `✉️ ${t('rides.receipt.emailQueued', { email: receipt.email.to })}`}
              </div>
              {['SENT', 'FAILED', 'SKIPPED'].includes(receipt.email.status) && receipt.email.canResend && (
                <button type="button" onClick={sendMail} disabled={mailBusy} className="btn-ghost mt-2 w-full" data-testid="receipt-email-send">{mailBusy ? t('common.loading') : t('rides.receipt.emailResend')}</button>
              )}
            </div>
          )}
          {!receipt.email && receipt.canEmail && (
            <div className="mt-4 border-t border-edge pt-3">
              <button type="button" onClick={sendMail} disabled={mailBusy} className="btn-ghost w-full" data-testid="receipt-email-send">✉️ {mailBusy ? t('common.loading') : t('rides.receipt.emailSend')}</button>
            </div>
          )}
          {mailNote && <p className="mt-2 text-xs text-muted">{mailNote}</p>}

          {receipt.rating && (
            <div className="mt-4 border-t border-edge pt-3 text-sm">
              <span className="text-muted">{t('rides.receipt.yourRating')} </span>
              <span className="text-accent">{'★'.repeat(receipt.rating.stars)}<span className="text-muted/40">{'★'.repeat(5 - receipt.rating.stars)}</span></span>
            </div>
          )}
        </div>
      )}
      {receipt && <div className="mt-4"><GoogleReviewCard compact /></div>}
    </div>
    </div>
  );
}
