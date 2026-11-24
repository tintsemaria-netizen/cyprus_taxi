import { getSettings } from '@/lib/settings';
import { config } from '@/lib/config';
import { approxLegMin, shareZone } from '@/lib/share';
import { nicosiaMidnightUtc } from '@/lib/timezone';
import { openRides } from '@/server/share-board';
import { fitPair } from '@/server/share';
import type { LatLng } from '@/lib/geo';

// «Попутчик» departure hours (2026-11-24, operator): the passenger picks a departure HOUR (13:00, 14:00 … —
// the step is an admin setting, 1 h by default). The car comes between 13:00 and 13:15 (two pickups need a
// few minutes). Under each hour: the orders already there on the same route, the people in each, and —
// for each — when THIS passenger would arrive riding with them («с ним прибудете ≈ 14:14»). Counts and
// times only; never a name or an address.

const MIN = 60_000;
/** The car comes within this many minutes after the chosen hour. */
export const DEPART_SPAN_MIN = 15;
const hhmm = (minOfDay: number) => `${String(Math.floor(minOfDay / 60) % 24).padStart(2, '0')}:${String(minOfDay % 60).padStart(2, '0')}`;

export interface SlotOrder { people: number; /** When I'd arrive riding with this order; null = doesn't fit my route / car. */ myArrive: string | null }
export interface ShareSlot { at: string; orders: SlotOrder[] }

export async function shareSlots(day: string, pickup: LatLng, dropoff: LatLng, me: { people: number; vClass: 'COMFORT' | 'XL' } = { people: 1, vClass: 'COMFORT' }, now: Date = new Date()): Promise<{ slotMinutes: number; spanMinutes: number; slots: ShareSlot[] }> {
  const slotMinutes = (await getSettings()).shareSlotMinutes || 60;
  const from = shareZone(pickup), to = shareZone(dropoff);
  const midnight = nicosiaMidnightUtc(day);
  const slots: ShareSlot[] = [];
  for (let m = 0; m < 24 * 60; m += slotMinutes) slots.push({ at: hhmm(m), orders: [] });
  if (!from || !to || from === to) return { slotMinutes, spanMinutes: DEPART_SPAN_MIN, slots };
  const dayEnd = new Date(midnight.getTime() + 26 * 60 * MIN); // a DST day can be 25 h
  const rides = await openRides(now, { scheduledAt: { gt: midnight, lt: new Date(dayEnd.getTime() + 3 * 60 * MIN) } });
  for (const r of rides) {
    if (shareZone({ lat: r.pickupLat, lng: r.pickupLng }) !== from || shareZone({ lat: r.dropoffLat, lng: r.dropoffLng }) !== to) continue;
    // Its earliest pickup decides the hour it sits in.
    const start = r.scheduledAt!.getTime() - (r.shareEarlyMin ?? 0) * MIN;
    const idx = Math.floor((start - midnight.getTime()) / (slotMinutes * MIN));
    if (idx < 0 || idx >= slots.length) continue;
    // Me, picked up between this hour and +DEPART_SPAN_MIN.
    const slotAt = midnight.getTime() + idx * slotMinutes * MIN;
    const mine = {
      id: 'me', status: 'REQUESTED', vClass: me.vClass, shareOptIn: true, shareMaxExtraMin: config.share.termsMaxExtraMin, fareCents: 1, priceType: null,
      passengerCount: me.people, childCount: 0, luggageCount: 0, pickupLat: pickup.lat, pickupLng: pickup.lng, dropoffLat: dropoff.lat, dropoffLng: dropoff.lng,
      stopLat: null, scheduledAt: new Date(slotAt + DEPART_SPAN_MIN * MIN), passengerId: null, shareWaitMin: 0, shareEarlyMin: DEPART_SPAN_MIN, arriveFrom: null, arriveBy: null,
    };
    let myArrive: string | null = null;
    const roomy = r.vClass === me.vClass && r.passengerCount + me.people <= (me.vClass === 'XL' ? 6 : 4);
    const f = roomy ? fitPair(mine as unknown as typeof r, r, approxLegMin) : null;
    if (f) myArrive = new Date(f.timing.startAt.getTime() + (f.host.id === 'me' ? f.plan.arrive.host : f.plan.arrive.guest) * MIN).toISOString();
    slots[idx].orders.push({ people: r.passengerCount, myArrive });
  }
  return { slotMinutes, spanMinutes: DEPART_SPAN_MIN, slots };
}
