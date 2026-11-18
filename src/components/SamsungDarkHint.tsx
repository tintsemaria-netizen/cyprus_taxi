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
  return (
    <div role="dialog" aria-modal="true" data-testid="samsung-dark-hint" className="fixed inset-x-3 z-[95] rounded-[16px] border border-edge bg-elevated p-4 text-sm text-ink shadow-2xl"
      style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}>
      <p className="leading-5">{t('common.samsungDark.text')}</p>
      <button type="button" onClick={close} className="btn-primary mt-3 min-h-[44px] w-full">{t('common.samsungDark.ok')}</button>
    </div>
  );
}
