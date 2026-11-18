'use client';

import { useRef, useState } from 'react';
import EdgeShine from './EdgeShine';

// Swipe to confirm (2026-11-18): an important driver action («Завершить поездку», «Уйти с линии»)
// happens only after sliding the knob across — a stray tap in the car does nothing. Follows the
// reading direction (left → right; right → left in Hebrew / Arabic). Keyboard: Enter / Space.
export default function SwipeButton({ label, onDone, className = '', knobClassName = '', testId, small = false, bgColor }: {
  label: string;
  onDone: () => void;
  className?: string; // track colours
  knobClassName?: string;
  testId?: string;
  /** 35 % smaller bar (2026-11-18: «Уйти с линии»). */
  small?: boolean;
  bgColor?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; max: number; rtl: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const [done, setDone] = useState(false);
  const KNOB = small ? 48 : 48, PAD = small ? 2.5 : 4; // small = 53 px high (20 % thicker, 2026-11-18)

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
      // The whole bar can be swiped (2026-11-18): no circle, the three arrows travel with the finger.
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      // `bgImage`: colour painted as an image layer, which browser forced-dark modes leave alone.
      style={bgColor ? { backgroundImage: `linear-gradient(${bgColor}, ${bgColor})` } : undefined}
      className={`relative ${small ? 'h-[53px]' : 'h-14'} w-full touch-none select-none overflow-hidden rounded-full shadow-lg ${className}`}>
      <EdgeShine />
      <span className={`pointer-events-none absolute inset-0 flex items-center justify-center ${small ? 'ps-9 text-[16px]' : 'ps-10 text-[17px]'} font-bold`} style={{ opacity: 1 - Math.min(1, progress * 1.4) }}>
        {label}
      </span>
      <div className={`pointer-events-none absolute ${small ? 'top-[2.5px] h-12 w-12' : 'top-1 h-12 w-12'} flex items-center justify-center ${knobClassName} ${start.current ? '' : 'transition-transform duration-200'}`}
        style={{ insetInlineStart: PAD, transform: `translateX(${(typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? -1 : 1) * dx}px)` }}>
        {done ? (
          <svg viewBox="0 0 24 24" width={small ? 25 : 26} height={small ? 25 : 26} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        ) : (
          <svg viewBox="0 0 36 24" width={small ? 38 : 40} height={small ? 25 : 26} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="rtl:rotate-180">
            <path d="M5 6l6 6-6 6" opacity="0.45" /><path d="M15 6l6 6-6 6" opacity="0.7" /><path d="M25 6l6 6-6 6" />
          </svg>
        )}
      </div>
    </div>
  );
}
