'use client';

import { useEffect, useState } from 'react';

export interface LiveLoc { lat: number; lng: number; accuracyM: number; at: number }

// The device's live position while the page is visible (2026-11-15): drives the passenger's
// "you are here" person marker. Pauses when the tab is hidden (battery); silent when denied.
// Only asks the browser if permission was already granted or `prompt` is true.
export function useLiveLocation(enabled = true, prompt = false): LiveLoc | null {
  const [loc, setLoc] = useState<LiveLoc | null>(null);
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.geolocation) return;
    let id: number | null = null;
    let cancelled = false;
    const start = () => {
      if (id !== null || document.visibilityState !== 'visible') return;
      id = navigator.geolocation.watchPosition(
        (p) => setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy ?? 0, at: Date.now() }),
        () => { /* denied / unavailable: no marker */ },
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
      );
    };
    const stop = () => { if (id !== null) navigator.geolocation.clearWatch(id); id = null; };
    const onVis = () => (document.visibilityState === 'visible' ? start() : stop());
    (async () => {
      if (!prompt) {
        try {
          const st = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
          if (st && st.state !== 'granted') return;
        } catch { /* Permissions API missing (older Safari): fall through */ }
      }
      if (cancelled) return;
      start();
      document.addEventListener('visibilitychange', onVis);
    })();
    return () => { cancelled = true; stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled, prompt]);
  return loc;
}
