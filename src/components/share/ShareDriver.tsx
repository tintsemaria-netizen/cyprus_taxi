'use client';

import { PairLegs } from '@/components/share/PairLegs';
import type { PairStops } from '@/lib/pair-stops';
import { useEffect, useState } from 'react';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

// Ride-share «Попутчик» for the driver (Task 022).

export interface DriverShareProposal {
  groupId: string; expiresAt: string; extraMin: number; earningsWasCents: number; earningsNowCents: number;
  passengers: number; children: number; luggage: number; pickupLabel: string; dropoffLabel: string;
  endAt: string | null; approx: boolean; stops: { kind: string; who: string; label: string; name: string | null }[];
}
export interface CoRiderLeg {
  bookingId: string; reference: string; status: string; revision: number;
  pickup: { lat: number; lng: number; label: string }; dropoff: { lat: number; lng: number; label: string };
  passengerName: string; passengerPhone: string; passengerCount: number; childCount: number; luggageCount: number;
  fareCents: number | null; startCodeRequired: boolean; flightNumber: string | null; note: string | null; isHost: boolean;
  waiting: { arrivedAt: string; graceSeconds: number } | null;
}
export interface ShareInfo { groupId: string; discountPct: number; totalCents: number; primaryIsHost: boolean }

function useCountdown(until: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);
  return Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000));
}

/** «Попутчик по пути»: +N мин, «было X → станет Y», who and where. The driver decides on the spot. */
export function DriverShareProposalSheet({ p, onAnswered }: { p: DriverShareProposal; onAnswered: () => void }) {
  const { t, fmt, tError } = useT();
  const left = useCountdown(p.expiresAt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (left === 0) return null;
  async function answer(accept: boolean) {
    setBusy(true); setErr(null);
    try { await api('/driver/share/answer', { method: 'POST', body: { groupId: p.groupId, accept } }); }
    catch (e) { setErr(e instanceof ApiRequestError ? tError(e) : t('common.retry')); }
    finally { setBusy(false); onAnswered(); }
  }
  const adults = p.passengers - p.children;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 sm:items-center" role="alertdialog" aria-modal="true" aria-labelledby="dsp-title" data-testid="driver-share-proposal">
      <div className="ily-offer-in w-full max-w-md rounded-t-[20px] border-2 border-accent bg-elevated p-5 sm:rounded-[20px]" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        <div className="flex items-center justify-between">
          <h2 id="dsp-title" className="font-semibold text-accent">👥 {t('share.driver.title')}</h2>
          <span className={`chip tabular-nums ${left <= 10 ? '!text-danger' : ''}`}>⏳ {t('share.driver.secondsLeft', { s: left })}</span>
        </div>
        <div className="mt-3 rounded-[14px] border border-edge bg-page p-4 text-center">
          <div className="text-sm text-muted">{p.extraMin > 0 ? t('share.driver.longer', { n: p.extraMin }) : t('share.driver.sameTime')}</div>
          <div className="mt-1 text-[26px] font-bold tabular-nums leading-tight">
            <span className="text-muted line-through decoration-2">{fmt.money(p.earningsWasCents)}</span>
            <span className="mx-2 text-muted">→</span>
            <span className="text-accent">{fmt.money(p.earningsNowCents)}</span>
          </div>
        </div>
        {p.endAt && (
          <p className="mt-2 text-center text-sm font-medium">
            {t('share.driver.endAt', { time: fmt.time(p.endAt) })}{p.approx && <span className="text-xs font-normal text-muted"> · {t('share.proposal.approx')}</span>}
          </p>
        )}
        <div className="mt-3 space-y-1.5 text-sm">
          {/* The order the trip will run in — who is dropped off first matters for both passengers. */}
          <div className="text-xs uppercase tracking-wide text-muted">{t('share.driver.order')}</div>
          <ol className="space-y-1">
            {p.stops.map((st, i) => (
              <li key={i} className="flex gap-2">
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${st.who === 'guest' ? 'bg-accent text-black' : 'bg-edge-strong text-ink'}`}>{i + 1}</span>
                <span className="min-w-0">
                  <span className="text-muted">{t(st.kind === 'pickup' ? 'share.driver.pickupOf' : 'share.driver.dropoffOf', { who: st.who === 'host' ? (st.name ?? t('share.driver.whoHost')) : t('share.driver.whoGuest') })}</span>
                  {' · '}<span className="font-medium">{st.label}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="text-muted">
            {t('share.who.adults', { n: adults })}{p.children ? ` · ${t('share.who.children', { n: p.children })}` : ''} · {t('share.who.luggage', { n: p.luggage })}
          </div>
        </div>
        {err && <p className="mt-2 text-sm text-danger">{err}</p>}
        <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2">
          <button className="btn-ghost" disabled={busy} onClick={() => answer(false)}>{t('share.driver.skip')}</button>
          <button className="btn-primary" disabled={busy} onClick={() => answer(true)}>{t('share.driver.take')}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The other passenger's leg while the driver navigates the main one: a small pill on the map that
 * opens a sheet with that passenger's stops and the next action (go / arrived / picked up /
 * dropped off / didn't come).
 */
/** The navigation's «👥» action button opens the co-rider's sheet (2026-11-22). */
export const OPEN_CO_RIDER = 'il-y:open-co-rider';

export function CoRiderLegPill({ leg, share, pair, onChanged, onError }: { leg: CoRiderLeg; share: ShareInfo | null; pair?: PairStops | null; onChanged: () => void; onError: (msg: string) => void }) {
  const { t, fmt, tError } = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [confirmNoShow, setConfirmNoShow] = useState(false);
  useEffect(() => { const on = () => setOpen(true); window.addEventListener(OPEN_CO_RIDER, on); return () => window.removeEventListener(OPEN_CO_RIDER, on); }, []);
  const statusText = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(leg.status) ? t(`share.driver.state.${leg.status as 'ASSIGNED'}`) : leg.status;
  async function act(path: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const r = await api<{ noShowFeeCents?: number | null }>(`/driver/bookings/${leg.bookingId}/${path}`, { method: 'POST', body: { expectedRevision: leg.revision, ...body } });
      if (path === 'no-show' && r?.noShowFeeCents) onError(t('share.driver.noShowFee', { amount: fmt.money(r.noShowFeeCents) }));
      setOpen(false); setConfirmNoShow(false); setCode('');
    } catch (e) { onError(e instanceof ApiRequestError ? tError(e) : t('common.retry')); }
    finally { setBusy(false); onChanged(); }
  }
  const target = leg.status === 'IN_PROGRESS' ? leg.dropoff : leg.pickup;
  const navHref = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;
  const title = leg.isHost ? t('share.driver.legHost') : t('share.driver.leg');
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="co-rider-pill"
        className="fixed start-3 z-[55] flex max-w-[70%] items-center gap-2 rounded-full border border-accent/60 bg-page/95 px-3 py-2 text-sm shadow-lg"
        style={{ top: 'calc(env(safe-area-inset-top) + 92px)' }}>
        <span aria-hidden>👥</span>
        <span className="truncate font-semibold">{title}</span>
        <span className="shrink-0 text-xs text-accent">{statusText}</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="leg-title"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="w-full max-w-md rounded-t-[20px] border border-edge bg-elevated p-5 sm:rounded-[20px]" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
            <div className="flex items-center justify-between gap-2">
              <h2 id="leg-title" className="text-lg font-bold">👥 {title}</h2>
              <span className="chip">{statusText}</span>
            </div>
            <div className="mt-3 space-y-1.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{leg.passengerName}</span>
                {leg.passengerPhone && <a className="btn-ghost !px-3 !py-1.5 text-sm" href={`tel:${leg.passengerPhone}`}>📞 {t('share.driver.call')}</a>}
              </div>
              <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{t('share.driver.pickup')}</span><span className="font-medium">{leg.pickup.label}</span></div>
              <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{t('share.driver.dropoff')}</span><span className="font-medium">{leg.dropoff.label}</span></div>
              <div className="text-muted">
                {t('share.who.adults', { n: leg.passengerCount - leg.childCount })}{leg.childCount ? ` · ${t('share.who.children', { n: leg.childCount })}` : ''} · {t('share.who.luggage', { n: leg.luggageCount })}
                {leg.fareCents != null && <> · <span className="font-semibold text-ink">{fmt.money(leg.fareCents)}</span></>}
              </div>
              {leg.flightNumber && <div className="font-mono text-xs text-muted">✈ {leg.flightNumber}</div>}
              {leg.note && <div className="text-xs text-warn">{leg.note}</div>}
              {share && <div className="pt-1 text-xs text-muted">{t('share.driver.total', { amount: fmt.money(share.totalCents) })}</div>}
              {pair && <PairLegs pair={pair} />}
            </div>
            {leg.status === 'ARRIVED' && leg.startCodeRequired && (
              <input className="field mt-3 text-center font-mono text-lg tracking-[0.3em]" inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••" />
            )}
            {confirmNoShow && <p className="mt-3 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{t('share.driver.noShowConfirm')}</p>}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <a className="btn-ghost text-center" href={navHref} target="_blank" rel="noopener noreferrer">{t('share.driver.navigate')}</a>
              {leg.status === 'ASSIGNED' && <button className="btn-primary" disabled={busy} onClick={() => act('status', { to: 'EN_ROUTE' })}>{t('share.driver.goTo')}</button>}
              {leg.status === 'EN_ROUTE' && <button className="btn-primary" disabled={busy} onClick={() => act('arrive')}>{t('share.driver.arrive')}</button>}
              {leg.status === 'ARRIVED' && !confirmNoShow && <button className="btn-primary" disabled={busy || (leg.startCodeRequired && code.length !== 4)} onClick={() => act('start', { code })}>{t('share.driver.start')}</button>}
              {leg.status === 'ARRIVED' && confirmNoShow && <button className="rounded-full bg-[#7A1E1E] font-bold text-white" disabled={busy} onClick={() => act('no-show')}>{t('share.driver.noShow')}</button>}
              {leg.status === 'IN_PROGRESS' && <button className="btn-primary" disabled={busy} onClick={() => act('complete')}>{t('share.driver.complete')}</button>}
            </div>
            {leg.status === 'ARRIVED' && !confirmNoShow && (
              <button className="mt-2 w-full text-sm text-muted underline" onClick={() => setConfirmNoShow(true)}>{t('share.driver.noShow')}</button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Switch «Беру попутчиков»: a short line + a small ⓘ that opens what the driver needs to know (2026-11-26). */
export function AcceptsSharedToggle() {
  const { t } = useT();
  const [on, setOn] = useState<boolean | null>(null);
  const [pct, setPct] = useState(30);
  const [info, setInfo] = useState(false);
  useEffect(() => { api<{ acceptsShared: boolean; discountPct: number }>('/driver/share/settings').then((r) => { setOn(r.acceptsShared); setPct(r.discountPct); }).catch(() => {}); }, []);
  async function toggle(v: boolean) {
    setOn(v);
    try { const r = await api<{ acceptsShared: boolean }>('/driver/share/settings', { method: 'PATCH', body: { acceptsShared: v } }); setOn(r.acceptsShared); }
    catch { setOn(!v); }
  }
  return (
    <div data-testid="accepts-shared">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm">
            {t('share.driver.setting')}
            <button type="button" onClick={() => setInfo((v) => !v)} aria-expanded={info} aria-label="info" data-testid="share-info"
              className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold leading-none ${info ? 'border-accent text-accent' : 'border-edge-strong text-muted'}`}>i</button>
          </span>
          <span className="block text-xs text-muted">{t('share.driver.settingHint')}</span>
        </span>
        <label className="cursor-pointer">
          <input type="checkbox" role="switch" className="sr-only" aria-label={t('share.driver.setting')} checked={!!on} disabled={on === null} onChange={(e) => toggle(e.target.checked)} />
          <span aria-hidden className={`relative block h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-accent' : 'bg-edge-strong'}`}>
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'start-[22px]' : 'start-0.5'}`} />
          </span>
        </label>
      </div>
      {info && <p className="mt-2 whitespace-pre-line rounded-[10px] border border-edge bg-page px-3 py-2 text-xs leading-relaxed text-muted" data-testid="share-info-text">{t('share.driver.settingInfo', { pct })}</p>}
    </div>
  );
}
