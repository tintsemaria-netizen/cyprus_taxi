'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';

export const dynamic = 'force-dynamic';

interface Overview {
  ridesRequested: number; ridesCompleted: number; ridesCanceled: number; ridesNoDriver: number;
  offers: { accepted: number; rejected: number; expired: number; acceptanceRate: number | null };
  dispatchLatencySec: { p50: number | null; p90: number | null };
  pickupWaitSec: { p50: number | null; p90: number | null };
}
interface DailyPoint { day: string; requested: number; completed: number }
interface FareSummary { byCurrency: { currency: string; completedTrips: number; recordedFinalCents: number; knownFinalTrips: number; pendingFinalTrips: number }[]; note: string }
interface Pipeline {
  enabled: boolean; clickhouseReachable: boolean;
  backlog: { pending: number; retry: number; processing: number; dead: number; delivered: number };
  oldestPendingAgeMs: number | null; pgDelivered: number; chDistinctEvents: number | null; gap: number | null; consistent: boolean | null;
}
interface Resp {
  available: boolean; reason?: string; detail?: string;
  window: { from: string; to: string; includeTest: boolean; timezone?: string };
  overview?: Overview; daily?: DailyPoint[]; fares?: FareSummary;
  utilization?: { available: true; onlineHours: number; activeDrivers: number; note: string };
  unavailable?: { providerPerformance: { available: boolean; reason: string } };
  pipeline: Pipeline;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{() => <Analytics />}</StaffShell>;
}

function Analytics() {
  const { t, fmt } = useT();
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [test, setTest] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const toEx = new Date(new Date(to).getTime() + 86_400_000); // inclusive end day → half-open
      const q = new URLSearchParams({ from: new Date(from).toISOString(), to: toEx.toISOString(), ...(test ? { test: '1' } : {}) });
      const r = await api<Resp>(`/admin/analytics?${q.toString()}`);
      setData(r); setUpdatedAt(fmt.dateTime(new Date()));
    } catch (e) { setErr((e as Error)?.message ?? 'Failed to load analytics.'); }
    finally { setLoading(false); }
  }, [from, to, test, fmt]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('staff.an.title')}</h1>
          <p className="text-sm text-muted">{t('staff.an.sub')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">{t('staff.an.from')}<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="field mt-1 block !min-h-0 !py-1.5" /></label>
          <label className="text-xs text-muted">{t('staff.an.to')}<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="field mt-1 block !min-h-0 !py-1.5" /></label>
          <label className="flex items-center gap-1.5 pb-2 text-xs text-muted"><input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} /> {t('staff.an.includeTest')}</label>
          <button onClick={() => void load()} className="btn-ghost !min-h-0 !py-1.5" disabled={loading}>{loading ? t('staff.loading') : t('staff.an.refresh')}</button>
        </div>
      </div>

      {updatedAt && <p className="text-xs text-muted">{t('staff.an.updated', { at: updatedAt, from: data?.window.from?.slice(0, 10) ?? '', to: data?.window.to?.slice(0, 10) ?? '' })}{data?.window.includeTest ? t('staff.an.inclTest') : ''}</p>}
      {err && <div className="rounded-[12px] border border-danger/40 bg-danger/10 p-3 text-sm">{t('staff.an.loadFailed', { err })} <button onClick={() => void load()} className="underline">{t('common.retry')}</button></div>}

      {data && <PipelinePanel p={data.pipeline} />}

      {data && !data.available && (
        <div className="rounded-[12px] border border-edge bg-elevated p-4">
          <p className="font-medium">{t('staff.an.unavailable')}</p>
          <p className="text-sm text-muted">{data.reason}{data.detail ? ` (${data.detail})` : ''}</p>
          <p className="mt-1 text-xs text-muted">{t('staff.an.unaffected')}</p>
        </div>
      )}

      {data?.available && data.overview && (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t('staff.an.requested')} value={data.overview.ridesRequested} />
            <Stat label={t('staff.an.completed')} value={data.overview.ridesCompleted} />
            <Stat label={t('staff.an.canceled')} value={data.overview.ridesCanceled} />
            <Stat label={t('staff.an.noDriver')} value={data.overview.ridesNoDriver} />
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card title={t('staff.an.acceptance')}>
              <Big>{data.overview.offers.acceptanceRate == null ? '—' : `${Math.round(data.overview.offers.acceptanceRate * 100)}%`}</Big>
              <p className="text-xs text-muted">{t('staff.an.acceptanceSub', { a: data.overview.offers.accepted, r: data.overview.offers.rejected, e: data.overview.offers.expired })}</p>
            </Card>
            <Card title={t('staff.an.latency')}>
              <Big>{fmtSec(data.overview.dispatchLatencySec.p50)}</Big>
              <p className="text-xs text-muted">{t('staff.an.p90', { v: fmtSec(data.overview.dispatchLatencySec.p90) })}</p>
            </Card>
            <Card title={t('staff.an.pickupWait')}>
              <Big>{fmtSec(data.overview.pickupWaitSec.p50)}</Big>
              <p className="text-xs text-muted">{t('staff.an.p90', { v: fmtSec(data.overview.pickupWaitSec.p90) })}</p>
            </Card>
          </section>

          {data.daily && <DailyChart data={data.daily} />}

          {data.fares && (
            <section className="rounded-[12px] border border-edge bg-elevated p-4">
              <h2 className="mb-2 font-medium">{t('staff.an.fares')}</h2>
              {data.fares.byCurrency.length === 0 ? <p className="text-sm text-muted">{t('staff.an.noFares')}</p> : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {data.fares.byCurrency.map((c) => (
                    <div key={c.currency} className="rounded-[10px] border border-edge p-3">
                      <p className="text-sm font-medium">{c.currency}</p>
                      <p className="text-xl font-semibold">{fmtMoney(c.recordedFinalCents, c.currency)}</p>
                      <p className="text-xs text-muted">{t('staff.an.recorded', { n: c.completedTrips })}</p>
                      <p className="text-xs text-muted">{t('staff.an.known', { k: c.knownFinalTrips, p: c.pendingFinalTrips })}</p>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-muted">{data.fares.note} {t('staff.an.notRevenue')}</p>
            </section>
          )}

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.utilization && (
              <Card title={t('staff.an.online')}>
                <Big>{data.utilization.onlineHours}h</Big>
                <p className="text-xs text-muted">{t('staff.an.activeDrivers', { n: data.utilization.activeDrivers })} · {data.utilization.note}</p>
              </Card>
            )}
            {data.unavailable && <UnavailableCard title={t('staff.an.provider')} reason={data.unavailable.providerPerformance.reason} />}
          </section>
        </>
      )}
    </div>
  );
}

function PipelinePanel({ p }: { p: Pipeline }) {
  const { t } = useT();
  const ok = p.enabled && p.clickhouseReachable;
  return (
    <div className="rounded-[12px] border border-edge bg-elevated p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className={`font-medium ${ok ? 'text-accent' : 'text-danger'}`}>{ok ? t('staff.an.pipelineHealthy') : (p.enabled ? t('staff.an.pipelineUnreachable') : t('staff.an.pipelineDisabled'))}</span>
        <span className="text-muted">{t('staff.an.backlog', { p: p.backlog.pending, r: p.backlog.retry, x: p.backlog.processing })}</span>
        {p.backlog.dead > 0 && <span className="text-danger">{t('staff.an.dead', { n: p.backlog.dead })}</span>}
        <span className="text-muted">{t('staff.an.exported', { n: p.backlog.delivered })}</span>
        {p.oldestPendingAgeMs != null && <span className="text-muted">{t('staff.an.oldest', { n: Math.round(p.oldestPendingAgeMs / 1000) })}</span>}
        {p.chDistinctEvents != null && <span className="text-muted">{t('staff.an.chEvents', { n: p.chDistinctEvents })}</span>}
        {p.consistent != null && <span className={p.consistent ? 'text-muted' : 'text-danger'}>{p.consistent ? t('staff.an.reconciled') : t('staff.an.gap', { n: p.gap ?? 0 })}</span>}
      </div>
    </div>
  );
}

function DailyChart({ data }: { data: DailyPoint[] }) {
  const { t } = useT();
  const max = Math.max(1, ...data.map((d) => Math.max(d.requested, d.completed)));
  return (
    <section className="rounded-[12px] border border-edge bg-elevated p-4">
      <h2 className="mb-3 font-medium">{t('staff.an.perDay')}</h2>
      {data.length === 0 ? <p className="text-sm text-muted">{t('staff.an.noRides')}</p> : (
        <>
          <div className="flex items-end gap-1 overflow-x-auto" style={{ height: 140 }} role="img" aria-label={t('staff.an.chartAria')}>
            {data.map((d) => (
              <div key={d.day} className="flex min-w-[10px] flex-1 flex-col items-center justify-end gap-0.5" title={t('staff.an.dayTip', { day: d.day, r: d.requested, c: d.completed })}>
                <div className="w-full rounded-t bg-accent/40" style={{ height: `${(d.requested / max) * 100}%` }} />
                <div className="w-full rounded-t bg-accent" style={{ height: `${(d.completed / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-4 text-xs text-muted"><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent/40" />{t('staff.an.lReq')}</span><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent" />{t('staff.an.lDone')}</span></div>
          {/* Accessible list fallback */}
          <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">{t('staff.an.asList')}</summary>
            <ul className="mt-1 space-y-0.5">{data.map((d) => <li key={d.day}>{t('staff.an.dayTip', { day: d.day, r: d.requested, c: d.completed })}</li>)}</ul>
          </details>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-[12px] border border-edge bg-elevated p-4"><p className="text-2xl font-semibold">{value}</p><p className="text-xs text-muted">{label}</p></div>;
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-[12px] border border-edge bg-elevated p-4"><p className="mb-1 text-xs text-muted">{title}</p>{children}</div>;
}
function Big({ children }: { children: React.ReactNode }) { return <p className="text-2xl font-semibold">{children}</p>; }
function UnavailableCard({ title, reason }: { title: string; reason: string }) {
  const { t } = useT();
  return <div className="rounded-[12px] border border-dashed border-edge bg-elevated/50 p-4"><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted">{t('staff.an.notYet', { reason })}</p></div>;
}

function fmtSec(s: number | null): string { if (s == null) return '—'; if (s < 90) return `${s}s`; return `${Math.round(s / 60)}m`; }
function fmtMoney(cents: number, currency: string): string {
  try { return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}
