import { haversineMeters } from '@/lib/geo';
import { TARIFF, isNightTariff, isCyprusPublicHoliday } from '@/lib/tariff';

// GPS taximeter (2026-11-19, operator: «фактический таксометр будет считать правильнее»).
// Works like a Cyprus urban taximeter, from the driver's GPS track of the trip:
//   - flag-fall (day/night by the trip's start time) + public-holiday surcharge;
//   - each stretch between two GPS points is charged EITHER by distance (€/km) OR by time (€/h
//     waiting/delay rate) — by time when the car is slower than the cross-over speed
//     (rate per hour ÷ rate per km ≈ 17–18 km/h), like a real meter in traffic or at a light;
//   - day/night rates per stretch (the tariff can change during the trip, at 20:30/06:00);
//   - luggage, 5–6-passenger and XL surcharges as in the booking estimate (computeMeterEstimate).
// GPS drift while standing is never charged as distance (it is slow → time). Glitches (jumps
// faster than 250 km/h, poor accuracy) are skipped. A gap in the track (phone asleep, no signal)
// is charged as road distance (straight line × 1.2) — or as time if that was slower than walking pace.
// All money is integer cents. An instrument for comparison — the charged price does not use it yet.

export interface MeterPoint { lat: number; lng: number; accuracyM: number; sampledAt: Date }
export interface GpsMeter {
  km: number; // charged-by-distance kilometres (+ gap estimate)
  totalKm: number; // all kilometres driven per the track
  slowSec: number; // seconds charged by time
  gapSec: number; // seconds without GPS (estimated)
  initialCents: number; distanceCents: number; timeCents: number; extrasCents: number;
  totalCents: number;
  night: boolean; // tariff at the start
  points: number;
}

const MAX_ACCURACY_M = 50;
const MAX_KMH = 250;
const GAP_SEC = 30;
const GAP_ROAD_FACTOR = 1.2;

export function computeGpsMeter(
  pts: MeterPoint[],
  opts: { startedAt: Date; luggageCount?: number; passengerCount?: number; vClass?: 'COMFORT' | 'XL' },
): GpsMeter {
  const night = isNightTariff(opts.startedAt);
  const initialCents = (night ? TARIFF.night : TARIFF.day).initialCents;
  let distExact = 0, timeExact = 0, kmCharged = 0, kmTotal = 0, slowSec = 0, gapSec = 0;
  const good = pts.filter((p) => p.accuracyM <= MAX_ACCURACY_M).sort((a, b) => a.sampledAt.getTime() - b.sampledAt.getTime());
  let prev: MeterPoint | null = null;
  for (const p of good) {
    if (!prev) { prev = p; continue; }
    const dt = (p.sampledAt.getTime() - prev.sampledAt.getTime()) / 1000;
    if (dt <= 0) continue;
    let m = haversineMeters(prev, p);
    if ((m / dt) * 3.6 > MAX_KMH) continue; // a GPS jump: keep the previous point, drop this one
    const gap = dt > GAP_SEC;
    if (gap) { m *= GAP_ROAD_FACTOR; gapSec += dt; }
    const nightSeg = isNightTariff(prev.sampledAt);
    const perKm = (nightSeg ? TARIFF.night : TARIFF.day).perKmCents;
    const perHour = nightSeg ? TARIFF.waitingPerHourCents.night : TARIFF.waitingPerHourCents.day;
    const crossoverKmh = perHour / perKm;
    const kmh = (m / dt) * 3.6;
    kmTotal += m / 1000;
    // A gap is charged by time only if even its road estimate was slower than walking pace.
    if ((gap && kmh < 5) || (!gap && kmh < crossoverKmh)) {
      timeExact += (dt / 3600) * perHour;
      slowSec += dt;
    } else {
      distExact += (m / 1000) * perKm;
      kmCharged += m / 1000;
    }
    prev = p;
  }
  const distanceCents = Math.round(distExact);
  const timeCents = Math.round(timeExact);
  // Surcharges as in the booking estimate: XL (ours) or 5–6 passengers on flag-fall + distance.
  const base = initialCents + distanceCents;
  const xl = opts.vClass === 'XL';
  const pct = xl ? TARIFF.xlPct : TARIFF.paxSurcharge(opts.passengerCount ?? 1);
  const extrasCents = Math.round(base * pct) + (opts.luggageCount ?? 0) * TARIFF.luggagePieceCents + (isCyprusPublicHoliday(opts.startedAt) ? TARIFF.holidaySurchargeCents : 0);
  return {
    km: Math.round(kmCharged * 100) / 100, totalKm: Math.round(kmTotal * 100) / 100,
    slowSec: Math.round(slowSec), gapSec: Math.round(gapSec),
    initialCents, distanceCents, timeCents, extrasCents,
    totalCents: initialCents + distanceCents + timeCents + extrasCents,
    night, points: good.length,
  };
}
