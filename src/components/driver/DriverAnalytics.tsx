'use client';

import { useCallback, useEffect, useState } from 'react';
import { useT, useLocale } from '@/i18n/I18nProvider';
import { INTL_TAG } from '@/i18n/config';
import { api } from '@/lib/api-client';
import { BackArrow } from '@/components/BackArrow';

// Driver analytics (2026-11-19, operator): opened from the «Выполнено заказов» tile. One Cyprus day
// (any day, ‹ › to step) or a Monday–Sunday week: done + earned, and what slipped away — rides the
// driver cancelled, rides the passenger cancelled / no-show, offers declined or missed — with the
// money they were worth.

interface Bucket { count: number; cents: number }
interface Day { day: string; completed: Bucket; pendingFinal: number; driverCanceled: Bucket; passengerCanceled: Bucket; missedOffers: Bucket }
interface Data extends Day { from: string; to: string; days: Day[] }

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
      {data && (
        <>
          <div className="card p-4">
            <div className="text-sm text-muted">✓ {t('driver.analytics.done')}</div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-semibold">{data.completed.count}</span>
              <span className="text-2xl font-semibold text-accent">{money(data.completed.cents)}</span>
            </div>
            {data.pendingFinal > 0 && <div className="mt-1 text-xs text-muted">{t('driver.analytics.pending', { n: data.pendingFinal })}</div>}
          </div>
          <Lost label={t('driver.analytics.youCanceled')} b={data.driverCanceled} money={money} could={t('driver.analytics.could')} strong />
          <Lost label={t('driver.analytics.paxCanceled')} b={data.passengerCanceled} money={money} could={t('driver.analytics.could')} />
          <Lost label={t('driver.analytics.missed')} b={data.missedOffers} money={money} could={t('driver.analytics.could')} />
          <p className="text-xs text-muted">{t('driver.analytics.note')}</p>
          {period === 'week' && (
            <div className="card p-3">
              <div className="mb-1 grid grid-cols-[1fr_auto_auto] gap-x-3 px-1 text-xs text-muted">
                <span>{t('driver.analytics.dayCol')}</span><span className="text-end">{t('driver.analytics.doneCol')}</span><span className="text-end">{t('driver.analytics.lostCol')}</span>
              </div>
              {data.days.map((d) => {
                const lost = d.driverCanceled.count + d.passengerCanceled.count + d.missedOffers.count;
                const lostC = d.driverCanceled.cents + d.passengerCanceled.cents + d.missedOffers.cents;
                return (
                  <button key={d.day} type="button" onClick={() => { setPeriod('day'); setDay(d.day); }} className="grid w-full grid-cols-[1fr_auto_auto] gap-x-3 rounded-[8px] px-1 py-1.5 text-start text-sm hover:bg-white/5">
                    <span className="capitalize">{dayName(d.day, { weekday: 'short', day: 'numeric' })}</span>
                    <span className="text-end tabular-nums">{d.completed.count} · {money(d.completed.cents)}</span>
                    <span className="text-end tabular-nums text-muted">{lost} · {money(lostC)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Lost({ label, b, money, could, strong }: { label: string; b: Bucket; money: (c: number) => string; could: string; strong?: boolean }) {
  return (
    <div className={`card flex items-center justify-between gap-3 p-4 ${strong && b.count > 0 ? 'border-danger/40' : ''}`}>
      <div>
        <div className="text-sm text-muted">{label}</div>
        <div className="text-xl font-semibold">{b.count}</div>
      </div>
      <div className="text-end">
        <div className="text-xs text-muted">{could}</div>
        <div className={`text-lg font-semibold ${b.count > 0 ? 'text-danger' : 'text-muted'}`}>{money(b.cents)}</div>
      </div>
    </div>
  );
}
