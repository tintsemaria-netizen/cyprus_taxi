'use client';

import { useT } from '@/i18n/I18nProvider';

// Ride-share «Попутчик» at booking (Task 022): shown only for airport / intercity routes. The
// passenger says how many adults, children and suitcases (so a co-rider can be matched to the free
// seats and boot) and how much longer the ride may take for them.
export interface ShareOpts { on: boolean; adults: number; children: number; bags: number; maxExtra: number; wait: number; early?: number }
// «Насколько вы гибки?» (2026-11-21, operator, variant A): three choices instead of separate detour
// and time controls. Each sets the detour limit and, for a pre-booking, how much earlier / later the
// car may come. The matching uses exactly these numbers.
export const SHARE_FLEX = [
  { key: 'exact', maxExtra: 10, early: 0, wait: 0 },
  { key: 'some', maxExtra: 15, early: 15, wait: 15 },
  { key: 'very', maxExtra: 30, early: 45, wait: 45 },
] as const;
export const SHARE_FLEX_DEFAULT = SHARE_FLEX[1];

// `disabled` (2026-11-20): the pre-booking window shows the switch even before / off a ride-share route —
// greyed, with the list of places where it works.
// `arrive` (2026-11-22, operator): in a pre-booking the «Быть на месте с … до …» window replaces the flexibility choice.
export function ShareBookingOptions({ value, onChange, pct, maxPeople, prebook, disabled, arrive }: { value: ShareOpts; onChange: (v: ShareOpts) => void; pct: number; maxPeople: number; prebook?: boolean; disabled?: boolean; arrive?: React.ReactNode }) {
  const { t } = useT();
  const set = (p: Partial<ShareOpts>) => onChange({ ...value, ...p });
  const people = value.adults + value.children;
  const on = value.on && !disabled;
  return (
    <div className={`mt-4 rounded-[14px] border px-3 py-3 transition ${on ? 'border-accent bg-accent/10' : 'border-edge bg-elevated'} ${disabled ? 'opacity-60' : ''}`} data-testid="share-options">
      <label className={`flex items-center gap-3 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
        <span className="min-w-0 flex-1">
          {/* 2026-11-22 (operator): the discount must be noticed — a lime badge + a highlighted note. */}
          <span className="flex items-center gap-2 font-semibold">
            {t('share.booking.name')}
            <span className="rounded-full bg-accent px-2 py-0.5 text-sm font-bold text-black">−{pct}%</span>
          </span>
          {disabled && <span className="block text-xs text-muted">{t('share.booking.routes')}</span>}
        </span>
        <input type="checkbox" role="switch" aria-checked={on} checked={on} disabled={disabled} onChange={(e) => set({ on: e.target.checked })}
          className="peer sr-only" />
        <span aria-hidden className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-accent' : 'bg-edge-strong'}`}>
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'start-[22px]' : 'start-0.5'}`} />
        </span>
      </label>
      {!disabled && (
        <p className="mt-2 flex items-start gap-2 rounded-[10px] border border-accent/50 bg-accent/15 px-3 py-2 text-[13px] font-medium leading-snug text-ink" data-testid="share-hint">
          <span aria-hidden>💰</span><span>{t('share.booking.hint', { pct })}</span>
        </p>
      )}
      {on && (
        <div className="mt-3 space-y-2 border-t border-edge pt-3">
          <Stepper label={t('share.booking.adults')} n={value.adults} min={1} max={maxPeople - value.children} onChange={(adults) => set({ adults })} />
          <Stepper label={t('share.booking.children')} n={value.children} min={0} max={Math.max(0, maxPeople - value.adults)} onChange={(children) => set({ children })} />
          <Stepper label={t('share.booking.luggage')} n={value.bags} min={0} max={6} onChange={(bags) => set({ bags })} />
          {arrive ? <div className="pt-1" data-testid="share-arrive"><p className="label mb-1">{t('share.booking.arriveTitle')}</p>{arrive}</div> : <>
          <p className="label pt-1">{t(prebook ? 'share.booking.flex' : 'share.booking.maxExtra')}</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t(prebook ? 'share.booking.flex' : 'share.booking.maxExtra')} data-testid="share-flex">
            {SHARE_FLEX.map((f) => {
              const sel = value.maxExtra === f.maxExtra && (!prebook || ((value.early ?? 0) === f.early && value.wait === f.wait));
              return (
                <button key={f.key} type="button" role="radio" aria-checked={sel} onClick={() => set({ maxExtra: f.maxExtra, early: f.early, wait: f.wait })}
                  className={`rounded-[10px] border px-1 py-2 text-center ${sel ? 'border-accent bg-accent text-black' : 'border-edge bg-page text-ink'}`}>
                  <span className="block text-sm font-semibold">{t(`share.booking.flex_${f.key}`)}</span>
                  <span className={`block text-[11px] leading-tight ${sel ? 'text-black/70' : 'text-muted'}`}>
                    {prebook && f.wait ? t('share.booking.flexTime', { n: f.wait }) : prebook ? t('share.booking.flexOnTime') : null}
                    {prebook && <br />}
                    {t('share.booking.flexDetour', { n: f.maxExtra })}
                  </span>
                </button>
              );
            })}
          </div>
          </>}
          {people > maxPeople && <p className="text-xs text-danger">{people}/{maxPeople}</p>}
        </div>
      )}
    </div>
  );
}

function Stepper({ label, n, min, max, onChange }: { label: string; n: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 text-sm">{label}</span>
      <button type="button" aria-label={`${label} −`} disabled={n <= min} onClick={() => onChange(n - 1)}
        className="h-9 w-9 rounded-full border border-edge bg-page text-lg leading-none disabled:opacity-30">−</button>
      <span className="w-6 text-center font-semibold tabular-nums">{n}</span>
      <button type="button" aria-label={`${label} +`} disabled={n >= max} onClick={() => onChange(n + 1)}
        className="h-9 w-9 rounded-full border border-edge bg-page text-lg leading-none disabled:opacity-30">+</button>
    </div>
  );
}
