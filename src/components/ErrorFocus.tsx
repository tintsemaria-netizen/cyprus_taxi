'use client';

import { useEffect } from 'react';

// App-wide (2026-11-15): when the user presses a button / submits a form and that makes an error
// appear (a field outlined red, an error message, an error banner), scroll to the FIRST new
// error and focus its field, so it is visible and can be fixed — in every form and every step.
// Only errors that appear right after the user's action count, so live validation while typing
// never makes the page jump.
const ERR = '.border-danger, [aria-invalid="true"], .text-danger, [role="alert"]';
const WINDOW_MS = 2500;

function visible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none';
}
const fieldOf = (el: Element): HTMLElement | null =>
  el.matches('input, textarea, select') ? (el as HTMLElement)
    : (el.parentElement?.querySelector('input.border-danger, textarea.border-danger, select.border-danger, input[aria-invalid="true"], textarea[aria-invalid="true"]') as HTMLElement | null);

export function ErrorFocus() {
  useEffect(() => {
    let armedAt = 0;
    let before = new Set<Element>();
    let raf = 0;
    const arm = (e: Event) => {
      const t = e.target as Element | null;
      if (e.type === 'click' && !t?.closest('button, [role="button"], input[type="submit"]')) return;
      armedAt = Date.now();
      before = new Set([...document.querySelectorAll(ERR)].filter(visible));
    };
    const check = () => {
      raf = 0;
      if (!armedAt || Date.now() - armedAt > WINDOW_MS) return;
      const fresh = [...document.querySelectorAll(ERR)].filter((el) => !before.has(el) && visible(el) && !el.closest('[data-no-error-focus], .gm-style, .maplibregl-map, button, a, [role="button"]'));
      if (!fresh.length) return;
      armedAt = 0; // once per action
      const first = fresh[0]; // document order = top-most in the form
      const field = fieldOf(first);
      (field ?? (first as HTMLElement)).scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (field && document.activeElement !== field) setTimeout(() => field.focus({ preventScroll: true }), 350);
    };
    const mo = new MutationObserver(() => { if (armedAt && !raf) raf = requestAnimationFrame(check); });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-invalid', 'role'] });
    document.addEventListener('click', arm, true);
    document.addEventListener('submit', arm, true);
    return () => { mo.disconnect(); document.removeEventListener('click', arm, true); document.removeEventListener('submit', arm, true); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return null;
}
