import { getSettings } from '@/lib/settings';
import { shareZone } from '@/lib/share';
import { nicosiaMidnightUtc } from '@/lib/timezone';
import { openRides } from '@/server/share-board';
import type { LatLng } from '@/lib/geo';

// «Попутчик» arrival windows (2026-11-24, operator): instead of typing his own «с … до …», the passenger picks
// one of OUR windows (1 h by default, admin «Настройки») — so people going the same way land in the same
// window and find each other. Next to each window: how many orders already wait there and how many people
// in each. Counts only; never a name, an address or a time inside the window.

const MIN = 60_000;
const hhmm = (minOfDay: number) => `${String(Math.floor(minOfDay / 60) % 24).padStart(2, '0')}:${String(minOfDay % 60).padStart(2, '0')}`;

export interface ShareSlot { from: string; to: string; orders: number[] }

export async function shareSlots(day: string, pickup: LatLng, dropoff: LatLng, now: Date = new Date()): Promise<{ slotMinutes: number; slots: ShareSlot[] }> {
  const slotMinutes = (await getSettings()).shareSlotMinutes || 60;
  const from = shareZone(pickup), to = shareZone(dropoff);
  const midnight = nicosiaMidnightUtc(day);
  const slots: ShareSlot[] = [];
  for (let m = 0; m + slotMinutes <= 24 * 60; m += slotMinutes) slots.push({ from: hhmm(m), to: m + slotMinutes >= 24 * 60 ? '23:59' : hhmm(m + slotMinutes), orders: [] });
  if (!from || !to || from === to) return { slotMinutes, slots };
  const dayEnd = new Date(midnight.getTime() + 26 * 60 * MIN); // a DST day can be 25 h
  const rides = await openRides(now, { arriveBy: { gt: midnight }, arriveFrom: { lt: dayEnd } });
  for (const r of rides) {
    if (shareZone({ lat: r.pickupLat, lng: r.pickupLng }) !== from || shareZone({ lat: r.dropoffLat, lng: r.dropoffLng }) !== to) continue;
    if (!r.arriveFrom || !r.arriveBy) continue;
    // The window it sits in: the one holding the middle of its own window.
    const mid = (r.arriveFrom.getTime() + r.arriveBy.getTime()) / 2;
    const idx = Math.floor((mid - midnight.getTime()) / (slotMinutes * MIN));
    if (idx >= 0 && idx < slots.length) slots[idx].orders.push(r.passengerCount);
  }
  return { slotMinutes, slots };
}
