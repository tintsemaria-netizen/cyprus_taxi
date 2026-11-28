'use client';

// Monthly statement (2026-11-28, operator: «выписка за месяц для налоговой»). ONE tool for the driver, the admin's
// and the fleet owner's driver card: the server function reportMonthly, this screen. «Сохранить PDF» uses the
// phone's / browser's print → «Save as PDF», so every language and script (Greek, Hebrew, Arabic) comes out right.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useT, useLocale } from '@/i18n/I18nProvider';
import { BackArrow } from '@/components/BackArrow';

interface CurrencyEarnings { currency: string; completedTrips: number; recordedEarningsCents: number; pendingFinalTrips: number; cashCents: number; cardCents: number }
interface Statement {
  month: string; from: string; to: string; generatedAt: string;
  driver: { name: string; phone: string; vehicle: string | null } | null;
  summary: { byCurrency: CurrencyEarnings[]; completedTrips: number; pendingFinalTrips: number; onlineSeconds: number };
  daily: { day: string; recordedEarningsCents: number; completedTrips: number; currency: string }[];
  km: number; notDone: number;
}

const INTL: Record<string, string> = { en: 'en-GB', ru: 'ru-RU', de: 'de-DE', el: 'el-GR', fr: 'fr-FR', he: 'he-IL', pl: 'pl-PL', ar: 'ar' };

function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 15));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function MonthlyStatement({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useT();
  const locale = useLocale();
  const tag = INTL[locale] ?? 'en-GB';
  const thisMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Nicosia', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [s, setS] = useState<Statement | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    setS(null); setErr(false);
    api<Statement>(`${path}?month=${month}`).then(setS).catch(() => setErr(true));
  }, [path, month]);
  const money = (c: number, cur: string) => new Intl.NumberFormat(tag, { style: 'currency', currency: cur }).format(c / 100);
  const monthName = (m: string) => { const x = new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`)); return x.charAt(0).toLocaleUpperCase(tag) + x.slice(1); };
  const dayName = (d: string) => new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
  const hours = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`;
  const row = (label: string, value: string, strong = false) => (
    <div className="flex justify-between gap-4 border-b border-black/10 py-1.5 text-[13px]"><span className="text-black/60">{label}</span><span className={strong ? 'font-bold' : 'font-medium'}>{value}</span></div>
  );
  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-page" data-testid="monthly-statement">
      <style>{`@media print { body * { visibility: hidden !important; } #ily-statement, #ily-statement * { visibility: visible !important; } #ily-statement { position: absolute; inset: 0 auto auto 0; width: 100%; margin: 0; box-shadow: none; border-radius: 0; } .ily-no-print { display: none !important; } @page { size: A4; margin: 14mm; } }`}</style>
      <div className="ily-no-print mx-auto flex max-w-lg items-center gap-1 px-3 pt-3">
        <BackArrow onBack={onClose} className="-ms-1" />
        <h2 className="text-lg font-bold">{t('driver.statement.title')}</h2>
      </div>
      <div className="ily-no-print mx-auto flex max-w-lg items-center justify-between gap-2 px-4 py-2">
        <button type="button" className="rounded-full border border-edge px-3 py-1.5 text-sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="‹" data-testid="statement-prev">‹</button>
        <span className="text-sm font-semibold">{monthName(month)}</span>
        <button type="button" className="rounded-full border border-edge px-3 py-1.5 text-sm disabled:opacity-30" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="›" data-testid="statement-next">›</button>
      </div>
      <div className="mx-auto max-w-lg px-3 pb-28">
        {err && <p className="ily-no-print p-4 text-sm text-danger">{t('driver.detail.loadFailed')}</p>}
        {!s && !err && <p className="ily-no-print p-4 text-sm text-muted">…</p>}
        {s && (
          <div id="ily-statement" className="rounded-[14px] bg-white p-5 text-black shadow-lg" data-testid="statement-paper">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold tracking-[0.2em] text-black/50">IL-Y</div>
                <div className="text-lg font-bold">{t('driver.statement.title')}</div>
                <div className="text-sm">{monthName(s.month)}</div>
              </div>
              <div className="text-end text-[11px] text-black/50">{t('driver.statement.generated')}<br />{new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Nicosia' }).format(new Date(s.generatedAt))}</div>
            </div>
            {s.driver && (
              <div className="mt-3 rounded-[10px] bg-black/[0.04] p-3 text-[13px]">
                <div className="font-semibold">{s.driver.name}</div>
                <div dir="ltr" className="text-black/70">{s.driver.phone}</div>
                {s.driver.vehicle && <div className="text-black/70">{s.driver.vehicle}</div>}
              </div>
            )}
            <div className="mt-4 text-[12px] font-bold uppercase tracking-wide text-black/50">{t('driver.statement.totals')}</div>
            {s.summary.byCurrency.length === 0 && row(t('driver.statement.earned'), money(0, 'EUR'), true)}
            {s.summary.byCurrency.map((c) => (
              <div key={c.currency}>
                {row(t('driver.statement.earned'), money(c.recordedEarningsCents, c.currency), true)}
                {row(t('driver.statement.cash'), money(c.cashCents, c.currency))}
                {row(t('driver.statement.card'), money(c.cardCents, c.currency))}
              </div>
            ))}
            {row(t('driver.statement.done'), String(s.summary.completedTrips))}
            {s.summary.pendingFinalTrips > 0 && row(t('driver.statement.pending'), String(s.summary.pendingFinalTrips))}
            {row(t('driver.statement.notDone'), String(s.notDone))}
            {row(t('driver.statement.online'), hours(s.summary.onlineSeconds))}
            {row(t('driver.statement.km'), `${s.km.toLocaleString(tag)} km`)}
            <div className="mt-4 text-[12px] font-bold uppercase tracking-wide text-black/50">{t('driver.statement.byDay')}</div>
            {s.daily.filter((d) => d.completedTrips > 0).length === 0 ? <p className="py-2 text-[13px] text-black/60">{t('driver.statement.noTrips')}</p> : (
              <table className="mt-1 w-full text-[13px]">
                <thead><tr className="text-start text-[11px] text-black/50"><th className="py-1 text-start font-medium">{t('driver.statement.day')}</th><th className="py-1 text-end font-medium">{t('driver.statement.trips')}</th><th className="py-1 text-end font-medium">{t('driver.statement.amount')}</th></tr></thead>
                <tbody>{s.daily.filter((d) => d.completedTrips > 0).map((d) => (
                  <tr key={d.day + d.currency} className="border-t border-black/10"><td className="py-1">{dayName(d.day)}</td><td className="py-1 text-end tabular-nums">{d.completedTrips}</td><td className="py-1 text-end tabular-nums">{money(d.recordedEarningsCents, d.currency)}</td></tr>
                ))}</tbody>
              </table>
            )}
            <p className="mt-4 text-[11px] leading-snug text-black/50">{t('driver.statement.note')}</p>
          </div>
        )}
      </div>
      {s && (
        <div className="ily-no-print fixed inset-x-0 bottom-0 bg-page/95 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto max-w-lg">
            <button type="button" className="btn-primary w-full" onClick={() => window.print()} data-testid="statement-print">{t('driver.statement.save')}</button>
            <p className="mt-1 text-center text-[11px] text-muted">{t('driver.statement.saveHint')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
