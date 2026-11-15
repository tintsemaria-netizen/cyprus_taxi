'use client';

import { useEffect, useState } from 'react';

// Full-screen app roots and the on-screen keyboard (2026-11-15, iPhone).
// When the keyboard opens, iOS shrinks the VISUAL viewport and pans it down to the focused field,
// while `position: fixed; inset: 0` stays pinned to the LAYOUT viewport — so the header slid up
// under the status bar (time/battery over the logo). We pin the root to the visual viewport
// instead: top = visualViewport.offsetTop, height = visualViewport.height, and undo any page pan.
// Without a keyboard (or without the API) the root keeps its normal `inset: 0`.
export function useKeyboardViewport(): React.CSSProperties | undefined {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const keyboard = window.innerHeight - vv.height > 80; // a keyboard, not just a toolbar
        if (!keyboard) { setBox(null); return; }
        setBox((b) => (b && Math.abs(b.top - vv.offsetTop) < 1 && Math.abs(b.height - vv.height) < 1 ? b : { top: vv.offsetTop, height: vv.height }));
        // Keep the field being typed into visible inside the (now shorter) app.
        const a = document.activeElement as HTMLElement | null;
        if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName)) setTimeout(() => a.scrollIntoView({ block: 'nearest' }), 50);
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('focusout', update);
    };
  }, []);
  return box ? { top: `${box.top}px`, height: `${box.height}px`, bottom: 'auto' } : undefined;
}
