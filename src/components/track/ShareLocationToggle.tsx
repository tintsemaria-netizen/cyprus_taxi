'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import type { LiveLoc } from '@/components/useLiveLocation';

const KEY = 'ily-share-loc';
const SEND_EVERY_MS = 10_000;

// "Show the driver where I am" (2026-11-15). Opt-in per ride, only before pickup: whoever booked
// may be ordering for someone else, so nothing is shared until the person at the phone turns it
// on. Off → the server copy is deleted at once; the worker also wipes it after pickup.
export function ShareLocationToggle({ active, loc, onWantLocation }: { active: boolean; loc: LiveLoc | null; onWantLocation: (on: boolean) => void }) {
  const { t } = useT();
  const [on, setOn] = useState(false);
  const lastSent = useRef(0);
  const wasOn = useRef(false);

  useEffect(() => {
    try { if (sessionStorage.getItem(KEY) === '1') setOn(true); } catch { /* ignore */ }
  }, []);
  useEffect(() => { onWantLocation(on && active); }, [on, active, onWantLocation]);

  // Heartbeat: re-send the last fix every SEND_EVERY_MS while the app is open and visible, so the
  // driver keeps seeing the passenger even when they stand still (no new GPS events). When the
  // app is closed/hidden nothing is sent and the driver's marker disappears after 60 s.
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!on || !active) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') setBeat((n) => n + 1); }, SEND_EVERY_MS);
    return () => clearInterval(id);
  }, [on, active]);

  // Send while on and before pickup; stop (and delete on the server) when switched off or picked up.
  useEffect(() => {
    if (on && active && loc && document.visibilityState === 'visible' && Date.now() - lastSent.current >= SEND_EVERY_MS - 500) {
      lastSent.current = Date.now();
      wasOn.current = true;
      void api('/tracking/location', { method: 'POST', body: { lat: loc.lat, lng: loc.lng, accuracyM: Math.round(loc.accuracyM) } }).catch(() => { /* next fix retries */ });
    }
    if ((!on || !active) && wasOn.current) {
      wasOn.current = false;
      lastSent.current = 0;
      void api('/tracking/location', { method: 'DELETE' }).catch(() => { /* worker purges anyway */ });
    }
  }, [on, active, loc, beat]);

  if (!active) return null;
  function toggle() {
    const next = !on;
    setOn(next);
    try { sessionStorage.setItem(KEY, next ? '1' : '0'); } catch { /* ignore */ }
  }
  return (
    <button type="button" onClick={toggle} aria-pressed={on}
      className={`flex w-full items-center gap-3 rounded-[14px] border px-3 py-2.5 text-left text-sm ${on ? 'border-[#4C9AFF] bg-[#4C9AFF]/10' : 'border-edge'}`}>
      <span className="text-lg" aria-hidden="true">🧍</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{on ? t('track.shareLoc.on') : t('track.shareLoc.off')}</span>
        <span className="block text-xs text-muted">{on && !loc ? t('track.shareLoc.waiting') : t('track.shareLoc.hint')}</span>
      </span>
      <span className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${on ? 'bg-[#4C9AFF]' : 'bg-edge'}`}>
        <span className={`block h-5 w-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}
