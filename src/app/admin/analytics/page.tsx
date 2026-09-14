'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { api } from '@/lib/api-client';

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
  unavailable?: { driverUtilization: { available: boolean; reason: string }; providerPerformance: { available: boolean; reason: string } };
  pipeline: Pipeline;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{() => <Analytics />}</StaffShell>;
}

function Analytics() {
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(isoDate(new Date()));
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
      setData(r); setUpdatedAt(new Date().toLocaleString());
    } catch (e) { setErr((e as Error)?.message ?? 'Failed to load analytics.'); }
    finally { setLoading(false); }
  }, [from, to, test]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="text-sm text-muted">Ride-hailing metrics from the analytics store. All times UTC.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="field mt-1 block !min-h-0 !py-1.5" /></label>
          <label className="text-xs text-muted">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="field mt-1 block !min-h-0 !py-1.5" /></label>
          <label className="flex items-center gap-1.5 pb-2 text-xs text-muted"><input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} /> Include test data</label>
          <button onClick={() => void load()} className="btn-ghost !min-h-0 !py-1.5" disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
      </div>

      {updatedAt && <p className="text-xs text-muted">Data updated {updatedAt} · window {data?.window.from?.slice(0, 10)} → {data?.window.to?.slice(0, 10)} (UTC){data?.window.includeTest ? ' · incl. test data' : ''}</p>}
      {err && <div className="rounded-[12px] border border-danger/40 bg-danger/10 p-3 text-sm">Couldn’t load analytics: {err} <button onClick={() => void load()} className="underline">Retry</button></div>}

      {data && <PipelinePanel p={data.pipeline} />}

      {data && !data.available && (
        <div className="rounded-[12px] border border-edge bg-elevated p-4">
          <p className="font-medium">Analytics unavailable</p>
          <p className="text-sm text-muted">{data.reason}{data.detail ? ` (${data.detail})` : ''}</p>
          <p className="mt-1 text-xs text-muted">Operational data (bookings, dispatch, driver tracking) is unaffected — this store is analytics-only.</p>
        </div>
      )}

      {data?.available && data.overview && (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rides requested" value={data.overview.ridesRequested} />
            <Stat label="Completed" value={data.overview.ridesCompleted} />
            <Stat label="Canceled" value={data.overview.ridesCanceled} />
            <Stat label="No driver" value={data.overview.ridesNoDriver} />
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card title="Offer acceptance">
              <Big>{data.overview.offers.acceptanceRate == null ? '—' : `${Math.round(data.overview.offers.acceptanceRate * 100)}%`}</Big>
              <p className="text-xs text-muted">{data.overview.offers.accepted} accepted · {data.overview.offers.rejected} rejected · {data.overview.offers.expired} expired</p>
            </Card>
            <Card title="Dispatch latency (request → assigned)">
              <Big>{fmtSec(data.overview.dispatchLatencySec.p50)}</Big>
              <p className="text-xs text-muted">p50 · p90 {fmtSec(data.overview.dispatchLatencySec.p90)}</p>
            </Card>
            <Card title="Pickup wait (assigned → arrived)">
              <Big>{fmtSec(data.overview.pickupWaitSec.p50)}</Big>
              <p className="text-xs text-muted">p50 · p90 {fmtSec(data.overview.pickupWaitSec.p90)}</p>
            </Card>
          </section>

          {data.daily && <DailyChart data={data.daily} />}

          {data.fares && (
            <section className="rounded-[12px] border border-edge bg-elevated p-4">
              <h2 className="mb-2 font-medium">Fares & settlement</h2>
              {data.fares.byCurrency.length === 0 ? <p className="text-sm text-muted">No completed fares in this window.</p> : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {data.fares.byCurrency.map((c) => (
                    <div key={c.currency} className="rounded-[10px] border border-edge p-3">
                      <p className="text-sm font-medium">{c.currency}</p>
                      <p className="text-xl font-semibold">{fmtMoney(c.recordedFinalCents, c.currency)}</p>
                      <p className="text-xs text-muted">recorded final · {c.completedTrips} completed trips</p>
                      <p className="text-xs text-muted">{c.knownFinalTrips} with a known final amount · {c.pendingFinalTrips} pending (metered, settled with driver)</p>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-muted">{data.fares.note} Payment is to the driver; this is not platform revenue.</p>
            </section>
          )}

          {data.unavailable && (
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <UnavailableCard title="Driver utilization" reason={data.unavailable.driverUtilization.reason} />
              <UnavailableCard title="Provider performance" reason={data.unavailable.providerPerformance.reason} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function PipelinePanel({ p }: { p: Pipeline }) {
  const ok = p.enabled && p.clickhouseReachable;
  return (
    <div className="rounded-[12px] border border-edge bg-elevated p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className={`font-medium ${ok ? 'text-accent' : 'text-danger'}`}>Pipeline {ok ? 'healthy' : (p.enabled ? 'unreachable' : 'disabled')}</span>
        <span className="text-muted">backlog: {p.backlog.pending} pending · {p.backlog.retry} retry · {p.backlog.processing} processing</span>
        {p.backlog.dead > 0 && <span className="text-danger">{p.backlog.dead} dead</span>}
        <span className="text-muted">exported: {p.backlog.delivered}</span>
        {p.oldestPendingAgeMs != null && <span className="text-muted">oldest pending {Math.round(p.oldestPendingAgeMs / 1000)}s</span>}
        {p.chDistinctEvents != null && <span className="text-muted">CH events: {p.chDistinctEvents}</span>}
        {p.consistent != null && <span className={p.consistent ? 'text-muted' : 'text-danger'}>{p.consistent ? 'reconciled' : `gap ${p.gap}`}</span>}
      </div>
    </div>
  );
}

function DailyChart({ data }: { data: DailyPoint[] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.requested, d.completed)));
  return (
    <section className="rounded-[12px] border border-edge bg-elevated p-4">
      <h2 className="mb-3 font-medium">Rides per day</h2>
      {data.length === 0 ? <p className="text-sm text-muted">No rides in this window.</p> : (
        <>
          <div className="flex items-end gap-1 overflow-x-auto" style={{ height: 140 }} role="img" aria-label="Daily requested vs completed rides">
            {data.map((d) => (
              <div key={d.day} className="flex min-w-[10px] flex-1 flex-col items-center justify-end gap-0.5" title={`${d.day}: ${d.requested} requested, ${d.completed} completed`}>
                <div className="w-full rounded-t bg-accent/40" style={{ height: `${(d.requested / max) * 100}%` }} />
                <div className="w-full rounded-t bg-accent" style={{ height: `${(d.completed / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-4 text-xs text-muted"><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent/40" />requested</span><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent" />completed</span></div>
          {/* Accessible list fallback */}
          <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Show as list</summary>
            <ul className="mt-1 space-y-0.5">{data.map((d) => <li key={d.day}>{d.day}: {d.requested} requested, {d.completed} completed</li>)}</ul>
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
  return <div className="rounded-[12px] border border-dashed border-edge bg-elevated/50 p-4"><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted">Not yet available — {reason}</p></div>;
}

function fmtSec(s: number | null): string { if (s == null) return '—'; if (s < 90) return `${s}s`; return `${Math.round(s / 60)}m`; }
function fmtMoney(cents: number, currency: string): string {
  try { return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}
