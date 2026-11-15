'use client';

import { useCallback, useEffect, useState } from 'react';

// Bottom sheet over a map (2026-11-15): drag the WHOLE panel, not only the handle — same feel as
// the passenger booking sheet. Collapsed: any vertical swipe on the panel moves it. Open: a
// downward pull while the scrollable body is at its top collapses it; otherwise the body scrolls.
// The panel follows the finger (translateY) and snaps in the swipe direction on release.
// Taps keep working (no preventDefault until the gesture is clearly vertical).
export function useSheetDrag(opts: {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The scrollable body inside the panel (optional). */
  scrollRef?: React.RefObject<HTMLElement | null>;
}) {
  const { open, setOpen, scrollRef } = opts;
  // Callback ref kept in state: the panel often mounts AFTER the first render (e.g. the tracking
  // page shows a loader first). A plain ref would leave the listeners unattached (bug 2026-11-15:
  // the passenger track sheet only moved by its handle).
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
  const panelRef = useCallback((el: HTMLDivElement | null) => setPanelEl(el), []);
  const [offset, setOffset] = useState<number | null>(null);

  useEffect(() => {
    const el = panelEl;
    if (!el) return;
    let s: { y: number; mode: 'drag' | 'scroll' | null; inScroll: boolean } | null = null;
    const pullUpMax = 60; // rubber-band room when lifting a collapsed panel
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { s = null; return; }
      const target = e.target as Node | null;
      // Never hijack typing / sliders.
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [data-no-sheet-drag]')) { s = null; return; }
      const body = scrollRef?.current ?? null;
      s = { y: e.touches[0].clientY, mode: null, inScroll: !!(body && target && body.contains(target)) };
    };
    const onMove = (e: TouchEvent) => {
      if (!s) return;
      const dy = e.touches[0].clientY - s.y;
      if (s.mode === null) {
        if (Math.abs(dy) < 8) return;
        const body = scrollRef?.current ?? null;
        const atTop = !body || body.scrollTop <= 0;
        s.mode = !open || !s.inScroll || (dy > 0 && atTop) ? 'drag' : 'scroll';
        s.y = e.touches[0].clientY - Math.sign(dy) * 8;
      }
      if (s.mode !== 'drag') return;
      e.preventDefault();
      const d = e.touches[0].clientY - s.y;
      // Open: follow downward pulls. Collapsed: follow upward lifts a little (rubber band).
      setOffset(open ? Math.max(0, d) : Math.max(-pullUpMax, Math.min(0, d)) );
    };
    const onEnd = (e: TouchEvent) => {
      const cur = s;
      s = null;
      if (!cur || cur.mode !== 'drag') return;
      const y = e.changedTouches[0]?.clientY ?? cur.y;
      const d = y - cur.y;
      if (open && d > 40) setOpen(false);
      else if (!open && d < -25) setOpen(true);
      setOffset(null);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [open, setOpen, scrollRef, panelEl]);

  const style: React.CSSProperties = offset != null
    ? { transform: `translateY(${offset}px)`, transition: 'none' }
    : { transition: 'transform 250ms ease-out' };
  return { panelRef, style, dragging: offset != null };
}
