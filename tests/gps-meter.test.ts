import { describe, it, expect } from 'vitest';
import { computeGpsMeter, type MeterPoint } from '@/lib/gps-meter';

// GPS taximeter (2026-11-19): like the car's urban meter — distance when moving, time when slow.
const KM_PER_DEG_LAT = 111.195; // haversine radius 6371 km
// A night start (Nicosia 01:19 = 23:19 UTC the day before, winter time) and a day start (12:00).
const NIGHT = new Date('2026-11-18T23:19:00Z');
const DAY = new Date('2026-11-19T10:00:00Z');

/** Drive north from (34.7, 33.0): `kmh` for `seconds`, a GPS point every `every` s. */
function drive(start: Date, kmh: number, seconds: number, every = 5, from = { lat: 34.7, lng: 33.0, t: 0 }): MeterPoint[] {
  const pts: MeterPoint[] = [];
  for (let s = 0; s <= seconds; s += every) {
    pts.push({ lat: from.lat + ((kmh * s) / 3600) / KM_PER_DEG_LAT, lng: from.lng, accuracyM: 8, sampledAt: new Date(start.getTime() + (from.t + s) * 1000) });
  }
  return pts;
}

describe('GPS taximeter', () => {
  it('motorway at 140 km/h: 68.4 km at night = €4.80 + 68.4 × €1.10 (speed does not change the fare)', () => {
    const secs = 1760; // 68.4 km at 140 km/h, rounded to whole 5-s GPS samples
    const m = computeGpsMeter(drive(NIGHT, 140, secs), { startedAt: NIGHT });
    expect(m.night).toBe(true);
    expect(m.totalKm).toBeCloseTo(68.4, 0);
    expect(m.slowSec).toBe(0);
    expect(Math.abs(m.totalCents - 8004)).toBeLessThan(15);
    // The same road at 70 km/h costs the same.
    const slower = computeGpsMeter(drive(NIGHT, 70, secs * 2), { startedAt: NIGHT });
    expect(Math.abs(slower.totalCents - m.totalCents)).toBeLessThan(20);
  });

  it('standing still with GPS drift is charged by time, never as kilometres', () => {
    const pts: MeterPoint[] = [];
    for (let s = 0; s <= 600; s += 5) {
      const j = ((s * 7919) % 17) - 8; // ±8 m wobble
      pts.push({ lat: 34.7 + j / 111_195, lng: 33.0 + j / 91_000, accuracyM: 12, sampledAt: new Date(DAY.getTime() + s * 1000) });
    }
    const m = computeGpsMeter(pts, { startedAt: DAY });
    expect(m.slowSec).toBe(600);
    expect(m.distanceCents).toBe(0);
    expect(m.timeCents).toBe(Math.round((600 / 3600) * 1700)); // €17/h day → €2.83
  });

  it('crawling at 10 km/h is charged by time; at 30 km/h by distance (cross-over ≈ 18 km/h by day)', () => {
    const crawl = computeGpsMeter(drive(DAY, 10, 360), { startedAt: DAY });
    expect([crawl.slowSec, crawl.distanceCents]).toEqual([360, 0]);
    const city = computeGpsMeter(drive(DAY, 30, 360), { startedAt: DAY });
    expect(city.slowSec).toBe(0);
    expect(city.distanceCents).toBe(Math.round(3 * 95));
  });

  it('a GPS jump is ignored; a gap without GPS is charged as road distance', () => {
    const pts = drive(DAY, 60, 120);
    pts.splice(10, 0, { lat: 35.5, lng: 33.0, accuracyM: 8, sampledAt: new Date(pts[9].sampledAt.getTime() + 2000) }); // 90 km away
    const m = computeGpsMeter(pts, { startedAt: DAY });
    expect(m.totalKm).toBeCloseTo(2, 1);
    // 2 minutes with no GPS on a 60 km/h road: 2 km straight → 2.4 km charged.
    const gap = drive(DAY, 60, 300).filter((p) => { const s = (p.sampledAt.getTime() - DAY.getTime()) / 1000; return s <= 60 || s >= 180; });
    const g = computeGpsMeter(gap, { startedAt: DAY });
    expect(g.gapSec).toBe(120);
    expect(g.totalKm).toBeCloseTo(5.4, 1); // 1 + 2×1.2 + 2
  });

  it('poor-accuracy points are skipped; the day/night rate follows the clock during the trip', () => {
    const pts = drive(DAY, 60, 60).map((p, i) => (i === 5 ? { ...p, accuracyM: 300, lat: p.lat + 0.01 } : p));
    expect(computeGpsMeter(pts, { startedAt: DAY }).totalKm).toBeCloseTo(1, 1);
    // Start 20:25 local (18:25 UTC), drive 20 min at 60 km/h: ~5 km day + ~15 km night.
    const s = new Date('2026-11-19T18:25:00Z');
    const m = computeGpsMeter(drive(s, 60, 1200), { startedAt: s });
    expect(m.night).toBe(false);
    expect(m.distanceCents).toBeGreaterThan(20 * 95);
    expect(m.distanceCents).toBeLessThan(20 * 110);
  });

  it('extras as in the estimate: luggage and XL', () => {
    const m = computeGpsMeter(drive(DAY, 60, 600), { startedAt: DAY, luggageCount: 2, vClass: 'XL' });
    expect(m.extrasCents).toBe(Math.round((380 + m.distanceCents) * 0.4) + 280);
  });
});
