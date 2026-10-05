'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatFlight } from '@/lib/flight';
import { useT } from '@/i18n/I18nProvider';
import { ConfirmSheet } from '@/components/ConfirmSheet';

// Driver pre-booking board (scheduled rides). Server: src/server/dispatch/preassign.ts.
interface Item {
  bookingId: string; reference: string; pickupAt: string; pickupLabel: string; dropoffLabel: string;
  vClass: string; passengerCount: number; fareCents: number | null; priceType: string | null;
  flightNumber: string | null; airport: boolean; conflict?: boolean; canReleaseFreely?: boolean;
}
interface Board { available: Item[]; mine: Item[]; blocked: string | null }

// Mirrors config.dispatch.preassign defaults (display only; the server enforces the real values).
const PROTECT_MIN = 75;
const CONVERT_MIN = 30;

export function ScheduledRides({ onCount }: { onCount?: (n: number) => void }) {
  const { t, tp, fmt, tError } = useT();
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<Item | null>(null);

  const load = useCallback(async () => {
    try { const b = await api<Board>('/driver/scheduled'); setBoard(b); setErr(null); onCount?.(b.available.filter((i) => !i.conflict).length); }
    catch (e) { setErr(e ? tError(e) : t('driver.scheduled.loadFailed')); }
  }, [t, tError, onCount]);
  useEffect(() => { load(); const iv = setInterval(load, 60_000); return () => clearInterval(iv); }, [load]);

  async function take(i: Item) {
    setBusy(i.bookingId); setMsg(null); setErr(null);
    try { await api(`/driver/scheduled/${i.bookingId}/claim`, { method: 'POST' }); setMsg(t('driver.scheduled.taken')); await load(); }
    catch (e) { setErr(tError(e)); await load(); }
    finally { setBusy(null); }
  }
  async function release(i: Item) {
    setBusy(i.bookingId); setErr(null);
    try { await api(`/driver/scheduled/${i.bookingId}/release`, { method: 'POST' }); setAsk(null); await load(); }
    catch (e) { setErr(tError(e)); setAsk(null); }
    finally { setBusy(null); }
  }

  const row = (i: Item, action: React.ReactNode) => (
    <div key={i.bookingId} className="rounded-[12px] border border-edge bg-elevated p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{fmt.dateTime(i.pickupAt)}</span>
        <span className="flex shrink-0 gap-1">
          {i.airport && <span className="chip !text-accent">✈ {t('driver.scheduled.airport')}</span>}
          <span className="chip">{t(`common.vClass.${i.vClass}` as 'common.vClass.COMFORT')}</span>
        </span>
      </div>
      <div className="mt-2 space-y-1 text-sm">
        <div className="flex gap-2"><span className="text-accent">●</span><span className="min-w-0">{i.pickupLabel}</span></div>
        <div className="flex gap-2"><span className="text-muted">○</span><span className="min-w-0">{i.dropoffLabel}</span></div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>{tp('common.passengers', i.passengerCount)}</span>
        {i.flightNumber && <span className="font-mono text-ink">{t('driver.scheduled.flight', { flight: formatFlight(i.flightNumber) })}</span>}
        {i.fareCents != null && <span>{t('driver.scheduled.fareEstimate', { amount: fmt.money(i.fareCents) })}</span>}
      </div>
      <div className="mt-3">{action}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t('driver.scheduled.explain', { protect: PROTECT_MIN, convert: CONVERT_MIN })}</p>
      {msg && <p role="status" className="rounded-[12px] border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">{msg}</p>}
      {err && <p role="alert" className="rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
      {!board ? <p className="text-sm text-muted">{t('common.loading')}</p> : (
        <>
          <h2 className="pt-1 text-sm font-semibold">{t('driver.scheduled.mine')}</h2>
          {board.mine.length === 0 ? <p className="text-sm text-muted">{t('driver.scheduled.noneMine')}</p> : board.mine.map((i) => row(i,
            <button className="btn-ghost !min-h-[44px] w-full !text-danger border border-danger/40" disabled={busy === i.bookingId} onClick={() => setAsk(i)}>{t('driver.scheduled.release')}</button>))}

          <h2 className="pt-2 text-sm font-semibold">{t('driver.scheduled.available')}</h2>
          {board.blocked ? (
            <p className="rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{board.blocked === 'NO_VEHICLE' ? t('driver.scheduled.blockedNoVehicle') : t('driver.scheduled.blockedNotEligible')}</p>
          ) : board.available.length === 0 ? <p className="text-sm text-muted">{t('driver.scheduled.noneAvailable')}</p> : board.available.map((i) => row(i,
            i.conflict
              ? <p className="text-xs text-warn">{t('driver.scheduled.conflict')}</p>
              : <button className="btn-primary !min-h-[44px] w-full" disabled={busy === i.bookingId} onClick={() => take(i)}>{busy === i.bookingId ? t('driver.scheduled.taking') : t('driver.scheduled.take')}</button>))}
        </>
      )}
      {ask && (
        <ConfirmSheet title={t('driver.scheduled.releaseTitle')} body={ask.canReleaseFreely === false ? t('driver.scheduled.releaseLateBody') : t('driver.scheduled.releaseBody')}
          confirmLabel={t('driver.scheduled.release')} cancelLabel={t('driver.scheduled.keep')} danger busy={busy === ask.bookingId}
          onConfirm={() => release(ask)} onCancel={() => setAsk(null)} />
      )}
    </div>
  );
}
