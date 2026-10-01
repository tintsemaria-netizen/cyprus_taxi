'use client';

import { useEffect, useRef } from 'react';

// In-app confirmation (replaces native confirm()/alert(), which look off-brand, can be blocked in
// installed PWAs/webviews and can't explain consequences — 2026-10-01 audit).
export function ConfirmSheet({
  title, body, confirmLabel, cancelLabel = 'Keep it', danger = false, busy = false, onConfirm, onCancel,
}: {
  title: string; body?: React.ReactNode; confirmLabel: string; cancelLabel?: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-4 sm:items-center sm:pb-0" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="cs-title" aria-describedby={body ? 'cs-body' : undefined} className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()} style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        <h2 id="cs-title" className="text-lg font-bold">{title}</h2>
        {body && <div id="cs-body" className="mt-2 text-sm text-muted">{body}</div>}
        <div className="mt-5 grid gap-2">
          <button className={danger ? 'w-full rounded-[12px] border border-danger bg-danger/15 px-4 py-3 font-semibold text-danger disabled:opacity-50' : 'btn-primary w-full'} disabled={busy} onClick={onConfirm}>{busy ? 'Please wait…' : confirmLabel}</button>
          <button ref={cancelRef} className="btn-ghost w-full" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
        </div>
      </div>
    </div>
  );
}
