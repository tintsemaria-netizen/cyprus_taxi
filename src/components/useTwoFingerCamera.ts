'use client';

import { useEffect, useRef } from 'react';

// Two fingers: zoom AND rotate at the same time (2026-11-17). Google's own touch handling locks a
// two-finger gesture into either pinch-zoom or rotation; here the map camera follows both at once.
// While two fingers are down, their pointer/touch events are kept from Google (window capture) and
// the camera is driven directly: zoom from the finger spread, heading from the finger angle,
// around the centre of the map. One finger is left to Google (normal pan).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GMap = any;

export function useTwoFingerCamera(
  containerRef: React.RefObject<HTMLElement | null>,
  mapRef: React.RefObject<GMap | null>,
  enabled: boolean,
  opts: { rotate?: boolean; onGesture?: () => void } = {},
) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;
    const pts = new Map<number, { x: number; y: number; target: EventTarget | null }>();
    let g: { d0: number; a0: number; z0: number; h0: number } | null = null;
    let blocking = false; // from the 2nd finger down until every finger is up

    const inside = (e: Event) => { const t = e.target as Node | null; return !!t && el.contains(t); };
    const two = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(b.x - a.x, b.y - a.y), ang: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI }; };
    const block = (e: Event) => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); };

    const onDown = (e: PointerEvent) => {
      if (!e.isTrusted || e.pointerType !== 'touch') return;
      if (!pts.size && !inside(e)) return;
      if (pts.size && !pts.has(e.pointerId) && !inside(e)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, target: e.target });
      if (pts.size === 2) {
        const map = mapRef.current;
        if (!map) return;
        // Let Google end the one-finger pan it started, cleanly.
        for (const [id, p] of pts) {
          if (id === e.pointerId || !p.target) continue;
          try { p.target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: id, pointerType: 'touch', bubbles: true, isPrimary: true })); } catch { /* old browser */ }
        }
        const { d, ang } = two();
        g = { d0: Math.max(d, 1), a0: ang, z0: map.getZoom?.() ?? 15, h0: map.getHeading?.() ?? 0 };
        blocking = true;
        optsRef.current.onGesture?.();
      }
      if (blocking) block(e);
    };
    const onMove = (e: PointerEvent) => {
      if (!e.isTrusted || !pts.has(e.pointerId)) return;
      pts.get(e.pointerId)!.x = e.clientX;
      pts.get(e.pointerId)!.y = e.clientY;
      if (!blocking) return;
      block(e);
      const map = mapRef.current;
      if (!g || pts.size < 2 || !map) return;
      const { d, ang } = two();
      let dA = ang - g.a0;
      if (dA > 180) dA -= 360; else if (dA < -180) dA += 360;
      const zoom = Math.max(3, Math.min(21, g.z0 + Math.log2(d / g.d0)));
      // Fingers turning clockwise turn the map clockwise → the heading at the top decreases.
      const cam: { zoom: number; heading?: number } = { zoom };
      if (optsRef.current.rotate !== false) cam.heading = (((g.h0 - dA) % 360) + 360) % 360;
      map.moveCamera?.(cam);
    };
    const onUp = (e: PointerEvent) => {
      if (!e.isTrusted || !pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (blocking) block(e);
      if (pts.size < 2) g = null;
      if (!pts.size) blocking = false;
    };
    // Touch events (if the map listens to them too): hidden while the two-finger gesture runs.
    const onTouch = (e: TouchEvent) => { if (blocking && e.isTrusted) block(e); };

    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, { capture: true, passive: false });
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('touchstart', onTouch, { capture: true, passive: false });
    window.addEventListener('touchmove', onTouch, { capture: true, passive: false });
    window.addEventListener('touchend', onTouch, { capture: true, passive: false });
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('touchstart', onTouch, true);
      window.removeEventListener('touchmove', onTouch, true);
      window.removeEventListener('touchend', onTouch, true);
    };
  }, [containerRef, mapRef, enabled]);
}
