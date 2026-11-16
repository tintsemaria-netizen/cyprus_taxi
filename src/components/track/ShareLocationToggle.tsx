'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import type { LiveLoc } from '@/components/useLiveLocation';

const KEY = 'ily-share-loc';
const SEND_EVERY_MS = 2_000; // the driver sees the passenger move live (2026-11-15)

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

  // App closed / sent to background → remove the position now (the driver's marker vanishes);
  // it is sent again when the app comes back.
  useEffect(() => {
    if (!on || !active) return;
    const gone = () => { if (document.visibilityState === 'hidden') { lastSent.current = 0; void fetch('/api/v1/tracking/location', { method: 'DELETE', keepalive: true, credentials: 'same-origin' }).catch(() => {}); } };
    const bye = () => { void fetch('/api/v1/tracking/location', { method: 'DELETE', keepalive: true, credentials: 'same-origin' }).catch(() => {}); };
    document.addEventListener('visibilitychange', gone);
    window.addEventListener('pagehide', bye);
    return () => { document.removeEventListener('visibilitychange', gone); window.removeEventListener('pagehide', bye); };
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
    // Compact, frameless (2026-11-16): label, the switch under it, a short status line under that.
    // Sits in a two-column row next to the confirmation-code switch.
    <button type="button" role="switch" onClick={toggle} aria-checked={on} data-testid="share-loc-switch"
      className="flex w-full flex-col items-start gap-2 text-left">
      <span className="text-sm font-semibold">{on ? t('track.shareLoc.on') : t('track.shareLoc.off')}</span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? 'bg-[#4C9AFF]' : 'bg-edge'}`}>
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
      {on && !loc && <span className="text-xs text-muted">{t('track.shareLoc.waiting')}</span>}
    </button>
  );
}
