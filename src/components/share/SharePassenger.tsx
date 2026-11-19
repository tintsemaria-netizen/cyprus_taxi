'use client';

import { useEffect, useState } from 'react';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

// Ride-share «Попутчик» for the passenger (Task 022).
export interface CoRiderCounts { adults: number; children: number; luggage: number }
interface ShareTiming { arriveAt: string | null; pickupAt: string | null; waitMin: number; approx: boolean }
export interface ShareProposalView extends ShareTiming { groupId: string; mode: string; expiresAt: string; extraMin: number; fullFareCents: number; newFareCents: number; coRider: CoRiderCounts }
export interface SharedView extends ShareTiming { status: string; discountPct: number; fullFareCents: number; fareCents: number; extraMin?: number; coRider: CoRiderCounts }

/** When the car comes (pre-booking, with the wait the passenger agreed to) and when they arrive. */
const sameCyprusDay = (a: Date, b: Date) => a.toLocaleDateString('en-CA', { timeZone: 'Europe/Nicosia' }) === b.toLocaleDateString('en-CA', { timeZone: 'Europe/Nicosia' });

function TimingLines({ s, isPrebook }: { s: ShareTiming; isPrebook: boolean }) {
  const { t, fmt } = useT();
  // A pre-booking is usually another day: show the date too, not just «14:56».
  const when = (iso: string) => (sameCyprusDay(new Date(iso), new Date()) ? fmt.time(iso) : fmt.dateTime(iso));
  return (
    <>
      {isPrebook && s.pickupAt && (
        <p className="mt-1 text-sm font-medium">
          {s.waitMin > 0 ? t('share.proposal.departAt', { time: when(s.pickupAt), n: s.waitMin }) : t('share.proposal.pickupAt', { time: when(s.pickupAt) })}
        </p>
      )}
      {s.arriveAt && (
        <p className="mt-1 text-sm font-medium">
          {t('share.proposal.arriveAt', { time: when(s.arriveAt) })}{s.approx && <span className="text-xs font-normal text-muted"> · {t('share.proposal.approx')}</span>}
        </p>
      )}
    </>
  );
}

export function useWho() {
  const { t } = useT();
  return (c: CoRiderCounts) => [
    t('share.who.adults', { n: c.adults }),
    ...(c.children ? [t('share.who.children', { n: c.children })] : []),
    t('share.who.luggage', { n: c.luggage }),
  ].join(' · ');
}

/**
 * The light notification a passenger gets: «Появился попутчик: … Поездка станет дольше на N мин и
 * дешевле на X». A live proposal counts down (silence = no); a pre-booking one shows its deadline.
 */
export function ShareProposalCard({ p, onAnswered, route }: { p: ShareProposalView; onAnswered: () => void; route?: { from: string; to: string } }) {
  const { t, fmt, tError } = useT();
  const [collapsed, setCollapsed] = useState(false);
  const who = useWho();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);
  const left = Math.max(0, Math.ceil((new Date(p.expiresAt).getTime() - now) / 1000));
  if (left === 0) return null;
  async function answer(accept: boolean) {
    setBusy(true); setErr(null);
    try {
      await api('/tracking/share-answer', { method: 'POST', body: { groupId: p.groupId, accept } });
      onAnswered();
    } catch (e) {
      setErr(e instanceof ApiRequestError ? tError(e) : t('common.retry'));
      onAnswered();
    } finally { setBusy(false); }
  }
  const live = p.mode === 'LIVE';
  if (collapsed) {
    // Folded to a pill so the ride's page underneath can be read; one tap brings the offer back.
    return (
      <button type="button" onClick={() => setCollapsed(false)} data-testid="share-proposal-pill"
        className="fixed inset-x-0 top-0 z-50 mx-auto flex w-fit items-center gap-2 rounded-full border border-accent/60 bg-page/95 px-4 py-2 text-sm font-semibold shadow-xl"
        style={{ marginTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <span aria-hidden>👥</span>{live ? t('share.proposal.title') : t('share.proposal.titlePrebook')}
        <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-black">{t('share.proposal.answer')}</span>
      </button>
    );
  }
  return (
    <div className="pointer-events-auto fixed inset-x-0 top-0 z-50 flex justify-center px-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }} role="alertdialog" aria-labelledby="share-prop-title" data-testid="share-proposal">
      <div className="w-full max-w-md rounded-[18px] border border-accent/50 bg-page/95 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/20 text-lg">👥</span>
          <div className="min-w-0 flex-1">
            <h2 id="share-prop-title" className="font-semibold leading-snug">{live ? t('share.proposal.title') : t('share.proposal.titlePrebook')}</h2>
            <p className="mt-0.5 text-sm text-muted">{who(p.coRider)}</p>
          </div>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span className="rounded-full bg-elevated px-2 py-1 text-xs font-semibold tabular-nums text-muted">
              {live ? t('share.proposal.secondsLeft', { s: left }) : t('share.proposal.until', { time: fmt.time(p.expiresAt) })}
            </span>
            <button type="button" className="text-xs text-muted underline" onClick={() => setCollapsed(true)}>{t('share.proposal.hide')}</button>
          </span>
        </div>
        <p className="mt-3 text-sm">
          {p.extraMin > 0 ? (
            <>
              {t('share.proposal.longer', { n: p.extraMin })}{' '}
              {t('share.proposal.cheaper', { save: fmt.money(p.fullFareCents - p.newFareCents), to: fmt.money(p.newFareCents), from: fmt.money(p.fullFareCents) })}
            </>
          ) : (
            <>
              {t('share.proposal.sameTime')}.{' '}
              {t('share.proposal.cheaperOnly', { save: fmt.money(p.fullFareCents - p.newFareCents), to: fmt.money(p.newFareCents), from: fmt.money(p.fullFareCents) })}
            </>
          )}
        </p>
        {route && (
          <p className="mt-2 text-xs text-muted"><span className="font-semibold text-ink">{t('share.proposal.yourRide')}:</span> {route.from} → {route.to}</p>
        )}
        <TimingLines s={p} isPrebook={!live} />
        <p className="mt-1 text-xs text-muted">{t('share.proposal.privacy')}</p>
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="btn-ghost" disabled={busy} onClick={() => answer(false)}>{t('share.proposal.no')}</button>
          <button className="btn-primary" disabled={busy} onClick={() => answer(true)}>{t('share.proposal.yes')}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * In the ride sheet once the co-rider is confirmed (2026-11-19: compact). Folded: the label, when
 * (departure / pickup, or arrival), the price and where this passenger goes. A tap unfolds the
 * rest: the full price it replaces, the extra minutes, the wait, arrival and who rides along.
 */
export function SharedBadge({ s, to }: { s: SharedView; to?: string }) {
  const { t, fmt } = useT();
  const who = useWho();
  const [open, setOpen] = useState(false);
  const isPrebook = s.status === 'MATCHED';
  const whenIso = (isPrebook ? s.pickupAt : null) ?? s.arriveAt;
  const when = whenIso ? (sameCyprusDay(new Date(whenIso), new Date()) ? fmt.time(whenIso) : fmt.dateTime(whenIso)) : null;
  return (
    <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
      className="mt-3 block w-full rounded-[12px] border border-accent/40 bg-accent/5 p-3 text-start" data-testid="shared-badge">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-accent">👥 {t('share.shared.badge', { pct: s.discountPct })}</span>
        <span aria-hidden className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium tabular-nums">{when}</span>
        <span className="text-base font-bold tabular-nums">{fmt.money(s.fareCents)}</span>
      </div>
      {to && <p className="mt-0.5 truncate text-sm text-muted">→ {to}</p>}
      {open && (
        <div className="mt-2 border-t border-accent/20 pt-2">
          <div className="text-sm tabular-nums">{t('share.shared.price', { to: fmt.money(s.fareCents), from: fmt.money(s.fullFareCents) })}</div>
          {s.extraMin != null && (
            <p className="mt-1 text-sm">{s.extraMin > 0 ? t('share.proposal.longer', { n: s.extraMin }) : t('share.proposal.sameTime')}</p>
          )}
          <TimingLines s={s} isPrebook={isPrebook} />
          <p className="mt-1 text-xs text-muted">{t('share.shared.with', { who: who(s.coRider) })}</p>
          {isPrebook && <p className="mt-1 text-xs text-muted">{t('share.shared.matched')}</p>}
        </div>
      )}
    </button>
  );
}

