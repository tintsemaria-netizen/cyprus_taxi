'use client';

import { useEffect, useRef } from 'react';

// A small red pop-up over everything, with a little arrow pointing at the thing that was tapped
// (operator 2026-11-27): it does not push anything aside, goes away by itself in 2.5 s (or on a tap).
// The parent must be `relative`; the bubble hangs just below it.
export function InlineError({ text, onClose }: { text: string; onClose: () => void }) {
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => { const id = setTimeout(() => closeRef.current(), 2500); return () => clearTimeout(id); }, []);
  return (
    <div role="alert" data-testid="inline-error" onClick={onClose}
      className="absolute inset-x-1 top-full z-[60] mt-2 rounded-[10px] bg-danger px-3 py-2 text-xs font-semibold leading-snug text-white shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
      {/* the arrow pointing up at the tapped row */}
      <span aria-hidden className="absolute -top-1.5 start-8 h-3 w-3 rotate-45 bg-danger" />
      <span className="relative">{text}</span>
    </div>
  );
}
