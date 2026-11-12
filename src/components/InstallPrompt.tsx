'use client';
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from 'react';
import { useT } from '@/i18n/I18nProvider';
import {
  type BeforeInstallPromptEvent, clearInstallPrompt, dismissInstall, installDismissed,
  isAndroid, isIos, isStandalone, onInstallPrompt,
} from '@/lib/pwa';

// "Add to Home Screen" hint for phones. Android/Chrome: a real Install button (the browser's
// own prompt). iPhone: Safari has no install API, so we show the Share → Add to Home Screen
// steps. Hidden when already installed, on desktop, or for 14 days after "Not now".
export function InstallPrompt({ app, className = '' }: { app: 'passenger' | 'driver'; className?: string }) {
  const { t } = useT();
  const [mode, setMode] = useState<'none' | 'ios' | 'android'>('none');
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || installDismissed(app)) return;
    if (isIos()) { setMode('ios'); return; }
    if (!isAndroid()) return;
    return onInstallPrompt((e) => { setEvt(e); setMode(e ? 'android' : 'none'); });
  }, [app]);

  if (mode === 'none') return null;

  const close = () => { dismissInstall(app); setMode('none'); };
  async function install() {
    if (!evt) return;
    await evt.prompt();
    const choice = await evt.userChoice.catch(() => null);
    clearInstallPrompt();
    if (choice?.outcome !== 'accepted') dismissInstall(app);
    setMode('none');
  }

  return (
    <div role="region" aria-label={t('common.install.title')}
      className={`flex items-start gap-3 rounded-[12px] border border-accent/40 bg-accent/10 px-3 py-2 text-sm ${className}`}>
      <img src="/icons/icon-192.png" alt="" aria-hidden className="mt-0.5 h-8 w-8 shrink-0 rounded-[8px]" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-ink">{app === 'driver' ? t('common.install.titleDriver') : t('common.install.title')}</div>
        <div className="text-xs text-muted">{mode === 'ios' ? t('common.install.iosSteps') : t('common.install.androidBody')}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {mode === 'android' && (
          <button type="button" className="btn-primary !min-h-0 !px-3 !py-1.5 text-xs" onClick={install}>{t('common.install.install')}</button>
        )}
        <button type="button" className="text-xs text-muted hover:text-ink" onClick={close}>{t('common.install.notNow')}</button>
      </div>
    </div>
  );
}
