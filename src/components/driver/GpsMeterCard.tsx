'use client';

import { useT } from '@/i18n/I18nProvider';

// GPS taximeter on the driver's main screen (2026-11-19): fare so far from the trip's GPS track,
// shown like the car's meter so the two can be compared. Not the charged price.
export interface GpsMeterView { totalCents: number; totalKm: number; slowSec: number; gapSec: number; night: boolean }

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function GpsMeterCard({ m }: { m: GpsMeterView }) {
  const { t, fmt, locale } = useT();
  return (
    <div className="pointer-events-none fixed end-3 z-[55] min-w-[132px] rounded-[14px] border border-accent/50 bg-page/90 px-3 py-2 text-end shadow-lg backdrop-blur"
      style={{ top: 'calc(env(safe-area-inset-top) + 150px)' }} data-testid="gps-meter" aria-live="polite">
      <div className="flex items-center justify-end gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        <span>{t('driver.gpsMeter.title')}</span>
        <span className="rounded bg-edge-strong px-1 text-[9px] text-ink">{m.night ? t('driver.gpsMeter.night') : t('driver.gpsMeter.day')}</span>
      </div>
      <div className="font-mono text-[26px] font-bold leading-tight tabular-nums text-accent">{fmt.money(m.totalCents)}</div>
      <div className="text-xs tabular-nums text-ink">{t('driver.gpsMeter.km', { km: m.totalKm.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</div>
      {m.slowSec > 0 && <div className="text-[11px] tabular-nums text-muted">⏱ {t('driver.gpsMeter.slow', { t: mmss(m.slowSec) })}</div>}
      {m.gapSec > 0 && <div className="text-[11px] tabular-nums text-warn">{t('driver.gpsMeter.gap', { t: mmss(m.gapSec) })}</div>}
    </div>
  );
}
