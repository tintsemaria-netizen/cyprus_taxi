'use client';

import { useEffect, useRef, useState } from 'react';

// Free map exploration with auto-return (2026-11-14, driver map).
// While the user touches / drags / pinches / scrolls the map, `active.current` is true and the
// map's automatic camera (follow own car, fit pickup) must not move the view. `ms` after the
// last gesture ends, `active` clears and `returnTick` increments so the camera effects re-run
// and bring the default view back. Disabled when `ms` is undefined.
export function useIdleReturn(
  containerRef: React.RefObject<HTMLElement | null>,
  ms?: number,
  cb: { onStart?: () => void; onReturn?: () => void } = {},
) {
  const active = useRef(false);
  const [returnTick, setReturnTick] = useState(0);
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !ms) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pointers = new Set<number>();
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (pointers.size) return;
        active.current = false;
        setReturnTick((n) => n + 1);
        cbRef.current.onReturn?.();
      }, ms);
    };
    const start = () => { if (!active.current) cbRef.current.onStart?.(); active.current = true; };
    // Synthetic events (the two-finger camera's pointercancel to the map) are not the user's fingers.
    // A finger whose «up» never arrives (iOS hands the touch to a system gesture, the app goes to the
    // background) must not freeze the automatic camera forever (2026-11-19): forget it after 8 s.
    let stuck: ReturnType<typeof setTimeout> | undefined;
    const onDown = (e: PointerEvent) => {
      if (!e.isTrusted) return; pointers.add(e.pointerId); start(); clearTimeout(timer);
      clearTimeout(stuck); stuck = setTimeout(() => { if (pointers.size) { pointers.clear(); arm(); } }, 8000);
    };
    const onUp = (e: PointerEvent) => { if (!e.isTrusted) return; if (!pointers.delete(e.pointerId)) return; if (!pointers.size) arm(); };
    const onWheel = () => { start(); arm(); };
    el.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    el.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => {
      clearTimeout(timer); clearTimeout(stuck);
      el.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      el.removeEventListener('wheel', onWheel, true);
    };
  }, [containerRef, ms]);
  return { active, returnTick };
}
