'use client';

import { PassengerTopBar } from '@/components/PassengerTopBar';
import { BackArrow } from '@/components/BackArrow';
import { use, useEffect, useState } from 'react';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT, useLocale, I18nProvider } from '@/i18n/I18nProvider';
import { LOCALES, LOCALE_NAMES, LOCALE_SHORT, type Locale } from '@/i18n/config';
import { GoogleReviewCard } from '@/components/GoogleReviewCard';
import { useRefreshOnReturn } from '@/components/useRefreshOnReturn';

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
  const [reloadN, setReloadN] = useState(0);
  const { t } = useT();
  const appLocale = useLocale();
  // Receipt language: Russian for a Russian app, otherwise English; the passenger can pick another.
  const [lang, setLangState] = useState<Locale>(appLocale === 'ru' ? 'ru' : 'en');
  useEffect(() => { try { const v = localStorage.getItem('il-y-receipt-lang'); if (v && (LOCALES as readonly string[]).includes(v)) setLangState(v as Locale); } catch { /* storage off */ } }, []);
  const setLang = (l: Locale) => { setLangState(l); try { localStorage.setItem('il-y-receipt-lang', l); } catch { /* ignore */ } };
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
  }, [id, t, reloadN]);
  useRefreshOnReturn(() => setReloadN((n) => n + 1)); // e.g. the driver's final amount arrived meanwhile

  return (
    <div>
    <PassengerTopBar back={false} />
    <div className="mx-auto max-w-lg p-4 sm:p-6">

      {(error || !receipt) && <BackArrow className="-ms-2 mb-2" fallback={`/rides/${id}`} />}
      {error ? (
        <div className="card p-6 text-center text-sm text-muted">
          {error}
          {needLogin && <a href={`/login?next=${encodeURIComponent(`/rides/${id}/receipt`)}`} className="btn-primary mt-4 w-full" data-testid="receipt-login">{t('auth.signIn')}</a>}
        </div>
      ) : !receipt ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : (
        <I18nProvider locale={lang}>
          <ReceiptCard back={`/rides/${id}`} receipt={receipt} lang={lang} onLang={setLang} sendMail={sendMail} mailBusy={mailBusy} mailNote={mailNote} />
        </I18nProvider>
      )}
      {receipt && <div className="mt-4"><GoogleReviewCard compact /></div>}
    </div>
    </div>
  );
}

const RECEIPT_ORDER: Locale[] = ['en', 'ru', ...LOCALES.filter((l) => l !== 'en' && l !== 'ru')];

function ReceiptCard({ back, receipt, lang, onLang, sendMail, mailBusy, mailNote }: { back: string; receipt: Receipt; lang: Locale; onLang: (l: Locale) => void; sendMail: () => void; mailBusy: boolean; mailNote: string | null }) {
  const { t, fmt } = useT();
  const eur = (cents: number, ccy: string) => fmt.money(cents, ccy);
  const f = receipt.fare;
  return (
        <div className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1"><BackArrow className="-ms-3" fallback={back} /><h1 className="text-lg font-bold">{t('rides.receipt.title')}</h1></div>
            {/* Receipts are in English or Russian; any other language on request (2026-11-17). */}
            <select value={lang} onChange={(e) => onLang(e.target.value as Locale)} aria-label={t('common.language')} data-testid="receipt-lang"
              className="min-h-[30px] rounded-[8px] border border-edge bg-elevated px-1.5 text-xs text-ink">
              {RECEIPT_ORDER.map((l) => <option key={l} value={l}>{LOCALE_SHORT[l]} · {LOCALE_NAMES[l]}</option>)}
            </select>
          </div>
          <p className="mt-0.5 text-xs text-muted">#{receipt.reference}</p>
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
              {/* Receipt (2026-11-18): just the total (waiting included) — no class / passengers / driver / fare lines / meter note. */}
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{t('rides.receipt.total')}</span>
                <span className="text-lg font-bold tabular-nums">
                  {f.totalCents != null ? eur(f.totalCents, f.currency) : '—'}
                </span>
              </div>
              {/* Payment method only (2026-11-18): no «Ожидает оплаты» — nothing marks cash as collected yet. */}
              <div className="mt-3 text-xs text-muted">{f.paymentMethod === 'CASH_TO_DRIVER' ? t('common.payment.CASH_TO_DRIVER') : f.paymentMethod}</div>
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
  );
}
