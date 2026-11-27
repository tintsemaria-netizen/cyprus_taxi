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
  // Compact and NOT scaled by the phone's font size (operator 2026-11-27: on a Samsung with a very large
  // font the card filled the screen and «Понятно» was out of reach): fixed px sizes, text-size-adjust off;
  // the text still scrolls if needed, the button and × always stay on screen.
  return (
    <div role="dialog" aria-modal="true" data-testid="samsung-dark-hint" className="fixed inset-x-3 z-[95] mx-auto flex max-w-sm flex-col rounded-[14px] border border-edge bg-elevated text-ink shadow-2xl"
      style={{ top: 'calc(env(safe-area-inset-top) + 10px)', maxHeight: '45dvh', fontSize: '13px', lineHeight: '18px', WebkitTextSizeAdjust: 'none', textSizeAdjust: 'none' } as React.CSSProperties}>
      <button type="button" onClick={close} aria-label={t('common.close')} data-testid="samsung-dark-close"
        className="absolute end-1 top-1 flex h-8 w-8 items-center justify-center rounded-full text-muted" style={{ fontSize: '20px' }}>×</button>
      <p className="min-h-0 flex-1 overflow-y-auto overscroll-contain break-words ps-3 pe-9 pt-3">{t('common.samsungDark.text')}</p>
      <div className="shrink-0 px-3 pb-3 pt-2">
        <button type="button" onClick={close} className="btn-primary w-full" style={{ minHeight: '36px', fontSize: '14px', padding: '0 12px' }}>{t('common.samsungDark.ok')}</button>
      </div>
    </div>
  );
}
