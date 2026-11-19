'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { getThemePref, setThemePref, type ThemePref, type ThemeRole } from '@/lib/theme';

// App colour picker (2026-11-19). Passengers: «как в системе» / светлый / тёмный.
// Drivers: светлый / тёмный (shown at registration and in the driver menu).
export function ThemePicker({ role, className = '' }: { role: ThemeRole; className?: string }) {
  const { t } = useT();
  const [pref, setPref] = useState<ThemePref | null>(null);
  useEffect(() => { setPref(getThemePref(role)); }, [role]);
  const opts: ThemePref[] = role === 'passenger' ? ['system', 'light', 'dark'] : ['light', 'dark'];
  return (
    <div role="radiogroup" aria-label={t('common.theme.title')} className={`flex gap-2 ${className}`} data-testid="theme-picker">
      {opts.map((o) => {
        const on = pref === o;
        return (
          <button key={o} type="button" role="radio" aria-checked={on} data-testid={`theme-${o}`}
            onClick={() => { setThemePref(role, o); setPref(o); }}
            className={`flex flex-1 flex-col items-center gap-1.5 rounded-[12px] border px-2 py-2 text-xs font-medium transition ${on ? 'border-accent bg-accent/15 text-ink' : 'border-edge bg-elevated text-muted'}`}>
            <Swatch kind={o} />
            {t(`common.theme.${o}`)}
          </button>
        );
      })}
    </div>
  );
}

function Swatch({ kind }: { kind: ThemePref }) {
  const box = (bg: string, bar: string) => (
    <span className="flex h-full flex-1 flex-col justify-end gap-[3px] p-[4px]" style={{ background: bg }}>
      <span className="h-[4px] w-3/4 rounded-full" style={{ background: bar }} />
      <span className="h-[5px] w-full rounded-full" style={{ background: '#C8FF46' }} />
    </span>
  );
  return (
    <span className="flex h-9 w-14 overflow-hidden rounded-[8px] border border-edge" aria-hidden>
      {kind !== 'dark' && box('#F4F6F5', '#C9D3CF')}
      {kind !== 'light' && box('#10191C', '#33424A')}
    </span>
  );
}
