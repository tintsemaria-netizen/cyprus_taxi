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
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
}
