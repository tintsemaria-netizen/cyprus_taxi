'use client';

import { useEffect } from 'react';

// Collapsed bottom sheets (2026-11-15): a peek strip must never show half a line of text or half a
// box. While `enabled`, every element inside `ref` that is only PARTLY visible (cut by the
// container's bottom edge) is hidden; fully visible ones stay. Re-checked when the container
// resizes (sheet drag) or its content changes. Restored when disabled.
const SEL = 'p, h1, h2, h3, h4, label, span, a, button, input, select, textarea, li, img, svg, [class*="border"], [class*="bg-"]';
const MARK = 'data-clip-hidden';

export function useHideClipped(ref: React.RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const restore = () => box.querySelectorAll(`[${MARK}]`).forEach((el) => { (el as HTMLElement).style.visibility = ''; el.removeAttribute(MARK); });
    if (!enabled) { restore(); return; }
    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        restore();
        const r = box.getBoundingClientRect();
        const limit = Math.min(r.bottom, window.innerHeight); // overflow clips at the padding edge
        box.querySelectorAll<HTMLElement>(SEL).forEach((el) => {
          if (el.closest(`[${MARK}]`)) return; // an ancestor is already hidden
          const e = el.getBoundingClientRect();
          if (e.height === 0 || e.width === 0) return;
          if (e.top < limit - 1 && e.bottom > limit + 1) { el.style.visibility = 'hidden'; el.setAttribute(MARK, ''); }
        });
      });
    };
    run();
    const ro = new ResizeObserver(run); ro.observe(box);
    // Also watch the sheet itself (its height changes while dragged) and content changes.
    if (box.parentElement) ro.observe(box.parentElement);
    const mo = new MutationObserver((list) => { if (list.some((m) => !(m.type === 'attributes' && (m.attributeName === MARK || m.attributeName === 'style')))) run(); });
    mo.observe(box, { childList: true, subtree: true, characterData: true, attributes: true });
    window.addEventListener('resize', run);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', run); restore(); };
  }, [ref, enabled]);
}
