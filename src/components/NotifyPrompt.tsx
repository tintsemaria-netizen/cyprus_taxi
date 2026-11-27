'use client';

import { useEffect, useState } from 'react';
import { enablePush, pushPermission, pushSupported, rememberPushLocale } from '@/lib/push-client';
import { useT } from '@/i18n/I18nProvider';

// Ask for notifications ONCE, at the very first visit (2026-11-19, operator: «в самом начале и
// один раз»; was: after sign-in), instead of a «Включить уведомления» link on every ride screen.
// On an iPhone in Safari (no web push until the site is on the Home Screen) the same one-time
// card explains how to add it. Browsers need a tap to show their own
// permission dialog, so this is a small card with «Разрешить». Shown only while the
// permission is still undecided and it was not dismissed before. Once granted, the
// subscription is (re)registered silently for the account.
const ASKED_KEY = 'ily-notify-asked';

export function NotifyPrompt({ pushUrl, active }: { pushUrl: string; active: boolean }) {
  const { t, locale } = useT();
  const [show, setShow] = useState<false | 'ask' | 'ios'>(false);
  useEffect(() => {
    void rememberPushLocale(locale); // notifications are shown in the app's language
    if (!active) return;
    let asked = false;
    try { asked = localStorage.getItem(ASKED_KEY) === '1'; } catch { /* private mode */ }
    if (!pushSupported()) {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (ios && !standalone && !asked) setShow('ios');
      return;
    }
    const p = pushPermission();
    if (p === 'granted') { void enablePush(pushUrl); return; }
    if (p !== 'default') return;
    if (!asked) setShow('ask');
  }, [active, pushUrl, locale]);
  if (!show) return null;
  const done = () => { try { localStorage.setItem(ASKED_KEY, '1'); } catch { /* ignore */ } setShow(false); };
  return (
    <div className="fixed inset-0 [&>*]:max-h-[calc(100dvh-1.5rem)] [&>*]:overflow-y-auto z-[80] flex items-end justify-center bg-black/55 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={t('common.notifyPrompt.title')}>
      <div className="card w-full max-w-sm p-5" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="text-3xl" aria-hidden>🔔</div>
        <h2 className="mt-2 text-lg font-bold">{t('common.notifyPrompt.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('common.notifyPrompt.body')}</p>
        {show === 'ios' ? (
          <>
            <p className="mt-2 text-sm">{t('share.notify.ios')}</p>
            <button type="button" className="btn-primary mt-4 w-full" onClick={done}>OK</button>
          </>
        ) : (
          <>
            <button type="button" className="btn-primary mt-4 w-full" onClick={async () => { await enablePush(pushUrl); done(); }}>{t('common.notifyPrompt.allow')}</button>
            <button type="button" className="btn-ghost mt-2 w-full" onClick={done}>{t('common.notifyPrompt.later')}</button>
          </>
        )}
      </div>
    </div>
  );
}

// Keep an existing permission working without showing anything (ride screens).
export function useSilentPush(pushUrl: string, active = true) {
  useEffect(() => {
    if (!active || !pushSupported() || pushPermission() !== 'granted') return;
    void enablePush(pushUrl);
  }, [pushUrl, active]);
}
