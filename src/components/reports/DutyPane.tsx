'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { api } from '@/lib/api-client';
import { BackArrow } from '@/components/BackArrow';
import { useReportFmt } from './format';

// Shared report tool (2026-11-20): one driver's hours online, on orders and km, plus the week's
// candles. `apiBase` picks whose: '/driver' (himself), '/admin/drivers/<id>/report' (the admin).

// ---- «Время на линии» inside the today card (2026-11-20) ----
export function DutyPane({ onBack, onClose, apiBase = '/driver' }: { onBack: () => void; onClose?: () => void; apiBase?: string }) {
  const { t } = useT();
  const { dur, km } = useReportFmt();
  type Duty = { onlineSec: number; onTripSec: number; km: number; weekSec: number; weekKm: number; week: { day: string; onlineSec: number; km: number }[]; onlineNow: boolean };
  const [d, setD] = useState<Duty | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api<Duty>(`${apiBase}/duty`).then((r) => { if (alive) { setD(r); setErr(false); } }).catch(() => { if (alive) setErr(true); });
    load();
    const id = setInterval(load, 30_000); // an open shift keeps counting
    return () => { alive = false; clearInterval(id); };
  }, [apiBase]);
  return (
    <div data-testid="duty-pane">
      <div className="flex items-center justify-between">
        <BackArrow onBack={onBack} className="-ms-2" />
        <span className="flex-1 text-sm font-semibold text-muted">{t('driver.earnings.onlineTime')}</span>
        {onClose && <button type="button" onClick={onClose} aria-label={t('common.close')} className="-me-1 flex h-8 w-8 items-center justify-center rounded-full text-xl text-muted hover:text-ink">×</button>}
      </div>
      {!d ? <p className="py-4 text-sm text-muted">{err ? t('driver.detail.loadFailed') : t('common.loading')}</p> : (
        <>
          <div className="text-[28px] font-bold leading-tight text-accent">{dur(d.onlineSec)}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-[12px] border border-edge bg-elevated px-3 py-2">
              <div className="text-[11px] text-muted">🚕 {t('driver.home.timeOnTrips')}</div>
              <div className="whitespace-nowrap text-lg font-semibold">{dur(d.onTripSec)}</div>
            </div>
            {/* Km on orders today (2026-11-20, operator): to the client + A → B, by GPS. */}
            <div className="rounded-[12px] border border-edge bg-elevated px-3 py-2" data-testid="duty-km">
              <div className="text-[11px] text-muted">🛣️ {t('driver.home.timeKm')}</div>
              <div className="whitespace-nowrap text-lg font-semibold">{km(d.km)}</div>
            </div>
          </div>
          <WeekCandles week={d.week} dur={dur} km={km} />
          <div className="mt-2 rounded-[12px] border border-edge px-3 py-2 text-sm">
            <div className="text-[12px] text-muted">{t('driver.home.timeWeek')}</div>
            <span className="whitespace-nowrap font-semibold"><span className="text-accent">{dur(d.weekSec)}</span> · <span className="text-danger">{km(d.weekKm)}</span></span>
          </div>
        </>
      )}
    </div>
  );
}

// Monday → Sunday like an exchange candle chart (2026-11-20, operator): per day a lime candle for the
// time online and a red one beside it for the km on orders, each on its own scale. Today is marked.
export function WeekCandles({ week, dur, km }: { week: { day: string; onlineSec: number; km: number }[]; dur: (s: number) => string; km: (n: number) => string }) {
  const { t, locale } = useT();
  const W = 280, H = 132, top = 10, base = 108, gw = W / 7;
  const maxH = Math.max(8 * 3600, ...week.map((d) => d.onlineSec));
  const maxK = Math.max(50, ...week.map((d) => d.km));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Nicosia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  // Tap a day → its hours and km above the chart (2026-11-20, operator); today is picked at first.
  const [sel, setSel] = useState<string>(() => (week.some((d) => d.day === today) ? today : week[0]?.day ?? ''));
  const picked = week.find((d) => d.day === sel) ?? null;
  const dayLabel = (day: string) => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  const wd = (day: string) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  const candle = (x: number, v: number, max: number, color: string, key: string) => {
    const h = v > 0 ? Math.max(3, ((base - top) * v) / max) : 0;
    const y = base - h;
    return (
      <g key={key}>
        {h > 0 && <line x1={x + 4.5} x2={x + 4.5} y1={Math.max(top, y - 5)} y2={base} stroke={color} strokeWidth={1} opacity={0.6} />}
        <rect x={x} y={h > 0 ? y : base - 1} width={9} height={h > 0 ? h : 1} rx={2} fill={color} opacity={h > 0 ? 1 : 0.35} />
      </g>
    );
  };
  return (
    <div className="mt-3 rounded-[12px] border border-edge bg-elevated px-2 pb-1 pt-2" data-testid="duty-candles">
      {picked && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2 px-1" data-testid="candle-picked">
          <span className="truncate text-[12px] font-semibold first-letter:uppercase">{dayLabel(picked.day)}</span>
          <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold"><span className="text-accent">{dur(picked.onlineSec)}</span> · <span className="text-danger">{km(picked.km)}</span></span>
        </div>
      )}
      <div className="flex items-center gap-3 px-1 text-[11px] text-muted">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-accent" />{t('driver.home.chartOnline')}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-danger" />{t('driver.home.chartKm')}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={`${t('driver.home.chartOnline')} / ${t('driver.home.chartKm')}`}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={W} y1={base - (base - top) * f} y2={base - (base - top) * f} stroke="currentColor" opacity={0.08} />)}
        <line x1={0} x2={W} y1={base} y2={base} stroke="currentColor" opacity={0.25} />
        {week.map((d, i) => {
          const x0 = i * gw + gw / 2 - 10.5;
          const isToday = d.day === today;
          return (
            <g key={d.day}>
              {(d.day === sel || isToday) && <rect x={i * gw + 2} y={top - 6} width={gw - 4} height={base - top + 22} rx={6} fill={d.day === sel ? '#C8FF46' : 'currentColor'} opacity={d.day === sel ? 0.14 : 0.06} />}
              {candle(x0, d.onlineSec, maxH, '#C8FF46', 'o')}
              {candle(x0 + 12, d.km, maxK, 'rgb(var(--c-danger))', 'k')}
              <text x={i * gw + gw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="currentColor" opacity={isToday || d.day === sel ? 1 : 0.55} fontWeight={isToday || d.day === sel ? 700 : 400}>{wd(d.day)}</text>
              {/* The whole column is the tap target. */}
              <rect x={i * gw} y={0} width={gw} height={H} fill="transparent" style={{ cursor: 'pointer' }} onClick={() => setSel(d.day)} data-testid={`candle-${d.day}`}>
                <title>{`${wd(d.day)}: ${dur(d.onlineSec)} · ${km(d.km)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

