'use client';

import { useEffect } from 'react';

// Light glint on the rim of the main driver buttons (2026-11-18): tilting the phone left / right
// moves a short highlight along the button's edge, like light catching a metal rim. Only the edge
// (a 1.5 px ring), never the face. One shared, throttled orientation listener for all buttons;
// it stops when no button is on screen. iPhone (2026-11-18): Safari only gives the tilt after the
// user allows «Motion & Orientation» — asked once, on the first tap anywhere while such a button is
// on screen (iOS only lets a page ask from a tap). «Don't allow» is remembered: we never ask again.

let users = 0;
let raf = 0;
// A metal-rim glint (2026-11-18, v2): a sharp white spark plus a softer one opposite it, travelling
// round the rim as the phone tilts (gamma −35°…35° → −80°…80°), instead of a band sweeping across.
let target = 0, shown = 0;
function onTilt(e: DeviceOrientationEvent) {
  if (e.gamma == null) return;
  target = Math.max(-80, Math.min(80, (e.gamma / 35) * 80));
  if (!raf) raf = requestAnimationFrame(paint);
}
function paint() {
  raf = 0;
  shown += (target - shown) * 0.22;
  document.documentElement.style.setProperty('--shine-a', `${shown.toFixed(1)}deg`);
  if (Math.abs(target - shown) > 0.3) raf = requestAnimationFrame(paint);
}

const ASKED = 'il-y-tilt-asked';
type IOSOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
function askOnFirstTap() {
  const DOE = (typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined) as IOSOrientation | undefined;
  if (!DOE || typeof DOE.requestPermission !== 'function') return; // Android / desktop: no permission needed
  try { if (localStorage.getItem(ASKED) === 'denied') return; } catch { /* private mode */ }
  const ask = () => {
    window.removeEventListener('click', ask, true);
    DOE.requestPermission!().then((r) => { try { localStorage.setItem(ASKED, r); } catch { /* ignore */ } }).catch(() => {});
  };
  window.addEventListener('click', ask, true);
}

export default function EdgeShine({ strength = 0.95 }: { strength?: number }) {
  useEffect(() => {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;
    if (users++ === 0) { window.addEventListener('deviceorientation', onTilt); askOnFirstTap(); }
    return () => { if (--users === 0) window.removeEventListener('deviceorientation', onTilt); };
  }, []);
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]"
      style={{
        padding: 2,
        // Spark at the top of the rim (from −20° = just left of 12 o'clock), turning with the tilt.
        background: `conic-gradient(from calc(var(--shine-a, 0deg) - 28deg),
          transparent 0deg, rgba(255,255,255,${(strength * 0.35).toFixed(2)}) 14deg, rgba(255,255,255,${strength}) 26deg, #fff 28deg,
          rgba(255,255,255,${strength}) 30deg, rgba(255,255,255,${(strength * 0.35).toFixed(2)}) 42deg, transparent 58deg,
          transparent 190deg, rgba(255,255,255,${(strength * 0.45).toFixed(2)}) 208deg, transparent 226deg, transparent 360deg)`,
        WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
        WebkitMaskComposite: 'xor',
        mask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)',
        filter: 'drop-shadow(0 0 2px rgba(255,255,255,0.55))',
      }} />
  );
}
