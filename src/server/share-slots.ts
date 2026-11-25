import { getSettings } from '@/lib/settings';
import { config } from '@/lib/config';
import { shareFits, shareZone } from '@/lib/share';
import { nicosiaMidnightUtc } from '@/lib/timezone';
import { openRides } from '@/server/share-board';
import { fitPair, planWithRoads } from '@/server/share';
import type { LatLng } from '@/lib/geo';

// «Попутчик» departure hours (2026-11-24/25, operator): the passenger picks a departure HOUR (step = admin setting,
// 1 h by default); the car comes within 15 min of it. Under each hour: the orders already there on the same
// route, the people in each, and when THIS passenger would arrive riding with each — road times with the traffic
// expected then. He picks the one he rides with; one he can't ride with (time / detour / room) can't be picked.
// Counts and times only; never a name or an address.

const MIN = 60_000;
/** The car comes within this many minutes after the chosen hour. */
export const DEPART_SPAN_MIN = 15;
const hhmm = (minOfDay: number) => `${String(Math.floor(minOfDay / 60) % 24).padStart(2, '0')}:${String(minOfDay % 60).padStart(2, '0')}`;

export interface SlotOrder {
  /** The order's booking id — to ride with it. */
  id: string;
  people: number;
  /** When I'd arrive riding with this order (road times with traffic); null = can't ride together. */
  myArrive: string | null;
  /** Why not: no room in one car, or the times / detour don't fit. */
  why?: 'ROOM' | 'TIME';
}
export interface ShareSlot { at: string; orders: SlotOrder[] }

export async function shareSlots(day: string, pickup: LatLng, dropoff: LatLng, me: { people: number; bags?: number; vClass: 'COMFORT' | 'XL' } = { people: 1, vClass: 'COMFORT' }, now: Date = new Date()): Promise<{ slotMinutes: number; spanMinutes: number; slots: ShareSlot[] }> {
  const settings = await getSettings();
  const slotMinutes = settings.shareSlotMinutes || 60;
  const from = shareZone(pickup), to = shareZone(dropoff);
  const midnight = nicosiaMidnightUtc(day);
  const slots: ShareSlot[] = [];
  for (let m = 0; m < 24 * 60; m += slotMinutes) slots.push({ at: hhmm(m), orders: [] });
  if (!from || !to || from === to) return { slotMinutes, spanMinutes: DEPART_SPAN_MIN, slots };
  const dayEnd = new Date(midnight.getTime() + 26 * 60 * MIN); // a DST day can be 25 h
  const rides = await openRides(now, { scheduledAt: { gt: midnight, lt: new Date(dayEnd.getTime() + 3 * 60 * MIN) } });
  const seats = settings.classes.find((c) => c.key === me.vClass)?.maxPassengers ?? 4;
  for (const r of rides) {
    // Old -30% bookings made before the terms are not paired automatically — board only, not promised here.
    if (!r.shareTermsVersion) continue;
    if (shareZone({ lat: r.pickupLat, lng: r.pickupLng }) !== from || shareZone({ lat: r.dropoffLat, lng: r.dropoffLng }) !== to) continue;
    // Its earliest pickup decides the hour it sits in.
    const start = r.scheduledAt!.getTime() - (r.shareEarlyMin ?? 0) * MIN;
    const idx = Math.floor((start - midnight.getTime()) / (slotMinutes * MIN));
    if (idx < 0 || idx >= slots.length) continue;
    // Me, picked up between this hour and +DEPART_SPAN_MIN.
    const slotAt = midnight.getTime() + idx * slotMinutes * MIN;
    const mine = {
      id: 'me', status: 'REQUESTED', vClass: me.vClass, shareOptIn: true, shareMaxExtraMin: config.share.termsMaxExtraMin, fareCents: 1, priceType: null,
      passengerCount: me.people, childCount: 0, luggageCount: me.bags ?? 0, pickupLat: pickup.lat, pickupLng: pickup.lng, dropoffLat: dropoff.lat, dropoffLng: dropoff.lng,
      stopLat: null, scheduledAt: new Date(slotAt + DEPART_SPAN_MIN * MIN), passengerId: null, shareWaitMin: 0, shareEarlyMin: DEPART_SPAN_MIN, arriveFrom: null, arriveBy: null,
    } as unknown as typeof r;
    if (r.vClass !== me.vClass || !shareFits(mine, r, seats, config.share.luggage[me.vClass])) { slots[idx].orders.push({ id: r.id, people: r.passengerCount, myArrive: null, why: 'ROOM' }); continue; }
    // The plan with road times and the traffic expected at that hour (straight line when Google is off).
    const { result: f } = await planWithRoads((leg) => fitPair(mine, r, leg), new Date(slotAt));
    const myArrive = f ? new Date(f.timing.startAt.getTime() + (f.host.id === 'me' ? f.plan.arrive.host : f.plan.arrive.guest) * MIN).toISOString() : null;
    slots[idx].orders.push({ id: r.id, people: r.passengerCount, myArrive, ...(myArrive ? {} : { why: 'TIME' as const }) });
  }
  return { slotMinutes, spanMinutes: DEPART_SPAN_MIN, slots };
}
