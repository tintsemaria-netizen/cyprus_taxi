'use client';

import { useCallback, useEffect, useState } from 'react';
import { PassengerTopBar } from '@/components/PassengerTopBar';
import { PassengerLoginModal } from '@/components/booking/PassengerLoginModal';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { useRefreshOnReturn } from '@/components/useRefreshOnReturn';

export const dynamic = 'force-dynamic';

// Share board («Табло попутчиков», operator 2026-11-21). My co-rider pre-bookings that have no pair
// yet, and other passengers' rides going the same way that fit with mine. «Поехать вместе» proposes
// riding together at THEIR time — they answer yes / no as with any co-rider proposal. The system
// keeps looking for a pair automatically meanwhile. Back arrow: in the top bar (PassengerTopBar).
interface Ride {
  id: string; mine: boolean; at: string; from: string; to: string; fromArea: string; toArea: string;
  adults: number; children: number; bags: number; early: number; wait: number; vClass?: string;
  arrive?: { from: string; by: string } | null;
  span?: { from: string; to: string } | null;
  myBookingId?: string; myFullCents?: number; mySharedCents?: number; myShiftMin?: number; myArriveAt?: string; myOutside?: boolean;
  waiting?: { until: string } | null;
}
interface Board { hideHours: number; mine: Ride[]; others: Ride[]; all?: Ride[]; driver?: boolean }

export default function Page() {
  const { t, fmt, tError } = useT();
  const [board, setBoard] = useState<Board | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Opened right after a co-rider pre-booking (operator 2026-11-23): say so at the top.
  const [booked, setBooked] = useState(false);
  useEffect(() => { setBooked(new URLSearchParams(window.location.search).has('booked')); }, []);

  const load = useCallback(async () => {
    try { setBoard(await api<Board>('/passenger/share-board')); setNeedLogin(false); }
    catch (e) { if (e instanceof ApiRequestError && e.status === 401) setNeedLogin(true); }
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 30_000); return () => clearInterval(iv); }, [load]);
  useRefreshOnReturn(load); // resumed app: fresh data at once (2026-11-22)

  // Large: an old booking's ARRIVAL window («на месте»); a departure-hour booking's pickup span «подача 13:00–13:15»
  // (2026-11-25); otherwise the pickup time, labelled.
  const bigTime = (r: Ride) => (
    <span className="shrink-0 text-end leading-tight" data-testid="board-time">
      <span className="block text-[11px] font-semibold uppercase text-accent">{r.arrive ? t('share.board.atPlace') : t('share.board.atPickup')}</span>
      <span className="block text-lg font-bold tabular-nums">{r.arrive ? `${fmt.time(r.arrive.from)}–${fmt.time(r.arrive.by)}` : r.span ? `${fmt.time(r.span.from)}–${fmt.time(r.span.to)}` : fmt.time(r.at)}</span>
      <span className="block text-xs text-muted">{fmt.date(r.arrive?.from ?? r.at)}</span>
    </span>
  );
  const zone = (k: string) => t(`share.zones.${k}` as 'share.zones.LCA');
  const people = (r: Ride) => [t('share.who.adults', { n: r.adults }), r.children ? t('share.who.children', { n: r.children }) : null, t('share.who.luggage', { n: r.bags })].filter(Boolean).join(' · ');
  const flex = (r: Ride) => (r.arrive || r.span ? '' : !r.early && !r.wait ? t('share.board.onTime') : t('share.board.flex', { e: r.early, w: r.wait }));

  // Operator 2026-11-23: the one who taps adapts to the other's time. If that is outside his own window,
  // ask first («Вы уверены…»); afterwards show when he will be there.
  const [ask, setAsk] = useState<{ r: Ride; at: string } | null>(null);
  const mineOf = (r: Ride) => board?.mine.find((m) => m.id === r.myBookingId);
  async function together(r: Ride, confirmOutside = false) {
    if (!r.myBookingId) return;
    if (!confirmOutside && r.myOutside && r.myArriveAt) { setAsk({ r, at: r.myArriveAt }); return; }
    setBusy(r.id); setMsg(null); setAsk(null);
    try {
      const res = await api<{ arriveAt?: string }>('/passenger/share-board', { method: 'POST', body: { myBookingId: r.myBookingId, otherBookingId: r.id, confirmOutside } });
      setMsg({ ok: true, text: res.arriveAt ? t('share.board.doneAt', { time: fmt.time(res.arriveAt) }) : t('share.board.sent') });
      await load();
    } catch (e) {
      const at = e instanceof ApiRequestError && e.body.code === 'OUTSIDE_WINDOW' ? (e.body as { arriveAt?: string }).arriveAt : undefined;
      if (at) setAsk({ r, at });
      else setMsg({ ok: false, text: e instanceof ApiRequestError ? tError(e) : t('share.board.failed') });
    } finally { setBusy(null); }
  }

  return (
    <div>
      <PassengerTopBar back="/prebookings" />
      <div className="mx-auto max-w-lg p-4 sm:p-6" data-testid="share-board">
        <h1 className="mb-1 text-xl font-bold">{t('share.board.title')}</h1>
        {booked && <p className="mb-3 rounded-[12px] border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent" data-testid="board-booked">✓ {t('share.board.booked')}</p>}
        <p className="mb-4 text-sm text-muted">{t('share.board.subtitle', { h: board?.hideHours ?? 10 })}</p>
        {needLogin ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-muted">{t('rides.signInPrompt')}</p>
            <button className="btn-primary mt-3" onClick={() => setShowLogin(true)}>{t('rides.signIn')}</button>
          </div>
        ) : !board ? (
          <p className="text-muted">{t('common.loading')}</p>
        ) : board.driver ? (
          <div className="card p-5 text-center text-sm text-muted" data-testid="board-driver">{t('share.board.driverOnly')}</div>
        ) : board.mine.length === 0 ? (
          <div className="card p-4 text-center">
            <p className="text-sm text-muted">{t('share.board.noMineOpen')}</p>
            <a href="/" className="btn-ghost mt-3 inline-flex">{t('share.board.book')}</a>
          </div>
        ) : (
          <>
            <p className="label mb-2">{t('share.board.yours')}</p>
            <div className="space-y-2">
              {board.mine.map((r) => (
                <div key={r.id} className="card border-2 border-accent p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold">{zone(r.from)} → {zone(r.to)}</span>
                    {bigTime(r)}
                  </div>
                  <div className="mt-1 text-xs text-muted">{r.fromArea} → {r.toArea}</div>
                  <div className="mt-1 text-xs text-muted">{[people(r), flex(r)].filter(Boolean).join(' · ')}</div>
                  <div className={`mt-2 text-xs ${r.waiting ? 'text-warn' : 'text-muted'}`}>
                    {r.waiting ? t('share.board.waiting', { time: fmt.time(r.waiting.until) }) : t('share.board.searching')}
                  </div>
                </div>
              ))}
            </div>

            <p className="label mb-2 mt-5">{t('share.board.others')}</p>
            {board.others.length === 0 ? (
              <p className="text-sm text-muted">{t('share.board.empty')}</p>
            ) : (
              <div className="space-y-2">
                {board.others.map((r) => {
                  const shift = r.myShiftMin ?? 0;
                  return (
                    <div key={r.id} className="card p-3" data-testid="board-ride">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold">{zone(r.from)} → {zone(r.to)}</span>
                        {bigTime(r)}
                      </div>
                      <div className="mt-1 text-xs text-muted">{r.fromArea} → {r.toArea}</div>
                      <div className="mt-1 text-xs text-muted">{[people(r), flex(r)].filter(Boolean).join(' · ')}</div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                        <span className={r.myOutside ? 'font-semibold text-warn' : 'text-muted'} data-testid="board-my-arrive">
                          {r.myArriveAt ? t('share.board.youArrive', { time: fmt.time(r.myArriveAt) }) : shift === 0 ? t('share.board.noShift') : shift > 0 ? t('share.board.later', { n: shift }) : t('share.board.earlier', { n: -shift })}
                        </span>
                        {r.myFullCents != null && r.mySharedCents != null && (
                          <span className="tabular-nums"><s className="text-muted">{fmt.money(r.myFullCents)}</s> <b className="text-accent">{fmt.money(r.mySharedCents)}</b></span>
                        )}
                      </div>
                      <button className="btn-primary mt-2 w-full" disabled={busy !== null || board.mine.some((m) => m.id === r.myBookingId && m.waiting)} onClick={() => together(r)}>
                        {busy === r.id ? t('common.loading') : t('share.board.together')}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
        {/* Open board (2026-11-22, operator): every open co-rider ride, also without a ride of my own.
            «Поехать с ним» opens the booking form with that ride's day and arrival window; after my ride is booked the
            other passenger gets the usual proposal. No names, phones or streets — only the town / postcode. */}
        {board && !board.driver && (board.all?.length ?? 0) > 0 && (
          <>
            <p className="label mb-2 mt-5">{t('share.board.all')}</p>
            <div className="space-y-2">
              {board.all!.map((r) => (
                <div key={r.id} className="card p-3" data-testid="board-all-ride">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold">{zone(r.from)} → {zone(r.to)}</span>
                    {bigTime(r)}
                  </div>
                  <div className="mt-1 text-xs text-muted">{r.fromArea} → {r.toArea}{r.vClass ? ` · ${r.vClass === 'XL' ? 'XL' : 'Comfort'}` : ''}</div>
                  <div className="mt-1 text-xs text-muted">{[people(r), flex(r)].filter(Boolean).join(' · ')}</div>
                  <a href={`/?join=${r.id}`} className="btn-primary mt-2 flex w-full items-center justify-center" data-testid="board-join">{t('share.board.join')}</a>
                </div>
              ))}
            </div>
          </>
        )}
        {board && !board.driver && board.mine.length === 0 && (board.all?.length ?? 0) === 0 && <p className="mt-4 text-sm text-muted">{t('share.board.empty')}</p>}
        {ask && (() => { const m = mineOf(ask.r); return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" role="dialog" aria-modal="true" data-testid="board-confirm">
            <div className="card w-full max-w-md p-4">
              <p className="text-base font-semibold">{m?.arrive ? t('share.board.outsideQ', { from: fmt.time(m.arrive.from), to: fmt.time(m.arrive.by), time: fmt.time(ask.at) }) : t('share.board.outsideQ2', { time: fmt.time(ask.at) })}</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button className="btn-ghost" onClick={() => setAsk(null)} data-testid="board-confirm-no">{t('share.board.outsideNo')}</button>
                <button className="btn-primary" onClick={() => together(ask.r, true)} data-testid="board-confirm-yes">{t('share.board.outsideYes')}</button>
              </div>
            </div>
          </div>
        ); })()}
        {msg && <p role="status" className={`mt-4 rounded-[12px] border px-3 py-2 text-sm ${msg.ok ? 'border-accent/40 text-accent' : 'border-danger/40 text-danger'}`}>{msg.text}</p>}
        {showLogin && <PassengerLoginModal onClose={() => setShowLogin(false)} onDone={() => { setShowLogin(false); load(); }} />}
      </div>
    </div>
  );
}
