'use client';

import { useLayoutEffect, useRef, useState } from 'react';

// A top bar pinned to the VIEWPORT (position: fixed) plus a spacer of its height in the flow
// (2026-11-20). iOS 26 Safari and Home Screen apps tint the status bar with the colour of an opaque
// bar fixed to the top edge; a bar that is only sticky inside a fixed full-screen container does not
// count, and iOS then lays its soft dimming over the logo and the avatar. `top` follows the
// keyboard-shifted app box (useKeyboardViewport) so the bar stays where it was.
export function FixedTop({ top, z = 20, children }: { top?: string | number; z?: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setH(el.offsetHeight);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <>
      <div aria-hidden className="shrink-0" style={{ height: h }} />
      <div ref={ref} className="fixed inset-x-0" style={{ top: top ?? 0, zIndex: z }} data-testid="fixed-top">{children}</div>
    </>
  );
}
