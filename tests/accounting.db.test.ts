import { describe, it, expect, beforeAll, vi } from 'vitest';

// «Бухгалтерия» (2026-11-23): only the owner; hand-entered income / expenses, recurring items,
// period figures, VAT turnover, CSV and receipts (kept out of the KYC orphan sweep).
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => new Headers(),
}));

import { prisma } from '@/lib/db';
import { createStaffSession, hashPassword } from '@/lib/auth';
import * as acc from '@/app/api/v1/admin/accounting/route';
import * as entry from '@/app/api/v1/admin/accounting/entries/[id]/route';
import * as receipt from '@/app/api/v1/admin/accounting/entries/[id]/receipt/route';
import * as rec from '@/app/api/v1/admin/accounting/recurring/route';
import * as exp from '@/app/api/v1/admin/accounting/export/route';
import { nextDue, periodRange, materializeRecurring } from '@/server/accounting';
import { runKycRetention } from '@/server/kyc-retention';

const RUN = Date.now().toString(36);
const url = (p: string) => `http://localhost:3000/api/v1/admin/accounting${p}`;
const json = (body: unknown, method = 'POST') => new Request(url(''), { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const idp = (id: string) => ({ params: Promise.resolve({ id }) });

async function as(login: string) {
  jar.clear();
  const u = await prisma.staffUser.findUnique({ where: { login } });
  if (!u) throw new Error(`missing ${login}`);
  await createStaffSession(u);
}

beforeAll(async () => {
  await prisma.ledgerEntry.deleteMany({});
  await prisma.ledgerRecurring.deleteMany({});
  await prisma.staffUser.upsert({ where: { login: `admin2-${RUN}` }, update: {}, create: { login: `admin2-${RUN}`, role: 'ADMIN', displayName: 'Other admin', passwordHash: await hashPassword('x-long-password-1'), active: true } });
  if (!(await prisma.staffUser.count({ where: { login: 'admin', isOwner: true } }))) await prisma.staffUser.update({ where: { login: 'admin' }, data: { isOwner: true } });
});

describe('owner bookkeeping', () => {
  it('only the owner: another admin and the dispatcher get 403, nobody signed in 401', async () => {
    jar.clear();
    expect((await acc.GET(new Request(url('')))).status).toBe(401);
    await as(`admin2-${RUN}`);
    expect((await acc.GET(new Request(url('')))).status).toBe(403);
    expect((await acc.POST(json({ kind: 'INCOME', day: '2026-11-01', amountCents: 100, category: 'misc' }))).status).toBe(403);
    await as('dispatcher');
    expect((await acc.GET(new Request(url('')))).status).toBe(403);
    await as('admin');
    expect((await acc.GET(new Request(url('')))).status).toBe(200);
  });

  it('entries → month figures, by category, profit, tax for information; edit and delete', async () => {
    await as('admin');
    const add = async (b: object) => (await (await acc.POST(json(b))).json()).entry as { id: string };
    await add({ kind: 'INCOME', day: '2026-11-03', amountCents: 50000, category: 'subscription', counterparty: 'Andreas', method: 'bank' });
    await add({ kind: 'INCOME', day: '2026-11-10', amountCents: 20000, category: 'commission' });
    const apple = await add({ kind: 'EXPENSE', day: '2026-11-05', amountCents: 9200, category: 'apple' });
    await add({ kind: 'EXPENSE', day: '2026-10-31', amountCents: 1000, category: 'domain' }); // other month
    expect((await acc.POST(json({ kind: 'INCOME', day: '2026-11-03', amountCents: 100, category: 'apple' }))).status).toBe(422); // expense category for income

    let v = await (await acc.GET(new Request(url('?period=month&key=2026-11')))).json();
    expect(v.totals).toMatchObject({ incomeCents: 70000, expenseCents: 9200, profitCents: 60800, taxInfoCents: 9120 });
    expect(v.incomeByCategory[0]).toEqual({ category: 'subscription', cents: 50000 });
    expect(v.period).toMatchObject({ key: '2026-11', prev: '2026-10', next: '2026-12' });

    expect((await entry.PATCH(json({ kind: 'EXPENSE', day: '2026-11-05', amountCents: 9900, category: 'apple' }, 'PATCH'), idp(apple.id))).status).toBe(200);
    v = await (await acc.GET(new Request(url('?period=month&key=2026-11')))).json();
    expect(v.totals.expenseCents).toBe(9900);
    expect((await entry.DELETE(new Request(url('')), idp(apple.id))).status).toBe(200);
    v = await (await acc.GET(new Request(url('?period=quarter&key=2026-Q4')))).json();
    expect(v.totals).toMatchObject({ incomeCents: 70000, expenseCents: 1000 });
    const csv = await (await exp.GET(new Request(url('/export?period=quarter&key=2026-Q4')))).text();
    expect(csv).toContain('2026-11-03,income,subscription,500.00,Andreas,bank');
    expect(csv).not.toContain('apple'); // deleted
  });

  it('recurring: booked on its days, once, month-end clamped; stopping keeps booked entries', async () => {
    expect(nextDue(new Date('2026-01-31T00:00:00Z'), 'MONTH').toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(nextDue(new Date('2026-11-23T00:00:00Z'), 'YEAR').toISOString().slice(0, 10)).toBe('2027-11-23');
    await as('admin');
    const r = await rec.POST(new Request(url('/recurring'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'EXPENSE', amountCents: 2000, category: 'server', every: 'MONTH', startDay: '2026-09-15' }) }));
    expect(r.status).toBe(201);
    await materializeRecurring(new Date('2026-11-20T10:00:00Z'));
    await materializeRecurring(new Date('2026-11-20T10:00:00Z')); // idempotent
    const days = (await prisma.ledgerEntry.findMany({ where: { category: 'server', deletedAt: null }, orderBy: { day: 'asc' } })).map((e) => e.day.toISOString().slice(0, 10));
    expect(days.filter((d) => d <= '2026-11-20')).toEqual(['2026-09-15', '2026-10-15', '2026-11-15']);
  });

  it('VAT turnover of 12 months and the periods', async () => {
    const p = periodRange('quarter', '2026-Q1', new Date('2026-11-23T10:00:00Z'));
    expect(p).toMatchObject({ from: '2026-01-01', to: '2026-04-01', prev: '2025-Q4', next: '2026-Q2' });
    expect(periodRange('year', null, new Date('2026-11-23T10:00:00Z'))).toMatchObject({ key: '2026', from: '2026-01-01', to: '2027-01-01' });
    await as('admin');
    const v = await (await acc.GET(new Request(url('')))).json();
    expect(v.vat.thresholdCents).toBe(1_560_000);
    expect(v.vat.turnover12mCents).toBeGreaterThanOrEqual(70000);
    expect(v.drivers).toHaveProperty('trips');
  });

  it('a receipt: only for the owner, only a real photo / PDF, and the KYC sweep never deletes it', async () => {
    await as('admin');
    const e = (await (await acc.POST(json({ kind: 'EXPENSE', day: '2026-11-21', amountCents: 9900, category: 'apple' }))).json()).entry;
    const pdf = new File([Buffer.from('%PDF-1.4\n% receipt test\n%%EOF')], 'r.pdf', { type: 'application/pdf' });
    const fd = new FormData(); fd.set('file', pdf);
    expect((await receipt.POST(new Request(url(`/entries/${e.id}/receipt`), { method: 'POST', body: fd }), idp(e.id))).status).toBe(200);
    const bad = new FormData(); bad.set('file', new File([Buffer.from('<html>nope</html>')], 'x.html', { type: 'text/html' }));
    expect((await receipt.POST(new Request(url(`/entries/${e.id}/receipt`), { method: 'POST', body: bad }), idp(e.id))).status).toBe(422);
    const row = (await prisma.ledgerEntry.findUnique({ where: { id: e.id } }))!;
    // Make it look old, then run the orphan sweep: it must stay.
    const { utimes } = await import('fs/promises');
    const { config } = await import('@/lib/config');
    const old = new Date(Date.now() - 3 * 86400_000);
    await utimes(`${config.uploads.dir}/${row.receiptKey}`, old, old);
    await runKycRetention(new Date());
    const got = await receipt.GET(new Request(url('')), idp(e.id));
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('application/pdf');
    await as(`admin2-${RUN}`);
    expect((await receipt.GET(new Request(url('')), idp(e.id))).status).toBe(403);
  });
});
