'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/i18n/I18nProvider';

// Samsung Internet recolors pages with its own «dark mode» (2026-11-18): on a Z Fold 7 the orange
// «Уйти с линии» became red and the lime buttons olive. Developers cannot switch that off, so users
// of Samsung Internet get a one-time hint how to see the real colours (dismiss = never again).
const KEY = 'il-y-samsung-dark-hint';
export function SamsungDarkHint() {
  const { t } = useT();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!/SamsungBrowser/i.test(navigator.userAgent)) return;
    try { if (localStorage.getItem(KEY)) return; } catch { return; }
    setShow(true);
  }, []);
  if (!show) return null;
  const close = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } setShow(false); };
  // With a very large phone font the card was taller than the screen and «Понятно» could not be reached
  // (Samsung, operator 2026-11-27): the text scrolls, the button and × always stay on screen.
  return (
    <div role="dialog" aria-modal="true" data-testid="samsung-dark-hint" className="fixed inset-x-3 z-[95] flex flex-col rounded-[16px] border border-edge bg-elevated text-sm text-ink shadow-2xl"
      style={{ top: 'calc(env(safe-area-inset-top) + 12px)', maxHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px)' }}>
      <button type="button" onClick={close} aria-label={t('common.close')} data-testid="samsung-dark-close"
        className="absolute end-1.5 top-1.5 flex h-10 w-10 items-center justify-center rounded-full text-2xl text-muted">×</button>
      <p className="min-h-0 flex-1 overflow-y-auto overscroll-contain break-words px-4 pe-12 pt-4 leading-snug">{t('common.samsungDark.text')}</p>
      <div className="shrink-0 p-4 pt-3">
        <button type="button" onClick={close} className="btn-primary min-h-[44px] w-full">{t('common.samsungDark.ok')}</button>
      </div>
    </div>
  );
}
