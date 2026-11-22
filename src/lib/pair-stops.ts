// Ride-share pair on the driver's live navigation (2026-11-22): all four stops of the pair in the
// order the trip runs, which are done, and which one is next. The navigation follows this order,
// so a co-rider's pickup or drop-off that comes before the primary passenger's destination is
// driven to in the app (not only through the «👥» pill and Google Maps).

export type PlanStep = { kind: 'pickup' | 'dropoff'; who: 'host' | 'guest' };

export interface PairBooking {
  id: string; status: string; passengerName: string;
  pickupLat: number; pickupLng: number; pickupLabel: string;
  dropoffLat: number; dropoffLng: number; dropoffLabel: string;
}

export interface PairStop {
  n: number; kind: 'pickup' | 'dropoff';
  /** The stop belongs to the primary trip (the one the main sheet acts on). */
  primary: boolean;
  bookingId: string; status: string; name: string;
  lat: number; lng: number; label: string; done: boolean;
  /** Road minutes from this stop to the next one (operator, 2026-11-23: the driver needs these, not «быть на месте»). */
  toNextMin?: number | null;
}

export interface PairStops { stops: PairStop[]; next: number | null }

const PICKED_UP = new Set(['IN_PROGRESS', 'COMPLETED', 'CANCELED', 'NO_DRIVER']);
const DROPPED = new Set(['COMPLETED', 'CANCELED', 'NO_DRIVER']);

export function pairStops(plan: PlanStep[], host: PairBooking, guest: PairBooking, primaryBookingId: string): PairStops {
  const stops = plan.map((st, i): PairStop => {
    const b = st.who === 'host' ? host : guest;
    const pickup = st.kind === 'pickup';
    return {
      n: i + 1, kind: st.kind, primary: b.id === primaryBookingId,
      bookingId: b.id, status: b.status, name: b.passengerName,
      lat: pickup ? b.pickupLat : b.dropoffLat, lng: pickup ? b.pickupLng : b.dropoffLng,
      label: pickup ? b.pickupLabel : b.dropoffLabel,
      done: (pickup ? PICKED_UP : DROPPED).has(b.status),
    };
  });
  const i = stops.findIndex((s) => !s.done);
  return { stops, next: i < 0 ? null : i };
}

/** The co-rider's stop when it is the next one to drive to; otherwise null (the primary trip leads). */
export function coRiderNext(p: PairStops | null | undefined): PairStop | null {
  if (!p || p.next == null) return null;
  const s = p.stops[p.next];
  return s.primary ? null : s;
}
