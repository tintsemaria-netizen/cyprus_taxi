'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { haversineMeters } from '@/lib/geo';

// The street the car is on (2026-11-17), refreshed only after the car has moved ~80 m and at most
// every 8 s, so it stays cheap. null until known / when off any named road.
export function useStreetName(pos: { lat: number; lng: number } | null | undefined, enabled = true): string | null {
  const [name, setName] = useState<string | null>(null);
  const last = useRef<{ lat: number; lng: number; at: number } | null>(null);
  // Unmount guard only: a re-render while a lookup is in flight must not throw its answer away
  // (the next lookup is throttled, so the chip would stay empty — seen on the passenger page).
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const lat = pos?.lat, lng = pos?.lng;
  useEffect(() => {
    if (!enabled || lat == null || lng == null) return;
    const l = last.current;
    if (l && (Date.now() - l.at < 8000 || haversineMeters(l, { lat, lng }) < 80)) return;
    last.current = { lat, lng, at: Date.now() };
    api<{ name: string | null }>(`/places/street?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`)
      .then((r) => { if (mounted.current) setName(r.name); })
      .catch(() => { /* keep the last name */ });
  }, [lat, lng, enabled]);
  return enabled ? name : null;
}

export function StreetChip({ name, top = 'top-3' }: { name: string | null; top?: string }) {
  if (!name) return null;
  return (
    <div className={`pointer-events-none absolute inset-x-0 ${top} z-[5] flex justify-center px-16`} data-testid="street-chip">
      <span className="max-w-full truncate rounded-full border border-white/15 bg-[#10191C]/90 px-3 py-1 text-[13px] font-semibold text-ink shadow">{name}</span>
    </div>
  );
}

// Self-contained chip (own hook) so it can sit anywhere in a render tree.
export function CarStreetChip({ pos, enabled = true, top }: { pos: { lat: number; lng: number } | null | undefined; enabled?: boolean; top?: string }) {
  const name = useStreetName(pos, enabled);
  return <StreetChip name={name} top={top} />;
}
