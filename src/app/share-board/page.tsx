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
  myBookingId?: string; myFullCents?: number; mySharedCents?: number; myShiftMin?: number;
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

  const load = useCallback(async () => {
    try { setBoard(await api<Board>('/passenger/share-board')); setNeedLogin(false); }
    catch (e) { if (e instanceof ApiRequestError && e.status === 401) setNeedLogin(true); }
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 30_000); return () => clearInterval(iv); }, [load]);
  useRefreshOnReturn(load); // resumed app: fresh data at once (2026-11-22)

  const zone = (k: string) => t(`share.zones.${k}` as 'share.zones.LCA');
  const people = (r: Ride) => [t('share.who.adults', { n: r.adults }), r.children ? t('share.who.children', { n: r.children }) : null, t('share.who.luggage', { n: r.bags })].filter(Boolean).join(' · ');
  const flex = (r: Ride) => (r.arrive ? `🏁 ${t('rides.prebookings.arrive', { from: fmt.time(r.arrive.from), to: fmt.time(r.arrive.by) })}` : !r.early && !r.wait ? t('share.board.onTime') : t('share.board.flex', { e: r.early, w: r.wait }));

  async function together(r: Ride) {
    if (!r.myBookingId) return;
    setBusy(r.id); setMsg(null);
    try {
      await api('/passenger/share-board', { method: 'POST', body: { myBookingId: r.myBookingId, otherBookingId: r.id } });
      setMsg({ ok: true, text: t('share.board.sent') });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiRequestError ? tError(e) : t('share.board.failed') });
    } finally { setBusy(null); }
  }

  return (
    <div>
      <PassengerTopBar back="/" />
      <div className="mx-auto max-w-lg p-4 sm:p-6" data-testid="share-board">
        <h1 className="mb-1 text-xl font-bold">{t('share.board.title')}</h1>
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
                    <span className="shrink-0 text-end leading-tight"><span className="block text-lg font-bold tabular-nums">{fmt.time(r.at)}</span><span className="block text-xs text-muted">{fmt.date(r.at)}</span></span>
                  </div>
                  <div className="mt-1 text-xs text-muted">{r.fromArea} → {r.toArea}</div>
                  <div className="mt-1 text-xs text-muted">{people(r)} · {flex(r)}</div>
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
                        <span className="shrink-0 text-end leading-tight"><span className="block text-lg font-bold tabular-nums">{fmt.time(r.at)}</span><span className="block text-xs text-muted">{fmt.date(r.at)}</span></span>
                      </div>
                      <div className="mt-1 text-xs text-muted">{r.fromArea} → {r.toArea}</div>
                      <div className="mt-1 text-xs text-muted">{people(r)} · {flex(r)}</div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                        <span className="text-muted">
                          {shift === 0 ? t('share.board.noShift') : shift > 0 ? t('share.board.later', { n: shift }) : t('share.board.earlier', { n: -shift })}
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
                    <span className="shrink-0 text-end leading-tight"><span className="block text-lg font-bold tabular-nums">{fmt.time(r.at)}</span><span className="block text-xs text-muted">{fmt.date(r.at)}</span></span>
                  </div>
                  <div className="mt-1 text-xs text-muted">{r.fromArea} → {r.toArea}{r.vClass ? ` · ${r.vClass === 'XL' ? 'XL' : 'Comfort'}` : ''}</div>
                  <div className="mt-1 text-xs text-muted">{people(r)} · {flex(r)}</div>
                  <a href={`/?join=${r.id}`} className="btn-primary mt-2 flex w-full items-center justify-center" data-testid="board-join">{t('share.board.join')}</a>
                </div>
              ))}
            </div>
          </>
        )}
        {board && !board.driver && board.mine.length === 0 && (board.all?.length ?? 0) === 0 && <p className="mt-4 text-sm text-muted">{t('share.board.empty')}</p>}
        {msg && <p role="status" className={`mt-4 rounded-[12px] border px-3 py-2 text-sm ${msg.ok ? 'border-accent/40 text-accent' : 'border-danger/40 text-danger'}`}>{msg.text}</p>}
        {showLogin && <PassengerLoginModal onClose={() => setShowLogin(false)} onDone={() => { setShowLogin(false); load(); }} />}
      </div>
    </div>
  );
}
