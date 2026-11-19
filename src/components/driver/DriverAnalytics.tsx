'use client';

import { useCallback, useEffect, useState } from 'react';
import { useT, useLocale } from '@/i18n/I18nProvider';
import { INTL_TAG } from '@/i18n/config';
import { api } from '@/lib/api-client';
import { BackArrow } from '@/components/BackArrow';

// Driver analytics (2026-11-19, operator): opened from the «Выполнено заказов» tile. One Cyprus day
// (any day, ‹ › to step) or a Monday–Sunday week. Two tiles side by side — «Выполнено» (done +
// earned) and «Не выполнено» (rides the driver cancelled + offers declined / missed, with what they
// were worth) — and under them two small lists of those rides.

interface Bucket { count: number; cents: number }
interface Day { day: string; completed: Bucket; pendingFinal: number; driverCanceled: Bucket; passengerCanceled: Bucket; missedOffers: Bucket }
interface Item { at: string; from: string; to: string; cents: number | null; kind: 'done' | 'canceled' | 'missed' }
interface Data extends Day { from: string; to: string; days: Day[]; doneItems: Item[]; notDoneItems: Item[] }

function shift(day: string, n: number) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function cyprusToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Nicosia' }).format(new Date()); }

export function DriverAnalytics({ onBack }: { onBack: () => void }) {
  const { t, tError, fmt } = useT();
  const locale = useLocale();
  const [period, setPeriod] = useState<'day' | 'week'>('day');
  const [day, setDay] = useState(cyprusToday);
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try { setData(await api<Data>(`/driver/analytics?period=${period}&day=${day}`)); } catch (e) { setErr(tError(e)); }
  }, [period, day, tError]);
  useEffect(() => { load(); }, [load]);

  const tag = INTL_TAG[locale];
  const dayName = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString(tag, { ...opts, timeZone: 'UTC' });
  const title = !data ? '…' : period === 'day'
    ? dayName(data.from, { weekday: 'short', day: 'numeric', month: 'long' })
    : `${dayName(data.from, { day: 'numeric', month: 'short' })} – ${dayName(data.to, { day: 'numeric', month: 'short' })}`;
  const today = cyprusToday();
  const canNext = period === 'day' ? day < today : (data ? data.to < today : false);
  const money = (c: number) => fmt.money(c);

  return (
    <div className="space-y-3" data-testid="driver-analytics">
      <div className="flex items-center gap-1">
        <BackArrow onBack={onBack} className="-ms-2" />
        <h1 className="text-xl font-semibold">{t('driver.analytics.title')}</h1>
      </div>
      <div className="flex gap-1 rounded-[12px] border border-edge bg-elevated p-1">
        {(['day', 'week'] as const).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} className={`flex-1 rounded-[9px] px-3 py-2 text-sm font-medium ${period === p ? 'bg-accent text-[#0d1608]' : 'text-muted'}`}>{t(`driver.analytics.${p}`)}</button>
        ))}
      </div>
      {/* Which day / week: ‹ › step, or tap the date to pick any day. */}
      <div className="flex items-center justify-between gap-2 rounded-[12px] border border-edge bg-elevated px-1 py-1">
        <button type="button" aria-label={t('driver.analytics.prev')} onClick={() => setDay(shift(day, period === 'day' ? -1 : -7))} className="flex h-10 w-10 items-center justify-center rounded-full text-xl">‹</button>
        <label className="relative flex-1 cursor-pointer text-center font-semibold">
          {title}
          <input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={t('driver.analytics.pickDay')} />
        </label>
        <button type="button" aria-label={t('driver.analytics.next')} disabled={!canNext} onClick={() => setDay(shift(day, period === 'day' ? 1 : 7))} className="flex h-10 w-10 items-center justify-center rounded-full text-xl disabled:opacity-30">›</button>
      </div>
      {err && <div className="rounded-[12px] border border-danger/40 bg-danger/10 p-3 text-sm">{err} <button className="underline" onClick={load}>{t('driver.trips.retry')}</button></div>}
      {data && (() => {
        const notDone = { count: data.driverCanceled.count + data.missedOffers.count, cents: data.driverCanceled.cents + data.missedOffers.cents };
        return (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="card p-3" data-testid="tile-done">
                <div className="text-xs text-muted">✓ {t('driver.analytics.doneShort')}</div>
                <div className="mt-1 text-2xl font-semibold">{data.completed.count}</div>
                <div className="text-lg font-semibold text-accent">{money(data.completed.cents)}</div>
                {data.pendingFinal > 0 && <div className="mt-0.5 text-[11px] leading-tight text-muted">{t('driver.analytics.pending', { n: data.pendingFinal })}</div>}
              </div>
              <div className={`card p-3 ${notDone.count > 0 ? 'border-danger/40' : ''}`} data-testid="tile-notdone">
                <div className="text-xs text-muted">✕ {t('driver.analytics.notDone')}</div>
                <div className="mt-1 text-2xl font-semibold">{notDone.count}</div>
                <div className={`text-lg font-semibold ${notDone.count > 0 ? 'text-danger' : 'text-muted'}`}>{money(notDone.cents)}</div>
                <div className="mt-0.5 text-[11px] leading-tight text-muted">{t('driver.analytics.could')}</div>
              </div>
            </div>
            <MiniList title={t('driver.analytics.doneShort')} items={data.doneItems} empty={t('driver.analytics.none')} money={money} time={(at) => (period === 'week' ? `${dayName(at.slice(0, 10), { weekday: 'short' })} ` : '') + fmt.time(at)} label={() => ''} />
            <MiniList title={t('driver.analytics.notDone')} items={data.notDoneItems} empty={t('driver.analytics.none')} money={money} time={(at) => (period === 'week' ? `${dayName(at.slice(0, 10), { weekday: 'short' })} ` : '') + fmt.time(at)}
              label={(k) => (k === 'canceled' ? t('driver.analytics.youCanceledShort') : t('driver.analytics.missedShort'))} danger />
            <p className="text-xs text-muted">{t('driver.analytics.note')}</p>
          </>
        );
      })()}
    </div>
  );
}

function MiniList({ title, items, empty, money, time, label, danger }: { title: string; items: Item[]; empty: string; money: (c: number) => string; time: (at: string) => string; label: (k: Item['kind']) => string; danger?: boolean }) {
  return (
    <div className="card p-3">
      <div className="mb-1 text-sm font-semibold">{title}</div>
      {items.length === 0 ? <p className="text-xs text-muted">{empty}</p> : (
        <ul className="divide-y divide-edge text-[13px]">
          {items.map((it, i) => (
            <li key={i} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 py-1.5">
              <span className="tabular-nums text-muted">{time(it.at)}</span>
              <span className="min-w-0 truncate">{label(it.kind) && <span className="me-1 text-muted">{label(it.kind)} ·</span>}→ {it.to}</span>
              <span className={`tabular-nums font-semibold ${danger ? 'text-danger' : ''}`}>{it.cents != null ? money(it.cents) : '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
