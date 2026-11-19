'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { applyTheme } from '@/lib/theme';

// Keeps <html data-theme> right after client navigation (passenger ↔ driver pages have separate
// preferences) and when the system switches light/dark while «как в системе» is selected.
export function ThemeSync() {
  const path = usePathname();
  useEffect(() => { applyTheme(); }, [path]);
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try { mq = matchMedia('(prefers-color-scheme: light)'); } catch { return; }
    const on = () => applyTheme();
    mq.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
  }, []);
  return null;
}
