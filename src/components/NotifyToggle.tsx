'use client';

import { useEffect, useState } from 'react';
import { enablePush, pushPermission, pushSupported } from '@/lib/push-client';

// Notification opt-in usable anywhere (driver duty card, passenger tracking). When
// permission is already granted it silently (re)registers the subscription for THIS
// audience — so state reflects an actual server subscription, not just permission.
export function NotifyToggle({ pushUrl, className }: { pushUrl: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'on' | 'denied' | 'busy' | 'unsupported'>('idle');

  useEffect(() => {
    if (!pushSupported()) { setState('unsupported'); return; }
    const p = pushPermission();
    if (p === 'granted') { setState('busy'); enablePush(pushUrl).then((r) => setState(r.ok ? 'on' : 'idle')); }
    else if (p === 'denied') setState('denied');
    else setState('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushUrl]);

  if (state === 'unsupported') return null;

  async function turnOn() {
    setState('busy');
    const r = await enablePush(pushUrl);
    setState(r.ok ? 'on' : r.reason === 'denied' ? 'denied' : 'idle');
  }

  return (
    <div className={className}>
      {state === 'on' ? (
        <span className="text-xs text-muted">🔔 Alerts on</span>
      ) : state === 'denied' ? (
        <span className="text-xs text-muted">🔕 Alerts blocked in browser settings</span>
      ) : (
        <button type="button" className="text-xs text-accent hover:underline disabled:opacity-50" disabled={state === 'busy'} onClick={turnOn}>
          {state === 'busy' ? 'Enabling…' : '🔔 Enable ride alerts'}
        </button>
      )}
    </div>
  );
}
