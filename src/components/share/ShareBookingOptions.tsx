'use client';

import { useT } from '@/i18n/I18nProvider';

// Ride-share «Попутчик» at booking (Task 022): shown only for airport / intercity routes. The
// passenger says how many adults, children and suitcases (so a co-rider can be matched to the free
// seats and boot) and how much longer the ride may take for them.
export interface ShareOpts { on: boolean; adults: number; children: number; bags: number; maxExtra: number; wait: number; early?: number }
export const SHARE_EXTRA_CHOICES = [10, 15, 20, 30];
// Pre-booking (2026-11-21, operator): ONE line with 0 in the middle — drag right = can leave later
// (wait for the co-rider), drag left = can leave earlier. Up to 60 min each way, 5-min steps.
export const SHARE_SHIFT_MAX = 60;

// `disabled` (2026-11-20): the pre-booking window shows the switch even before / off a ride-share route —
// greyed, with the list of places where it works.
export function ShareBookingOptions({ value, onChange, pct, maxPeople, prebook, disabled, baseHm }: { value: ShareOpts; onChange: (v: ShareOpts) => void; pct: number; maxPeople: number; prebook?: boolean; disabled?: boolean; baseHm?: string }) {
  const { t } = useT();
  const set = (p: Partial<ShareOpts>) => onChange({ ...value, ...p });
  const people = value.adults + value.children;
  const on = value.on && !disabled;
  return (
    <div className={`mt-4 rounded-[14px] border px-3 py-3 transition ${on ? 'border-accent bg-accent/10' : 'border-edge bg-elevated'} ${disabled ? 'opacity-60' : ''}`} data-testid="share-options">
      <label className={`flex items-center gap-3 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{t('share.booking.title', { pct })}</span>
          <span className="block text-xs text-muted">{disabled ? t('share.booking.routes') : t('share.booking.hint', { pct })}</span>
        </span>
        <input type="checkbox" role="switch" aria-checked={on} checked={on} disabled={disabled} onChange={(e) => set({ on: e.target.checked })}
          className="peer sr-only" />
        <span aria-hidden className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-accent' : 'bg-edge-strong'}`}>
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'start-[22px]' : 'start-0.5'}`} />
        </span>
      </label>
      {on && (
        <div className="mt-3 space-y-2 border-t border-edge pt-3">
          <Stepper label={t('share.booking.adults')} n={value.adults} min={1} max={maxPeople - value.children} onChange={(adults) => set({ adults })} />
          <Stepper label={t('share.booking.children')} n={value.children} min={0} max={Math.max(0, maxPeople - value.adults)} onChange={(children) => set({ children })} />
          <Stepper label={t('share.booking.luggage')} n={value.bags} min={0} max={6} onChange={(bags) => set({ bags })} />
          <p className="label pt-1">{t('share.booking.maxExtra')}</p>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={t('share.booking.maxExtra')}>
            {SHARE_EXTRA_CHOICES.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={value.maxExtra === m} onClick={() => set({ maxExtra: m })}
                className={`rounded-[10px] border py-2 text-sm font-semibold tabular-nums ${value.maxExtra === m ? 'border-accent bg-accent text-black' : 'border-edge bg-page text-ink'}`}>
                {t('share.booking.minutes', { n: m })}
              </button>
            ))}
          </div>
          {prebook && <ShiftLine early={value.early ?? 0} later={value.wait} baseHm={baseHm} onChange={(early, wait) => set({ early, wait })} />}
          {people > maxPeople && <p className="text-xs text-danger">{people}/{maxPeople}</p>}
        </div>
      )}
    </div>
  );
}

// One track, 0 in the middle: the left knob moves «earlier», the right knob «later».
function ShiftLine({ early, later, baseHm, onChange }: { early: number; later: number; baseHm?: string; onChange: (early: number, later: number) => void }) {
  const { t } = useT();
  const M = SHARE_SHIFT_MAX;
  const hm = (delta: number) => {
    const m = /^(\d{2}):(\d{2})$/.exec(baseHm || '');
    if (!m) return null;
    const x = (((+m[1] * 60 + +m[2] + delta) % 1440) + 1440) % 1440;
    return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  };
  const from = hm(-early), to = hm(later);
  // Knob centres: each half is its own range input (thumb 26 px), so the fill runs centre to centre.
  const leftAt = `calc((50% - 26px) * ${(M - early) / M} + 13px)`;
  const rightAt = `calc(50% + 13px + (50% - 26px) * ${later / M})`;
  return (
    <div className="pt-1" data-testid="share-shift">
      <p className="label">{t('share.booking.shift')}</p>
      <div className="relative mt-2 h-9">
        <div className="absolute inset-x-[13px] top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-edge" />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent" style={{ left: leftAt, width: `calc(${rightAt} - ${leftAt})` }} />
        <div className="absolute left-1/2 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-ink/60" />
        <div className="absolute inset-0 flex">
          <input type="range" className="ily-half" min={-M} max={0} step={5} value={-early} aria-label={t('share.booking.earlier')}
            onChange={(e) => onChange(-Number(e.target.value), later)} />
          <input type="range" className="ily-half" min={0} max={M} step={5} value={later} aria-label={t('share.booking.later')}
            onChange={(e) => onChange(early, Number(e.target.value))} />
        </div>
      </div>
      <div className="mt-1 flex justify-between text-xs tabular-nums text-muted">
        <span className={early ? 'text-ink' : ''}>{early ? t('share.booking.earlierBy', { n: early }) : t('share.booking.earlier')}</span>
        <span>0</span>
        <span className={later ? 'text-ink' : ''}>{later ? t('share.booking.laterBy', { n: later }) : t('share.booking.later')}</span>
      </div>
      <p className="mt-1 text-center text-sm font-semibold tabular-nums">
        {!early && !later ? t('share.booking.exact') : from && to ? t('share.booking.window', { from, to }) : t('share.booking.windowMin', { e: early, l: later })}
      </p>
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
