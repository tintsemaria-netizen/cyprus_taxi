'use client';

import { useEffect } from 'react';

// Light glint on the rim of the main driver buttons (2026-11-18): tilting the phone left / right
// moves a short highlight along the button's edge, like light catching a metal rim. Only the edge
// (a 1.5 px ring), never the face. One shared, throttled orientation listener for all buttons;
// it stops when no button is on screen. iPhone needs a motion permission the app does not ask for,
// so there the glint simply rests in its middle position.

let users = 0;
let raf = 0;
let target = 50, shown = 50;
function onTilt(e: DeviceOrientationEvent) {
  if (e.gamma == null) return;
  // gamma −30°…30° → glint position 5 %…95 % along the edge.
  target = Math.max(5, Math.min(95, 50 + (e.gamma / 30) * 45));
  if (!raf) raf = requestAnimationFrame(paint);
}
function paint() {
  raf = 0;
  shown += (target - shown) * 0.25;
  document.documentElement.style.setProperty('--shine', `${shown.toFixed(1)}%`);
  if (Math.abs(target - shown) > 0.3) raf = requestAnimationFrame(paint);
}

export default function EdgeShine({ strength = 0.85 }: { strength?: number }) {
  useEffect(() => {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;
    if (users++ === 0) window.addEventListener('deviceorientation', onTilt);
    return () => { if (--users === 0) window.removeEventListener('deviceorientation', onTilt); };
  }, []);
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]"
      style={{
        padding: 1.5,
        background: `linear-gradient(100deg, transparent calc(var(--shine, 50%) - 18%), rgba(255,255,255,${strength}) var(--shine, 50%), transparent calc(var(--shine, 50%) + 18%))`,
        WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
        WebkitMaskComposite: 'xor',
        mask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)',
      }} />
  );
}
