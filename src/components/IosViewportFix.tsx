'use client';

import { useEffect } from 'react';

// iPhone home-screen app (standalone) bug (2026-11-18): after the on-screen keyboard has been open
// once, iOS keeps the app's viewport shorter for the rest of the session — a dark empty band at the
// bottom and the bottom sheet floating above it. Known WebKit issue; re-measuring the layout (hide
// the page for one synchronous reflow and show it again) makes iOS restore the full height.
// Only in the iOS standalone app, only when the height is really stuck and no field is being typed in.
export function IosViewportFix() {
  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (!ios || !standalone) return;
    let peak = window.innerHeight;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const typing = () => { const a = document.activeElement as HTMLElement | null; return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable); };
    const fix = () => {
      if (typing() || peak - window.innerHeight <= 4) return;
      const body = document.body;
      const scrolled = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((el) => el.scrollTop > 0).map((el) => [el, el.scrollTop] as const);
      body.style.display = 'none';
      void body.offsetHeight; // synchronous reflow
      body.style.display = '';
      for (const [el, top] of scrolled) el.scrollTop = top;
    };
    const later = () => { if (timer) clearTimeout(timer); timer = setTimeout(fix, 160); };
    const onResize = () => { if (!typing()) peak = Math.max(peak, window.innerHeight); };
    const onVisible = () => { if (document.visibilityState === 'visible') later(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('focusout', later);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('focusout', later);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return null;
}
