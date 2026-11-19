import { prisma } from '@/lib/db';
import { haversineMeters, type LatLng } from '@/lib/geo';
import { approxLegMin } from '@/lib/share';
import { googleConfigured, googleRoute } from '@/server/google';

// Pre-booked ride-share pair, driver's detail (2026-11-19, operator): the whole trip in stop order
// on the map, and per stop who is picked up / dropped off, an APPROXIMATE address (street level,
// position rounded ~150 m — exact addresses open with the ride), people / children / suitcases,
// the planned time and that passenger's price, plus time and kilometres to the next stop; totals
// for the pair (people, suitcases, km, minutes, extra minutes, sum).

export interface PairStop {
  n: number; kind: 'pickup' | 'dropoff'; who: 'host' | 'guest'; passenger: 1 | 2;
  label: string; lat: number; lng: number; at: string | null;
  adults: number; children: number; luggage: number; fareCents: number | null;
  toNext: { min: number; km: number } | null;
}
export interface PairDetail {
  stops: PairStop[];
  totals: { passengers: number; children: number; luggage: number; km: number; min: number; extraMin: number; fareCents: number };
  path: [number, number][]; // [lat, lng] — the whole trip through all stops
  roadRouted: boolean;
}

/** «Lisandrou 2, Lemesos 3066, Cyprus» → «Lisandrou, Lemesos 3066»: no house number, no country. */
export function approxLabel(label: string): string {
  const parts = label.split(',').map((p) => p.trim()).filter(Boolean);
  const out = parts
    .filter((p, i) => !(i === parts.length - 1 && /^(cyprus|κύπρος|кипр)$/i.test(p)))
    .map((p, i) => (i === 0 ? p.replace(/^\d+[A-Za-z]?\s+/, '').replace(/\s+\d+[A-Za-z]?(-\d+)?$/, '') : p));
  return out.join(', ') || label;
}
const fuzz = (v: number) => Math.round(v / 0.0015) * 0.0015; // ~150 m grid: "the next street", not the door

const legCache = new Map<string, { min: number; km: number; path: [number, number][]; at: number; routed: boolean }>();

async function leg(a: LatLng, b: LatLng, when: Date | null) {
  const key = `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}|${when ? Math.round(when.getTime() / 900_000) : 'now'}`;
  const c = legCache.get(key);
  if (c && Date.now() - c.at < 10 * 60_000) return c;
  let v = { min: approxLegMin(a, b), km: Math.round((haversineMeters(a, b) / 1000) * 1.3 * 10) / 10, path: [[a.lat, a.lng], [b.lat, b.lng]] as [number, number][], at: Date.now(), routed: false };
  if (googleConfigured()) {
    try {
      const r = await googleRoute(a, b, when && when.getTime() > Date.now() ? when.toISOString() : undefined, { timeoutMs: 2500 });
      if (r) v = { min: r.etaMinutes, km: Math.round(r.distanceKm * 10) / 10, path: r.path ?? v.path, at: Date.now(), routed: true };
    } catch { /* keep the estimate */ }
  }
  legCache.set(key, v);
  if (legCache.size > 2000) legCache.clear();
  return v;
}

export async function pairDetail(bookingId: string): Promise<PairDetail | null> {
  const g = await prisma.shareGroup.findFirst({
    where: { status: { in: ['MATCHED', 'ACCEPTED'] }, OR: [{ activeHostBookingId: bookingId }, { activeGuestBookingId: bookingId }] },
    include: { host: true, guest: true },
  });
  if (!g) return null;
  const plan = (g.plan as { kind: 'pickup' | 'dropoff'; who: 'host' | 'guest' }[]) ?? [];
  const arr = (g.arrivals ?? {}) as { host?: number; guest?: number; guestPickup?: number; end?: number };
  const start = g.startAt ?? g.host.scheduledAt;
  const atMin: Record<string, number | undefined> = { 'pickup:host': 0, 'pickup:guest': arr.guestPickup, 'dropoff:host': arr.host, 'dropoff:guest': arr.guest };
  const exact = plan.map((s) => {
    const b = s.who === 'host' ? g.host : g.guest;
    return s.kind === 'pickup' ? { lat: b.pickupLat, lng: b.pickupLng, label: b.pickupLabel } : { lat: b.dropoffLat, lng: b.dropoffLng, label: b.dropoffLabel };
  });
  const legs = await Promise.all(exact.slice(0, -1).map((p, i) => {
    const m = atMin[`${plan[i].kind}:${plan[i].who}`];
    return leg(p, exact[i + 1], start && m != null ? new Date(start.getTime() + m * 60_000) : start);
  }));
  const stops: PairStop[] = plan.map((s, i) => {
    const b = s.who === 'host' ? g.host : g.guest;
    const m = atMin[`${s.kind}:${s.who}`];
    return {
      n: i + 1, kind: s.kind, who: s.who, passenger: s.who === 'host' ? 1 : 2,
      label: approxLabel(exact[i].label), lat: fuzz(exact[i].lat), lng: fuzz(exact[i].lng),
      at: start && m != null ? new Date(start.getTime() + m * 60_000).toISOString() : null,
      adults: b.passengerCount - b.childCount, children: b.childCount, luggage: b.luggageCount,
      fareCents: s.kind === 'pickup' ? (s.who === 'host' ? g.hostCents : g.guestCents) : null,
      toNext: legs[i] ? { min: legs[i].min, km: legs[i].km } : null,
    };
  });
  // The map shows the whole trip; the very start/end of each road path is near the exact door, so
  // trim a few points at each stop to keep the addresses approximate.
  const path = legs.flatMap((l) => (l.path.length > 6 ? l.path.slice(2, -2) : l.path));
  return {
    stops,
    totals: {
      passengers: g.host.passengerCount + g.guest.passengerCount, children: g.host.childCount + g.guest.childCount,
      luggage: g.host.luggageCount + g.guest.luggageCount,
      km: Math.round(legs.reduce((a, l) => a + l.km, 0) * 10) / 10,
      min: legs.reduce((a, l) => a + l.min, 0), extraMin: g.extraMinDriver, fareCents: g.hostCents + g.guestCents,
    },
    path,
    roadRouted: legs.every((l) => l.routed),
  };
}
