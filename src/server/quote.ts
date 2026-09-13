import { prisma } from '@/lib/db';
import { sha256 } from '@/lib/crypto';
import { haversineMeters } from '@/lib/geo';
import { computeMeterEstimate } from '@/lib/tariff';
import { googleConfigured, googleRoute } from '@/server/google';

const QUOTE_TTL_MS = 120_000; // 2 minutes (Task 012 §6.3)

export interface QuoteInput {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  vClass: 'COMFORT' | 'XL';
  passengerCount: number;
  luggageCount?: number;
}

// Normalized hash of the meaningful inputs so a booking can re-verify the quote wasn't
// tampered with (coords rounded so sub-metre jitter doesn't invalidate it).
export function quoteRequestHash(i: QuoteInput): string {
  const r = (n: number) => n.toFixed(5);
  return sha256(JSON.stringify({
    p: [r(i.pickup.lat), r(i.pickup.lng)],
    d: [r(i.dropoff.lat), r(i.dropoff.lng)],
    c: i.vClass, n: i.passengerCount, l: i.luggageCount ?? 0,
  }));
}

export type QuoteResult =
  | { ok: true; quote: QuoteBody }
  | { ok: false; status: number; code: string; message: string };

export interface QuoteBody {
  quoteId: string;
  priceType: string;
  ruleVersion: string;
  currency: string;
  distanceMeters: number;
  durationSeconds: number;
  night: boolean;
  holiday: boolean;
  lines: { code: string; label: string; cents: number }[];
  totalCents: number;
  rangeLowCents: number;
  rangeHighCents: number;
  expiresAt: string;
  routeAvailable: boolean;
}

export async function createQuote(input: QuoteInput, at = new Date()): Promise<QuoteResult> {
  // Real road distance/duration when Google is configured; otherwise a straight-line
  // approximation clearly flagged (routeAvailable=false).
  let distanceMeters: number;
  let durationSeconds: number;
  let routeAvailable = true;
  if (googleConfigured()) {
    try {
      const r = await googleRoute(input.pickup, input.dropoff);
      if (r) {
        distanceMeters = Math.round(r.distanceKm * 1000);
        durationSeconds = r.etaMinutes * 60;
      } else {
        return { ok: false, status: 422, code: 'NO_ROUTE', message: 'No drivable route between those points.' };
      }
    } catch {
      // Routing unavailable → fall back to a flagged straight-line estimate.
      distanceMeters = Math.round(haversineMeters(input.pickup, input.dropoff) * 1.3);
      durationSeconds = Math.round((distanceMeters / 1000 / 45) * 3600);
      routeAvailable = false;
    }
  } else {
    distanceMeters = Math.round(haversineMeters(input.pickup, input.dropoff) * 1.3);
    durationSeconds = Math.round((distanceMeters / 1000 / 45) * 3600);
    routeAvailable = false;
  }

  const est = computeMeterEstimate({ distanceMeters, passengerCount: input.passengerCount, luggageCount: input.luggageCount, at });
  const requestHash = quoteRequestHash(input);
  const expiresAt = new Date(at.getTime() + QUOTE_TTL_MS);

  const row = await prisma.quote.create({
    data: {
      pickupLat: input.pickup.lat, pickupLng: input.pickup.lng,
      dropoffLat: input.dropoff.lat, dropoffLng: input.dropoff.lng,
      vClass: input.vClass, passengerCount: input.passengerCount, luggageCount: input.luggageCount ?? 0,
      distanceMeters, durationSeconds,
      priceType: est.priceType, ruleVersion: est.ruleVersion, currency: est.currency,
      totalCents: est.totalCents, rangeLowCents: est.rangeLowCents, rangeHighCents: est.rangeHighCents,
      breakdown: JSON.stringify(est.lines), requestHash, expiresAt,
    },
  });

  return {
    ok: true,
    quote: {
      quoteId: row.id, priceType: est.priceType, ruleVersion: est.ruleVersion, currency: est.currency,
      distanceMeters, durationSeconds, night: est.night, holiday: est.holiday,
      lines: est.lines, totalCents: est.totalCents, rangeLowCents: est.rangeLowCents, rangeHighCents: est.rangeHighCents,
      expiresAt: expiresAt.toISOString(), routeAvailable,
    },
  };
}

// Validate a quote for a booking: exists, matches the payload, not expired.
export async function consumeQuote(quoteId: string, input: QuoteInput): Promise<
  | { ok: true; totalCents: number; priceType: string; breakdown: string }
  | { ok: false; code: string }
> {
  const q = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!q) return { ok: false, code: 'QUOTE_NOT_FOUND' };
  if (q.expiresAt < new Date()) return { ok: false, code: 'QUOTE_EXPIRED' };
  if (q.requestHash !== quoteRequestHash(input)) return { ok: false, code: 'QUOTE_MISMATCH' };
  return { ok: true, totalCents: q.totalCents, priceType: q.priceType, breakdown: q.breakdown };
}
