'use client';

import { useEffect, useRef, type RefObject } from 'react';

// Close a small pop-up (a list, an ⓘ note, a menu) on a tap anywhere else or on Escape, not only with its own
// button (operator 2026-11-27). `refs` = the pop-up and the button that opens it (a tap on the button keeps
// its own toggle). pointerdown: iPhone Safari never sends mousedown for a tap on plain page parts.
export function useDismiss(open: boolean, onClose: () => void, refs: RefObject<HTMLElement | null>[]): void {
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const refsRef = useRef(refs); refsRef.current = refs;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && refsRef.current.some((r) => r.current?.contains(t))) return;
      // That tap only closes the pop-up: the click that follows it is swallowed, so it does not also press
      // whatever lies under the finger (the menu moves when the list folds away).
      const swallow = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation(); };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 600);
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
}
