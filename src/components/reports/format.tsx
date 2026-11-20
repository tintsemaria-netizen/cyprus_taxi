'use client';

import { useT } from '@/i18n/I18nProvider';

// Shared number formats for the driver reports (driver, admin, fleet owner) — 2026-11-20.
export function useReportFmt() {
  const { t, fmt } = useT();
  const money = (cents: number | null, currency = 'EUR') => {
    if (cents == null) return '—';
    try { return fmt.money(cents, currency); } catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
  };
  const dur = (s: number) => (s < 60 ? t('driver.units.sec', { n: s }) : s < 3600 ? t('driver.units.min', { n: Math.round(s / 60) }) : t('driver.units.hourMin', { h: Math.floor(s / 3600), m: Math.round((s % 3600) / 60) }));
  const km = (n: number) => t('rides.detail.km', { km: n.toLocaleString(undefined, { maximumFractionDigits: 1 }) });
  return { money, dur, km };
}

export function Figure({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="rounded-[12px] border border-edge bg-elevated p-3 text-center"><div className="truncate text-lg font-semibold">{value}</div><div className="text-xs text-muted">{label}</div><div className="text-xs text-muted">{sub}</div></div>;
}
