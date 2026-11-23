'use client';

// «Бухгалтерия» (2026-11-23, operator: «только я, только евро»). The owner's income and expenses,
// recurring items, receipts and the figures of a month / quarter / year. Only StaffUser.isOwner.
import { useCallback, useEffect, useState } from 'react';
import { StaffShell, type Me } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { useRefreshOnReturn } from '@/components/useRefreshOnReturn';

export const dynamic = 'force-dynamic';

type Kind = 'INCOME' | 'EXPENSE';
type PeriodKind = 'month' | 'quarter' | 'year';
interface Entry { id: string; kind: Kind; day: string; amountCents: number; category: string; counterparty: string | null; method: string | null; note: string | null; hasReceipt: boolean; recurring: boolean }
interface Recurring { id: string; kind: Kind; amountCents: number; category: string; counterparty: string | null; every: 'MONTH' | 'YEAR'; nextDay: string }
interface View {
  period: { kind: PeriodKind; key: string; prev: string; next: string; from: string; to: string };
  totals: { incomeCents: number; expenseCents: number; profitCents: number; taxInfoCents: number; taxRate: number };
  incomeByCategory: { category: string; cents: number }[];
  expenseByCategory: { category: string; cents: number }[];
  vat: { turnover12mCents: number; thresholdCents: number };
  drivers: { drivers: number; trips: number; cashCents: number; cardCents: number; totalCents: number };
  entries: Entry[];
  recurring: Recurring[];
}
interface Draft { id: string | null; recurring: boolean; kind: Kind; day: string; amount: string; category: string; counterparty: string; method: string; note: string; every: 'MONTH' | 'YEAR' }

const INCOME_CATS = ['subscription', 'commission', 'misc'];
const EXPENSE_CATS = ['apple', 'google', 'server', 'domain', 'sms', 'accountant', 'advertising', 'misc'];
const METHODS = ['bank', 'card', 'cash', 'misc'];
const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Nicosia' }).format(new Date());

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{(me) => <Accounting me={me} />}</StaffShell>;
}

function Accounting({ me }: { me: Me }) {
  const { t, fmt, locale } = useT();
  const [period, setPeriod] = useState<PeriodKind>('month');
  const [key, setKey] = useState<string | null>(null);
  const [v, setV] = useState<View | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    try {
      setV(await api<View>(`/admin/accounting?period=${period}${key ? `&key=${encodeURIComponent(key)}` : ''}`));
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 403) setDenied(true);
      else setMsg(e instanceof ApiRequestError ? e.body.message : String(e));
    }
  }, [period, key]);
  useEffect(() => { void load(); }, [load]);
  useRefreshOnReturn(load);

  if (denied || !me.isOwner) return <div className="p-6 text-muted">403</div>;
  if (!v) return <div className="p-6 text-muted">{t('staff.loading')}</div>;

  const money = (c: number) => fmt.money(c);
  // «18 нояб.» — the period already says the year.
  const dayShort = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const cat = (c: string) => t(`staff.acc.cat.${c}` as 'staff.acc.cat.misc');
  const vatPct = Math.min(100, Math.round((v.vat.turnover12mCents / v.vat.thresholdCents) * 100));

  const startNew = (kind: Kind, recurring = false) => setDraft({ id: null, recurring, kind, day: todayKey(), amount: '', category: kind === 'INCOME' ? 'subscription' : 'apple', counterparty: '', method: 'bank', note: '', every: 'YEAR' });
  const startEdit = (e: Entry) => setDraft({ id: e.id, recurring: false, kind: e.kind, day: e.day, amount: (e.amountCents / 100).toFixed(2), category: e.category, counterparty: e.counterparty ?? '', method: e.method ?? 'bank', note: e.note ?? '', every: 'YEAR' });

  async function save() {
    if (!draft) return;
    setMsg(null);
    const cents = Math.round(Number(draft.amount.replace(',', '.')) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { setMsg(t('staff.acc.form.amount')); return; }
    const base = { kind: draft.kind, amountCents: cents, category: draft.category, counterparty: draft.counterparty || null, method: draft.method, note: draft.note || null };
    try {
      if (draft.recurring) await api('/admin/accounting/recurring', { method: 'POST', body: { ...base, every: draft.every, startDay: draft.day } });
      else if (draft.id) await api(`/admin/accounting/entries/${draft.id}`, { method: 'PATCH', body: { ...base, day: draft.day } });
      else await api('/admin/accounting', { method: 'POST', body: { ...base, day: draft.day } });
      setDraft(null);
      await load();
    } catch (e) { setMsg(e instanceof ApiRequestError ? e.body.message : String(e)); }
  }
  async function remove(e: Entry) {
    if (!window.confirm(t('staff.acc.delConfirm'))) return;
    await api(`/admin/accounting/entries/${e.id}`, { method: 'DELETE' }).catch(() => null);
    await load();
  }
  async function stop(r: Recurring) {
    if (!window.confirm(t('staff.acc.stopConfirm'))) return;
    await api(`/admin/accounting/recurring/${r.id}`, { method: 'DELETE' }).catch(() => null);
    await load();
  }
  async function attach(e: Entry, file: File) {
    setMsg(null);
    const fd = new FormData();
    fd.set('file', file);
    const res = await fetch(`/api/v1/admin/accounting/entries/${e.id}/receipt`, { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setMsg(j?.error?.message ?? 'Upload failed'); }
    await load();
  }

  const tile = (label: string, cents: number, tone: string, id: string) => (
    <div className="card p-3" data-testid={id}><div className="text-xs text-muted">{label}</div><div className={`mt-1 text-xl font-bold tabular-nums ${tone}`}>{money(cents)}</div></div>
  );
  const bars = (rows: { category: string; cents: number }[], total: number, color: string) => rows.map((r) => (
    <div key={r.category} className="text-sm">
      <div className="flex justify-between"><span>{cat(r.category)}</span><span className="tabular-nums">{money(r.cents)}</span></div>
      <div className="mt-1 h-1.5 rounded-full bg-elevated"><div className={`h-1.5 rounded-full ${color}`} style={{ width: `${total ? Math.max(3, Math.round((r.cents / total) * 100)) : 0}%` }} /></div>
    </div>
  ));

  return (
    <div className="mx-auto max-w-5xl p-4" data-testid="accounting">
      <h1 className="text-xl font-semibold">{t('staff.acc.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('staff.acc.sub')}</p>
      {!me.mfa?.enabled && <p className="mt-2 rounded-[10px] border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{t('staff.acc.mfaHint')}</p>}

      {/* Period: month / quarter / year, ‹ › to move. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-[12px] border border-edge p-0.5">
          {(['month', 'quarter', 'year'] as const).map((p) => (
            <button key={p} type="button" onClick={() => { setPeriod(p); setKey(null); }} className={`rounded-[10px] px-3 py-1.5 text-sm ${period === p ? 'bg-accent font-semibold text-[#0b0f10]' : 'text-muted'}`} data-testid={`acc-${p}`}>{t(`staff.acc.${p}`)}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost !min-h-[36px] !px-3 !py-1" onClick={() => setKey(v.period.prev)} aria-label="‹">‹</button>
          <span className="min-w-[88px] text-center font-semibold" data-testid="acc-period">{v.period.key}</span>
          <button type="button" className="btn-ghost !min-h-[36px] !px-3 !py-1" onClick={() => setKey(v.period.next)} aria-label="›">›</button>
        </div>
        <a href={`/api/v1/admin/accounting/export?period=${period}&key=${encodeURIComponent(v.period.key)}`} className="btn-ghost ms-auto !min-h-[36px] !py-1.5 text-sm" data-testid="acc-export">⬇ {t('staff.acc.export')}</a>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {tile(t('staff.acc.income'), v.totals.incomeCents, 'text-accent', 'acc-income')}
        {tile(t('staff.acc.expense'), v.totals.expenseCents, 'text-danger', 'acc-expense')}
        {tile(t('staff.acc.profit'), v.totals.profitCents, v.totals.profitCents < 0 ? 'text-danger' : 'text-ink', 'acc-profit')}
        <div className="card p-3" data-testid="acc-tax"><div className="text-xs text-muted">{t('staff.acc.taxInfo', { rate: Math.round(v.totals.taxRate * 100) })}</div><div className="mt-1 text-xl font-bold tabular-nums">{money(v.totals.taxInfoCents)}</div><div className="mt-0.5 text-[11px] text-muted">{t('staff.acc.taxNote')}</div></div>
      </div>

      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div className="card p-3" data-testid="acc-vat">
          <div className="text-xs text-muted">{t('staff.acc.vatTitle')}</div>
          <div className="mt-1 text-sm font-semibold">{t('staff.acc.vatOf', { amount: money(v.vat.turnover12mCents), limit: money(v.vat.thresholdCents) })}</div>
          <div className="mt-2 h-2 rounded-full bg-elevated"><div className={`h-2 rounded-full ${vatPct >= 100 ? 'bg-danger' : vatPct >= 80 ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${Math.max(2, vatPct)}%` }} /></div>
          {vatPct >= 100 ? <div className="mt-1 text-xs text-danger">{t('staff.acc.vatOver')}</div> : vatPct >= 80 ? <div className="mt-1 text-xs text-warn">{t('staff.acc.vatNear')}</div> : null}
        </div>
        <div className="card p-3" data-testid="acc-drivers">
          <div className="text-xs text-muted">{t('staff.acc.drivers')}</div>
          <div className="mt-1 text-xl font-bold tabular-nums">{money(v.drivers.totalCents)}</div>
          <div className="text-sm">{t('staff.acc.driversLine', { trips: v.drivers.trips, cash: money(v.drivers.cashCents), card: money(v.drivers.cardCents) })}</div>
          <div className="mt-0.5 text-[11px] text-muted">{t('staff.acc.driversNote')}</div>
        </div>
      </div>

      {(v.incomeByCategory.length > 0 || v.expenseByCategory.length > 0) && (
        <div className="card mt-2 grid gap-4 p-3 md:grid-cols-2" data-testid="acc-categories">
          <div className="space-y-2"><div className="text-xs text-muted">{t('staff.acc.income')} · {t('staff.acc.byCategory')}</div>{bars(v.incomeByCategory, v.totals.incomeCents, 'bg-accent')}</div>
          <div className="space-y-2"><div className="text-xs text-muted">{t('staff.acc.expense')} · {t('staff.acc.byCategory')}</div>{bars(v.expenseByCategory, v.totals.expenseCents, 'bg-danger')}</div>
        </div>
      )}

      {msg && <p className="mt-3 text-sm text-danger" data-testid="acc-msg">{msg}</p>}

      {draft && (
        <div className="card mt-3 space-y-3 p-4" data-testid="acc-form">
          <div className="font-semibold">{draft.recurring ? t('staff.acc.form.newRecurring') : draft.id ? t('staff.acc.form.editTitle') : draft.kind === 'INCOME' ? t('staff.acc.form.newIncome') : t('staff.acc.form.newExpense')}</div>
          {draft.recurring && (
            <div className="flex rounded-[12px] border border-edge p-0.5">
              {(['EXPENSE', 'INCOME'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setDraft({ ...draft, kind: k, category: k === 'INCOME' ? 'subscription' : 'apple' })} className={`flex-1 rounded-[10px] px-3 py-1.5 text-sm ${draft.kind === k ? 'bg-accent font-semibold text-[#0b0f10]' : 'text-muted'}`}>{k === 'INCOME' ? t('staff.acc.income') : t('staff.acc.expense')}</button>
              ))}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block text-sm">{draft.recurring ? t('staff.acc.form.startDate') : t('staff.acc.form.date')}<input type="date" className="field mt-1" value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })} data-testid="acc-day" /></label>
            <label className="block text-sm">{t('staff.acc.form.amount')}<input className="field mt-1" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder="99.00" data-testid="acc-amount" /></label>
            <label className="block text-sm">{t('staff.acc.form.category')}
              <select className="field mt-1" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} data-testid="acc-category">
                {(draft.kind === 'INCOME' ? INCOME_CATS : EXPENSE_CATS).map((c) => <option key={c} value={c}>{cat(c)}</option>)}
              </select>
            </label>
            <label className="block text-sm">{t('staff.acc.form.counterparty')}<input className="field mt-1" value={draft.counterparty} onChange={(e) => setDraft({ ...draft, counterparty: e.target.value })} data-testid="acc-counterparty" /></label>
            <label className="block text-sm">{t('staff.acc.form.method')}
              <select className="field mt-1" value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value })}>
                {METHODS.map((m) => <option key={m} value={m}>{t(`staff.acc.method.${m}` as 'staff.acc.method.misc')}</option>)}
              </select>
            </label>
            {draft.recurring && (
              <label className="block text-sm">{t('staff.acc.form.every')}
                <select className="field mt-1" value={draft.every} onChange={(e) => setDraft({ ...draft, every: e.target.value as 'MONTH' | 'YEAR' })} data-testid="acc-every">
                  <option value="MONTH">{t('staff.acc.every.MONTH')}</option><option value="YEAR">{t('staff.acc.every.YEAR')}</option>
                </select>
              </label>
            )}
          </div>
          <label className="block text-sm">{t('staff.acc.form.note')}<input className="field mt-1" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost !min-h-[44px] !py-2 text-sm" onClick={() => setDraft(null)}>{t('staff.acc.form.cancel')}</button>
            <button type="button" className="btn-primary !min-h-[44px] flex-1 !py-2 text-sm" onClick={() => void save()} data-testid="acc-save">{t('staff.acc.form.save')}</button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{t('staff.acc.entries')}</h2>
        <div className="ms-auto flex gap-2">
          <button type="button" className="btn-primary !min-h-[38px] !py-1.5 text-sm" onClick={() => startNew('INCOME')} data-testid="acc-add-income">{t('staff.acc.addIncome')}</button>
          <button type="button" className="btn-ghost !min-h-[38px] !py-1.5 text-sm" onClick={() => startNew('EXPENSE')} data-testid="acc-add-expense">{t('staff.acc.addExpense')}</button>
        </div>
      </div>
      <div className="mt-2 space-y-2" data-testid="acc-entries">
        {v.entries.length === 0 && <div className="text-sm text-muted">{t('staff.acc.none')}</div>}
        {v.entries.map((e) => (
          <div key={e.id} className="card flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm" data-testid="acc-entry">
            <span className="w-[64px] shrink-0 text-muted">{dayShort(e.day)}</span>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{cat(e.category)}</span>
              {e.counterparty && <span className="text-muted"> · {e.counterparty}</span>}
              {e.recurring && <span className="ms-1 rounded-full bg-elevated px-1.5 py-0.5 text-[10px] text-muted">↻ {t('staff.acc.auto')}</span>}
              {e.note && <span className="block truncate text-xs text-muted">{e.note}</span>}
            </span>
            <span className={`shrink-0 font-bold tabular-nums ${e.kind === 'INCOME' ? 'text-accent' : 'text-danger'}`}>{e.kind === 'INCOME' ? '+' : '−'}{money(e.amountCents)}</span>
            <span className="flex w-full flex-wrap gap-3 text-xs sm:w-auto">
              {e.hasReceipt && <a className="text-accent underline" href={`/api/v1/admin/accounting/entries/${e.id}/receipt`} target="_blank" rel="noreferrer">{t('staff.acc.receipt')}</a>}
              <label className="cursor-pointer text-muted hover:text-ink">{e.hasReceipt ? t('staff.acc.replace') : t('staff.acc.attach')}
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void attach(e, f); ev.target.value = ''; }} />
              </label>
              <button type="button" className="text-muted hover:text-ink" onClick={() => startEdit(e)}>{t('staff.acc.edit')}</button>
              <button type="button" className="text-danger" onClick={() => void remove(e)}>{t('staff.acc.del')}</button>
            </span>
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-2">
        <h2 className="text-lg font-semibold">{t('staff.acc.recurring')}</h2>
        <button type="button" className="btn-ghost ms-auto !min-h-[38px] !py-1.5 text-sm" onClick={() => startNew('EXPENSE', true)} data-testid="acc-add-recurring">{t('staff.acc.addRecurring')}</button>
      </div>
      <div className="mt-2 space-y-2" data-testid="acc-recurring">
        {v.recurring.length === 0 && <div className="text-sm text-muted">{t('staff.acc.recurringNone')}</div>}
        {v.recurring.map((r) => (
          <div key={r.id} className="card flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
            <span className="min-w-0 flex-1"><span className="font-medium">{cat(r.category)}</span>{r.counterparty && <span className="text-muted"> · {r.counterparty}</span>}
              <span className="block text-xs text-muted">↻ {t(`staff.acc.every.${r.every}`)} · {t('staff.acc.nextOn', { date: fmt.date(`${r.nextDay}T12:00:00Z`) })}</span></span>
            <span className={`shrink-0 font-bold tabular-nums ${r.kind === 'INCOME' ? 'text-accent' : 'text-danger'}`}>{r.kind === 'INCOME' ? '+' : '−'}{money(r.amountCents)}</span>
            <button type="button" className="text-xs text-danger" onClick={() => void stop(r)}>{t('staff.acc.stop')}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
