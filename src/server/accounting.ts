import { prisma } from '@/lib/db';
import type { LedgerEntry, LedgerEvery, LedgerKind, LedgerRecurring } from '@prisma/client';
import { requireStaff, isStaffCtx, type StaffContext } from '@/lib/auth';
import { nicosiaDayKey } from '@/lib/timezone';
import { earningsSummary } from '@/server/driver/earnings';
import { csvCell } from '@/server/reports/driver-report';
import { z } from 'zod';

// Owner's bookkeeping (2026-11-23, operator: «бухгалтерия для меня, только я, только евро»).
// Hand-entered income and expenses (driver subscriptions / commission join automatically once they
// exist), recurring items, receipts, and figures for a month / quarter / year. Only the owner.

export const INCOME_CATEGORIES = ['subscription', 'commission', 'misc'] as const;
export const EXPENSE_CATEGORIES = ['apple', 'google', 'server', 'domain', 'sms', 'accountant', 'advertising', 'misc'] as const;
export const METHODS = ['bank', 'card', 'cash', 'misc'] as const;
/** Cyprus corporate tax from 1 Jan 2026 — shown «for information» only. */
export const TAX_RATE = 0.15;
/** Cyprus VAT registration threshold (turnover of the last 12 months). */
export const VAT_THRESHOLD_CENTS = 15_600_00;

/** The owner only: an active ADMIN with isOwner. */
export async function requireOwner(): Promise<StaffContext | { error: 401 | 403 }> {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx;
  return ctx.user.isOwner ? ctx : { error: 403 };
}

const dayRe = /^\d{4}-\d{2}-\d{2}$/;
const toDay = (k: string) => new Date(`${k}T00:00:00.000Z`);
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export const entrySchema = z.object({
  kind: z.enum(['INCOME', 'EXPENSE']),
  day: z.string().regex(dayRe),
  amountCents: z.number().int().min(1).max(100_000_000),
  category: z.string().min(1).max(40),
  counterparty: z.string().trim().max(120).optional().nullable(),
  method: z.enum(METHODS).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
}).refine((v) => (v.kind === 'INCOME' ? (INCOME_CATEGORIES as readonly string[]) : (EXPENSE_CATEGORIES as readonly string[])).includes(v.category), { message: 'Unknown category', path: ['category'] });

export const recurringSchema = z.object({
  kind: z.enum(['INCOME', 'EXPENSE']),
  amountCents: z.number().int().min(1).max(100_000_000),
  category: z.string().min(1).max(40),
  counterparty: z.string().trim().max(120).optional().nullable(),
  method: z.enum(METHODS).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  every: z.enum(['MONTH', 'YEAR']),
  startDay: z.string().regex(dayRe),
}).refine((v) => (v.kind === 'INCOME' ? (INCOME_CATEGORIES as readonly string[]) : (EXPENSE_CATEGORIES as readonly string[])).includes(v.category), { message: 'Unknown category', path: ['category'] });

/** Next due day after `d`: +1 month / +1 year, keeping the day of month (clamped to its end). */
export function nextDue(d: Date, every: LedgerEvery): Date {
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const [ny, nm] = every === 'YEAR' ? [y + 1, m] : m === 11 ? [y + 1, 0] : [y, m + 1];
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ny, nm, Math.min(day, last)));
}

/**
 * Book every recurring item that is due up to today (Cyprus date). Idempotent: an entry per
 * (recurring, day) is unique, and nextDay only moves forward with a conditional update.
 */
export async function materializeRecurring(now: Date = new Date()): Promise<number> {
  const today = toDay(nicosiaDayKey(now));
  let made = 0;
  const due = await prisma.ledgerRecurring.findMany({ where: { active: true, nextDay: { lte: today } } });
  for (const r of due) {
    let day = r.nextDay;
    for (let guard = 0; day <= today && guard < 60; guard++) {
      const next = nextDue(day, r.every);
      await prisma.$transaction(async (tx) => {
        const moved = await tx.ledgerRecurring.updateMany({ where: { id: r.id, nextDay: day, active: true }, data: { nextDay: next } });
        if (moved.count !== 1) return; // another request booked it
        await tx.ledgerEntry.create({ data: { kind: r.kind, day, amountCents: r.amountCents, category: r.category, counterparty: r.counterparty, method: r.method, note: r.note, recurringId: r.id, createdById: r.createdById } });
        made++;
      });
      day = next;
    }
  }
  return made;
}

export type PeriodKind = 'month' | 'quarter' | 'year';

/** «2026-11» / «2026-Q4» / «2026» → [from, to) as day keys, plus the key and its neighbours. */
export function periodRange(kind: PeriodKind, key: string | null, now: Date = new Date()) {
  const today = nicosiaDayKey(now);
  const y0 = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7));
  let y = y0, i = kind === 'month' ? m0 : kind === 'quarter' ? Math.ceil(m0 / 3) : 0;
  if (key) {
    const mm = kind === 'month' ? /^(\d{4})-(\d{2})$/.exec(key) : kind === 'quarter' ? /^(\d{4})-Q([1-4])$/.exec(key) : /^(\d{4})$/.exec(key);
    if (mm) { y = Number(mm[1]); if (kind !== 'year') i = Number(mm[2]); }
  }
  const startM = kind === 'month' ? i - 1 : kind === 'quarter' ? (i - 1) * 3 : 0;
  const len = kind === 'month' ? 1 : kind === 'quarter' ? 3 : 12;
  const from = new Date(Date.UTC(y, startM, 1)), to = new Date(Date.UTC(y, startM + len, 1));
  const label = (yy: number, ii: number) => (kind === 'month' ? `${yy}-${String(ii).padStart(2, '0')}` : kind === 'quarter' ? `${yy}-Q${ii}` : `${yy}`);
  const n = kind === 'month' ? 12 : kind === 'quarter' ? 4 : 1;
  const step = (d: number) => { if (kind === 'year') return label(y + d, 0); let yy = y, ii = i + d; while (ii < 1) { ii += n; yy--; } while (ii > n) { ii -= n; yy++; } return label(yy, ii); };
  return { kind, key: label(y, i), prev: step(-1), next: step(1), from: dayKey(from), to: dayKey(to) };
}

export function entryView(e: LedgerEntry) {
  return {
    id: e.id, kind: e.kind, day: dayKey(e.day), amountCents: e.amountCents, category: e.category,
    counterparty: e.counterparty, method: e.method, note: e.note, hasReceipt: !!e.receiptKey, recurring: !!e.recurringId,
  };
}
export function recurringView(r: LedgerRecurring) {
  return { id: r.id, kind: r.kind, amountCents: r.amountCents, category: r.category, counterparty: r.counterparty, method: r.method, note: r.note, every: r.every, nextDay: dayKey(r.nextDay), active: r.active };
}

const sum = (xs: { amountCents: number }[]) => xs.reduce((a, x) => a + x.amountCents, 0);

/**
 * All drivers' earnings for the period — the SAME shared function the driver's / admin's / fleet
 * owner's earnings screens use (reports are one tool, 2026-11-20), summed over every driver.
 */
export async function driversTotal(from: Date, to: Date) {
  const drivers = await prisma.driver.findMany({ select: { id: true } });
  let trips = 0, cash = 0, card = 0, total = 0;
  for (const d of drivers) {
    const s = await earningsSummary(d.id, from, to);
    trips += s.completedTrips;
    for (const c of s.byCurrency) if (c.currency === 'EUR') { cash += c.cashCents; card += c.cardCents; total += c.recordedEarningsCents; }
  }
  return { drivers: drivers.length, trips, cashCents: cash, cardCents: card, totalCents: total };
}

/** The owner's page: figures for the period, the 12-month VAT turnover, entries and recurring items. */
export async function accountingView(kind: PeriodKind, key: string | null, now: Date = new Date()) {
  await materializeRecurring(now);
  const p = periodRange(kind, key, now);
  const entries = await prisma.ledgerEntry.findMany({ where: { deletedAt: null, day: { gte: toDay(p.from), lt: toDay(p.to) } }, orderBy: [{ day: 'desc' }, { createdAt: 'desc' }] });
  const income = entries.filter((e) => e.kind === 'INCOME'), expense = entries.filter((e) => e.kind === 'EXPENSE');
  const byCat = (xs: LedgerEntry[]) => Object.entries(xs.reduce<Record<string, number>>((m, e) => { m[e.category] = (m[e.category] ?? 0) + e.amountCents; return m; }, {}))
    .map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents);
  const profit = sum(income) - sum(expense);
  // VAT: turnover of the 12 months up to today (Cyprus date).
  const today = toDay(nicosiaDayKey(now));
  const yearAgo = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate() + 1));
  const turnover = await prisma.ledgerEntry.aggregate({ _sum: { amountCents: true }, where: { deletedAt: null, kind: 'INCOME', day: { gte: yearAgo, lte: today } } });
  const recurring = await prisma.ledgerRecurring.findMany({ where: { active: true }, orderBy: { nextDay: 'asc' } });
  return {
    period: p,
    totals: { incomeCents: sum(income), expenseCents: sum(expense), profitCents: profit, taxInfoCents: Math.max(0, Math.round(profit * TAX_RATE)), taxRate: TAX_RATE },
    incomeByCategory: byCat(income), expenseByCategory: byCat(expense),
    vat: { turnover12mCents: turnover._sum.amountCents ?? 0, thresholdCents: VAT_THRESHOLD_CENTS },
    drivers: await driversTotal(toDay(p.from), toDay(p.to)),
    entries: entries.map(entryView),
    recurring: recurring.map(recurringView),
  };
}

/** CSV for the accountant: every entry of the period. */
export async function accountingCsv(kind: PeriodKind, key: string | null): Promise<Response> {
  await materializeRecurring();
  const p = periodRange(kind, key);
  const rows = await prisma.ledgerEntry.findMany({ where: { deletedAt: null, day: { gte: toDay(p.from), lt: toDay(p.to) } }, orderBy: [{ day: 'asc' }, { createdAt: 'asc' }] });
  const head = ['date', 'type', 'category', 'amount_eur', 'counterparty', 'method', 'note', 'receipt'];
  const lines = [head.join(',')].concat(rows.map((e) => [dayKey(e.day), e.kind === 'INCOME' ? 'income' : 'expense', e.category, (e.amountCents / 100).toFixed(2), e.counterparty, e.method, e.note, e.receiptKey ? 'yes' : ''].map((v) => csvCell(v ?? '')).join(',')));
  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="il-y-accounting-${p.key}.csv"`, 'Cache-Control': 'no-store' },
  });
}

export function ledgerKindOk(k: string): k is LedgerKind { return k === 'INCOME' || k === 'EXPENSE'; }
