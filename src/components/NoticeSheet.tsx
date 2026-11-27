'use client';

import { useEffect, useRef } from 'react';
import { useT } from '@/i18n/I18nProvider';

// A small window with one message and «Понятно» (2026-11-27): shown on a tap instead of a line that is
// always on screen (e.g. «уйдите с линии», «машина занята» in the car choice).
export function NoticeSheet({ text, onClose }: { text: string; onClose: () => void }) {
  const { t } = useT();
  const okRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 px-4 pb-4 sm:items-center sm:pb-0 [&>*]:max-h-[calc(100dvh-1.5rem)] [&>*]:overflow-y-auto" onClick={onClose}>
      <div role="alertdialog" aria-modal="true" aria-describedby="notice-text" data-testid="notice-sheet" className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()} style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        <p id="notice-text" className="text-[15px] leading-snug">{text}</p>
        <button ref={okRef} type="button" className="btn-primary mt-4 w-full" onClick={onClose}>{t('common.gotIt')}</button>
      </div>
    </div>
  );
}
