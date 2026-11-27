'use client';

import { useEffect, useRef } from 'react';

// A small red pop-up right under the thing that was tapped (operator 2026-11-27: «просто чтобы всплывало окно
// красное рядом»): no button, goes away by itself after 3 s. Used where a standing line was removed
// (car choice: «уйдите с линии», «машина занята»).
export function InlineError({ text, onClose }: { text: string; onClose: () => void }) {
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => { const id = setTimeout(() => closeRef.current(), 3000); return () => clearTimeout(id); }, []);
  return (
    <div role="alert" data-testid="inline-error" onClick={onClose}
      className="mx-2 mb-2 rounded-[10px] border border-danger/60 bg-danger/15 px-3 py-2 text-xs font-medium leading-snug text-danger">
      {text}
    </div>
  );
}
