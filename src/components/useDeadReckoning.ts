'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cumulative, deadReckon, distM, DR, locate, type LatLng } from '@/lib/nav';

// The car keeps moving along the route while GPS is lost — the A6 tunnels (2026-11-20).
// DISPLAY ONLY: the estimate is never sent anywhere (dispatch, taximeter and the server keep
// only real fixes) and the screen marks it as approximate («нет GPS» / faded car), so a
// simulated position is never passed off as real tracking. A real fix that comes back glides
// the car to it instead of jumping.
export interface DrResult { pos: LatLng | null; heading: number | null; estimated: boolean; capped: boolean }

export function useDeadReckoning(o: {
  fix: LatLng | null;           // latest REAL position
  fixKey: unknown;               // changes with every new real fix (driver: the fix object; passenger: sampledAt)
  path: [number, number][] | null; // route as [lat, lng]
  startMs: number;              // no new fix for this long → estimate
}): DrResult {
  const { fix, fixKey, path, startMs } = o;
  const cum = useMemo(() => (path && path.length > 1 ? cumulative(path) : null), [path]);
  const [now, setNow] = useState(() => Date.now());
  const fixAt = useRef<number>(Date.now());
  const hist = useRef<{ p: LatLng; t: number }[]>([]);
  const speed = useRef<number | null>(null);
  const last = useRef<{ pos: LatLng; estimated: boolean } | null>(null);
  const glide = useRef<{ from: LatLng; at: number } | null>(null);

  // A new real fix: remember when, update the speed, glide in from where the car was drawn.
  useEffect(() => {
    if (!fix) { hist.current = []; speed.current = null; return; }
    const t = Date.now();
    fixAt.current = t;
    const h = [...hist.current.filter((s) => t - s.t <= 20_000), { p: fix, t }];
    hist.current = h.slice(-6);
    const first = h.find((s) => t - s.t >= 1500 && t - s.t <= 15_000);
    if (first) {
      const kmh = (distM(first.p, fix) / ((t - first.t) / 1000)) * 3.6;
      speed.current = speed.current == null ? kmh : speed.current * 0.5 + kmh * 0.5;
    }
    const prev = last.current;
    if (prev) {
      const gap = distM(prev.pos, fix);
      glide.current = (prev.estimated && gap < 2500) || (gap > 25 && gap < 400) ? { from: prev.pos, at: t } : null;
    }
    setNow(t);
    // fixKey, not fix: a re-render with the same coordinates is not a new fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixKey]);

  // Tick while there is a car to draw (4×/s: smooth enough, cheap).
  const hasFix = !!fix;
  useEffect(() => {
    if (!hasFix) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [hasFix]);

  let out: DrResult = { pos: fix, heading: null, estimated: false, capped: false };
  if (fix && path && cum) {
    const prog = locate(path, cum, fix);
    const age = now - fixAt.current;
    const est = prog ? deadReckon({ path, cum, fromAlongM: prog.alongM, offRouteM: prog.offRouteM, speedKmh: speed.current, ageMs: age, startMs }) : null;
    if (est) out = { pos: est.point, heading: est.bearing, estimated: true, capped: est.capped };
  }
  // Glide from the previously drawn point to the new real fix.
  const g = glide.current;
  if (g && out.pos && !out.estimated) {
    const k = (now - g.at) / DR.glideMs;
    if (k < 1) out = { ...out, pos: { lat: g.from.lat + (out.pos.lat - g.from.lat) * k, lng: g.from.lng + (out.pos.lng - g.from.lng) * k } };
    else glide.current = null;
  }
  last.current = out.pos ? { pos: out.pos, estimated: out.estimated } : null;
  return out;
}
