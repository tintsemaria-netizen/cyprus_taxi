'use client';

import { useEffect, useRef } from 'react';

// Installed apps on a phone are RESUMED, not reloaded (2026-11-22, operator): a screen that loaded
// its data once — or polls every minute — kept showing the old state after the phone was in a
// pocket. Call `refresh` when the app comes back to the screen after at least `minAwayMs`, and when
// the browser restores the page from its back/forward cache. Timers alone do not cover this: they
// are frozen in the background and fire late.
export function useRefreshOnReturn(refresh: () => void, minAwayMs = 15_000): void {
  const cb = useRef(refresh);
  cb.current = refresh;
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt >= minAwayMs) cb.current();
      hiddenAt = 0;
    };
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) cb.current(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', onShow);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pageshow', onShow); };
  }, [minAwayMs]);
}
