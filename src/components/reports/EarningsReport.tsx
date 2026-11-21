'use client';

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { api } from '@/lib/api-client';
import { BackArrow } from '@/components/BackArrow';
import { DriverAnalytics } from '@/components/driver/DriverAnalytics';
import { DutyPane } from './DutyPane';
import { useReportFmt } from './format';

// Shared report tool (2026-11-20): earnings + done / not-done + hours & km for one driver.
// The driver opens his own (apiBase '/driver'); the admin any driver's ('/admin/drivers/<id>/report').

// ---- Earnings ----
export type Range = 'today' | 'week' | 'month';

export function EarningsReport({ initialRange = 'week', openAnalytics, apiBase = '/driver', exportHref, title, onBack }: { initialRange?: Range; openAnalytics?: boolean; apiBase?: string; exportHref?: (range: Range) => string; title?: string; onBack?: () => void } = {}) {
  const { t, tp, tError } = useT();
  const [analytics, setAnalytics] = useState(!!openAnalytics);
  const [duty, setDuty] = useState(false); // «Время на линии» tile → hours & km pane (2026-11-20) // «Выполнено заказов» tile → analytics sub-screen (2026-11-19)
  const { money, dur } = useReportFmt();
  const [range, setRange] = useState<Range>(initialRange);
  const [data, setData] = useState<{ summary: { byCurrency: { currency: string; completedTrips: number; recordedEarningsCents: number; knownFinalTrips: number; pendingFinalTrips: number; collectedCents: number; cashCents?: number; cardCents?: number }[]; completedTrips: number; pendingFinalTrips: number; onlineSeconds: number }; daily: { day: string; recordedEarningsCents: number; completedTrips: number; currency: string }[]; notDone?: number | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setData(await api(`${apiBase}/earnings?range=${range}`)); } catch (e) { setErr(e ? tError(e) : t('driver.detail.loadFailed')); } finally { setLoading(false); }
  }, [range, t, tError, apiBase]);
  useEffect(() => { load(); }, [load]);

  const max = Math.max(1, ...(data?.daily.map((d) => d.recordedEarningsCents) ?? [0]));
  if (analytics) return <DriverAnalytics apiBase={apiBase} onBack={() => setAnalytics(false)} />;
  // Hours & km in the earnings screen too (2026-11-20, operator): the same pane as on the map card.
  if (duty) return <div className="card p-4" data-testid="earnings-duty"><DutyPane apiBase={apiBase} onBack={() => setDuty(false)} onClose={() => setDuty(false)} /></div>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        {onBack && <BackArrow onBack={onBack} className="-ms-2" />}
        <h1 className="min-w-0 truncate text-xl font-semibold">{title ?? t('driver.earnings.title')}</h1>
      </div>
      <div className="flex gap-1 rounded-[12px] border border-edge bg-elevated p-1">
        {(['today', 'week', 'month'] as Range[]).map((r) => <button key={r} onClick={() => setRange(r)} className={`flex-1 rounded-[9px] px-3 py-2 text-sm font-medium ${range === r ? 'bg-accent text-[#0d1608]' : 'text-muted'}`}>{t(`driver.range.${r}`)}</button>)}
      </div>
      {err && <div className="rounded-[12px] border border-danger/40 bg-danger/10 p-3 text-sm">{t('driver.earnings.loadFailed', { error: err })} <button className="underline" onClick={load}>{t('driver.trips.retry')}</button></div>}
      {loading && !data && <p className="text-muted">{t('common.loading')}</p>}
      {data && (
        <>
          {/* Same order as the today card on the map (2026-11-21, operator): the sum on top, then
              💶 cash | 💳 card, then ✓ done ✕ not done (wide) | time online (narrow). */}
          {data.summary.byCurrency.length === 0 ? (
            <div className="card p-4"><div className="text-3xl font-bold text-accent">{money(0, 'EUR')}</div><div className="text-xs text-muted">{t('driver.earnings.empty')}</div></div>
          ) : data.summary.byCurrency.map((c) => (
            <div key={c.currency} className="card p-4">
              <div className="text-3xl font-bold text-accent">{money(c.recordedEarningsCents, c.currency)}</div>
              <div className="text-xs text-muted">{t('driver.earnings.summary', { currency: c.currency, completed: c.completedTrips })}{c.pendingFinalTrips > 0 ? t('driver.earnings.pendingFinal', { count: c.pendingFinalTrips }) : ''}</div>
              {c.collectedCents > 0 && <div className="mt-1 text-xs text-muted">{t('driver.earnings.collected', { amount: money(c.collectedCents, c.currency) })}</div>}
            </div>
          ))}
          {(data.summary.byCurrency.length ? data.summary.byCurrency : [{ currency: 'EUR', cashCents: 0, cardCents: 0 }]).map((c) => (
            <div key={`split-${c.currency}`} className="grid grid-cols-2 gap-2" data-testid="earn-split">
              <div className="rounded-[12px] border border-edge bg-elevated px-3 py-2" data-testid="earn-split-cash">
                <div className="text-[11px] text-muted">💶 {t('driver.home.todayCash')}</div>
                <div className="text-lg font-semibold tabular-nums">{money(c.cashCents ?? 0, c.currency)}</div>
              </div>
              <div className="rounded-[12px] border border-edge bg-elevated px-3 py-2" data-testid="earn-split-card">
                <div className="text-[11px] text-muted">💳 {t('driver.home.todayCard')}</div>
                <div className="text-lg font-semibold tabular-nums">{money(c.cardCents ?? 0, c.currency)}</div>
              </div>
            </div>
          ))}
          <div className="grid grid-cols-[1.55fr_1fr] gap-2">
            <button type="button" onClick={() => setAnalytics(true)} data-testid="analytics-tile"
              className="flex items-center justify-around rounded-[12px] border border-edge bg-elevated px-3 py-2 active:bg-white/5"
              aria-label={`${t('driver.analytics.doneShort')} ${data.summary.completedTrips}, ${t('driver.analytics.notDone')} ${data.notDone ?? 0}`}>
              <span className="flex items-baseline gap-1.5"><span className="text-[14px] font-bold text-[#34C759]">✓</span><span className="text-[22px] font-semibold tabular-nums">{data.summary.completedTrips}</span></span>
              {data.notDone != null && <span className="flex items-baseline gap-1.5"><span className="text-[14px] font-bold text-danger">✕</span><span className="text-[22px] font-semibold tabular-nums">{data.notDone}</span></span>}
            </button>
            <button type="button" onClick={() => setDuty(true)} data-testid="earnings-online-tile" className="rounded-[12px] border border-edge bg-elevated px-3 py-2 text-start active:bg-white/5">
              <div className="text-[11px] text-muted">{t('driver.earnings.onlineTime')} ›</div>
              <div className="whitespace-nowrap text-[15px] font-semibold">{dur(data.summary.onlineSeconds)}</div>
            </button>
          </div>
          <p className="text-xs text-muted">{t('driver.earnings.note')}</p>

          <div className="card p-4">
            <div className="mb-2 font-medium">{t('driver.earnings.daily')}</div>
            {data.daily.length === 0 ? <p className="text-sm text-muted">{t('driver.earnings.noData')}</p> : (
              <>
                <div className="flex items-end gap-1" style={{ height: 120 }} role="img" aria-label={t('driver.earnings.chartLabel')}>
                  {data.daily.map((d) => <div key={d.day + d.currency} className="flex h-full min-w-[8px] flex-1 flex-col items-center justify-end" title={`${d.day}: ${money(d.recordedEarningsCents, d.currency)}`}><div className="w-full rounded-t bg-accent" style={{ height: `${(d.recordedEarningsCents / max) * 100}%` }} /></div>)}
                </div>
                <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">{t('driver.earnings.showList')}</summary><ul className="mt-1 space-y-0.5">{data.daily.map((d) => <li key={d.day + d.currency}>{d.day}: {money(d.recordedEarningsCents, d.currency)} · {tp('driver.earnings.trips', d.completedTrips)}</li>)}</ul></details>
              </>
            )}
          </div>
          <a href={exportHref ? exportHref(range) : `/api/v1${apiBase === '/driver' ? '/driver/earnings' : apiBase}/export?range=${range}`} className="btn-ghost block w-full text-center">{t('driver.earnings.download')}</a>
        </>
      )}
    </div>
  );
}

