'use client';

import { useT } from '@/i18n/I18nProvider';

// Ride-share «Попутчик» at booking (Task 022): shown only for airport / intercity routes. The
// passenger says how many adults, children and suitcases (so a co-rider can be matched to the free
// seats and boot) and how much longer the ride may take for them.
export interface ShareOpts { on: boolean; adults: number; children: number; bags: number; maxExtra: number; wait: number }
export const SHARE_EXTRA_CHOICES = [10, 15, 20, 30];
// Pre-booking: how long the passenger can wait for the co-rider (e.g. sit at the airport a bit).
export const SHARE_WAIT_CHOICES = [0, 15, 30, 60];

// `disabled` (2026-11-20): the pre-booking window shows the switch even before / off a ride-share route —
// greyed, with the list of places where it works.
export function ShareBookingOptions({ value, onChange, pct, maxPeople, prebook, disabled }: { value: ShareOpts; onChange: (v: ShareOpts) => void; pct: number; maxPeople: number; prebook?: boolean; disabled?: boolean }) {
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
          {prebook && (
            <>
              <p className="label pt-1">{t('share.booking.wait')}</p>
              <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={t('share.booking.wait')}>
                {SHARE_WAIT_CHOICES.map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={value.wait === m} onClick={() => set({ wait: m })}
                    className={`rounded-[10px] border py-2 text-sm font-semibold tabular-nums ${value.wait === m ? 'border-accent bg-accent text-black' : 'border-edge bg-page text-ink'}`}>
                    {m === 0 ? t('share.booking.noWait') : t('share.booking.waitMin', { n: m })}
                  </button>
                ))}
              </div>
            </>
          )}
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
