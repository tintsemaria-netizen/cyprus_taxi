'use client';

import { useRef, useState } from 'react';

// Swipe to confirm (2026-11-18): an important driver action («Завершить поездку», «Уйти с линии»)
// happens only after sliding the knob across — a stray tap in the car does nothing. Follows the
// reading direction (left → right; right → left in Hebrew / Arabic). Keyboard: Enter / Space.
export default function SwipeButton({ label, onDone, className = '', knobClassName = '', testId }: {
  label: string;
  onDone: () => void;
  className?: string; // track colours
  knobClassName?: string;
  testId?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; max: number; rtl: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const [done, setDone] = useState(false);
  const KNOB = 48, PAD = 4;

  const down = (e: React.PointerEvent) => {
    if (done || !track.current) return;
    const rtl = getComputedStyle(track.current).direction === 'rtl';
    start.current = { x: e.clientX, max: track.current.clientWidth - KNOB - PAD * 2, rtl };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current; if (!s) return;
    const d = (e.clientX - s.x) * (s.rtl ? -1 : 1);
    setDx(Math.max(0, Math.min(s.max, d)));
  };
  const up = () => {
    const s = start.current; start.current = null; if (!s) return;
    if (dx >= s.max * 0.85) { setDx(s.max); setDone(true); navigator.vibrate?.(20); onDone(); setTimeout(() => { setDone(false); setDx(0); }, 1200); }
    else setDx(0);
  };
  const progress = track.current ? dx / Math.max(1, track.current.clientWidth - KNOB - PAD * 2) : 0;

  return (
    <div ref={track} role="button" tabIndex={0} aria-label={label} data-testid={testId}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDone(); } }}
      className={`relative h-14 w-full select-none overflow-hidden rounded-full shadow-lg ${className}`}>
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center ps-12 text-[17px] font-bold" style={{ opacity: 1 - Math.min(1, progress * 1.4) }}>
        {label}
        <span aria-hidden className="ms-2 opacity-70 rtl:rotate-180">›››</span>
      </span>
      <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        className={`absolute top-1 flex h-12 w-12 touch-none items-center justify-center rounded-full ${knobClassName} ${start.current ? '' : 'transition-transform duration-200'}`}
        style={{ insetInlineStart: PAD, transform: `translateX(${(typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? -1 : 1) * dx}px)` }}>
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="rtl:rotate-180">
          {done ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M9 5l7 7-7 7" />}
        </svg>
      </div>
    </div>
  );
}
