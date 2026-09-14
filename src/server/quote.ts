import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { sha256 } from '@/lib/crypto';
import { haversineMeters } from '@/lib/geo';
import { computeMeterEstimate } from '@/lib/tariff';
import { computeDynamicMultiplier, dynamicSurchargeCents } from '@/lib/pricing-dynamic';
import { marketSnapshot } from '@/server/dispatch/market';
import { getWeather } from '@/server/weather';
import { googleConfigured, googleRoute } from '@/server/google';

const QUOTE_TTL_MS = 120_000; // 2 minutes (Task 012 §6.3)

export type PricingMode = 'REGULATED_METER_ESTIMATE' | 'UPFRONT_DYNAMIC';

export interface QuoteInput {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  vClass: 'COMFORT' | 'XL';
  passengerCount: number;
  luggageCount?: number;
  scheduledAtUtc?: string | null; // intended journey time (UTC ISO); null/absent = immediate
}

// Normalized hash of the meaningful inputs so a booking can re-verify the quote wasn't
// tampered with (coords rounded so sub-metre jitter doesn't invalidate it; scheduled
// time to the minute, so a changed pickup time invalidates the quote).
export function quoteRequestHash(i: QuoteInput): string {
  const r = (n: number) => n.toFixed(5);
  return sha256(JSON.stringify({
    p: [r(i.pickup.lat), r(i.pickup.lng)],
    d: [r(i.dropoff.lat), r(i.dropoff.lng)],
    c: i.vClass, n: i.passengerCount, l: i.luggageCount ?? 0,
    t: i.scheduledAtUtc ? new Date(i.scheduledAtUtc).toISOString().slice(0, 16) : null,
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
  routeSource: string; // 'traffic' | 'approx'
  pricedForAt: string | null; // journey time the price/tariff applies to (scheduled), else null
  dynamic?: { multiplier: number; applied: boolean; demandSupplyRatio: number | null; reasons: string[]; version: string };
}

export async function createQuote(input: QuoteInput, at = new Date(), mode: PricingMode = config.pricing.mode): Promise<QuoteResult> {
  // The quote is ISSUED at `at` (drives expiry). It is PRICED for the intended journey
  // time `pricingAt` (scheduled → future; else now) — day/night/holiday tariff and the
  // traffic-aware routing use pricingAt, not the moment the quote was requested.
  const pricingAt = input.scheduledAtUtc ? new Date(input.scheduledAtUtc) : at;
  const departureTime = new Date(Math.max(pricingAt.getTime(), at.getTime() + 1000)).toISOString(); // Routes needs a non-past departure

  // Real road distance/duration when Google is configured; otherwise a straight-line
  // approximation clearly flagged (routeAvailable=false).
  let distanceMeters: number;
  let durationSeconds: number;
  let routeAvailable = true;
  if (googleConfigured()) {
    try {
      const r = await googleRoute(input.pickup, input.dropoff, departureTime);
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
  const routeSource = routeAvailable ? 'traffic' : 'approx';

  const est = computeMeterEstimate({ distanceMeters, passengerCount: input.passengerCount, luggageCount: input.luggageCount, at: pricingAt });
  const requestHash = quoteRequestHash(input);
  const expiresAt = new Date(at.getTime() + QUOTE_TTL_MS);

  // Base fields default to the regulated meter estimate.
  let priceType: string = est.priceType;
  let lines = est.lines;
  let totalCents = est.totalCents;
  let rangeLowCents = est.rangeLowCents;
  let rangeHighCents = est.rangeHighCents;
  let dynamic: QuoteBody['dynamic'];

  // UPFRONT_DYNAMIC (synthetic/TEST unless a commercial rule is authorized): apply a
  // bounded demand/supply multiplier to ONLY the eligible base (initial hire + distance).
  if (mode === 'UPFRONT_DYNAMIC') {
    const [snap, weather] = await Promise.all([
      marketSnapshot(input.pickup, input.vClass).catch(() => ({ activeRequests: 0, availableDrivers: 0, radiusKm: 7 })),
      getWeather(input.pickup.lat, input.pickup.lng, at).catch(() => null),
    ]);
    const dyn = computeDynamicMultiplier(
      { activeRequests: snap.activeRequests, availableDrivers: snap.availableDrivers, weatherSeverity: weather?.severity ?? 0 },
      { maxMultiplier: config.pricing.dynamicMaxMultiplier },
    );
    const eligibleBase = est.lines.filter((l) => l.code === 'initial' || l.code === 'distance').reduce((s, l) => s + l.cents, 0);
    const surcharge = dynamicSurchargeCents(eligibleBase, dyn.multiplier);
    priceType = 'UPFRONT_DYNAMIC';
    lines = [...est.lines];
    if (surcharge > 0) {
      lines.push({ code: 'dynamic', label: `Dynamic pricing ×${dyn.multiplier.toFixed(2)} (${dyn.reasons.join(', ')})`, cents: surcharge });
    }
    totalCents = est.totalCents + surcharge;
    // An upfront fare is a committed price, not a ±band estimate.
    rangeLowCents = totalCents;
    rangeHighCents = totalCents;
    dynamic = { multiplier: dyn.multiplier, applied: dyn.applied, demandSupplyRatio: dyn.demandSupplyRatio, reasons: dyn.reasons, version: dyn.version };
    // eslint-disable-next-line no-console
    console.log(`[pricing] dynamic quote ×${dyn.multiplier} demand=${snap.activeRequests} supply=${snap.availableDrivers} weather=${weather?.severity ?? 0} reasons=${dyn.reasons.join('|')}`);
  }

  const row = await prisma.quote.create({
    data: {
      pickupLat: input.pickup.lat, pickupLng: input.pickup.lng,
      dropoffLat: input.dropoff.lat, dropoffLng: input.dropoff.lng,
      vClass: input.vClass, passengerCount: input.passengerCount, luggageCount: input.luggageCount ?? 0,
      distanceMeters, durationSeconds,
      priceType, ruleVersion: est.ruleVersion, currency: est.currency,
      totalCents, rangeLowCents, rangeHighCents,
      breakdown: JSON.stringify(lines), requestHash, expiresAt,
      pricingAt, routeSource,
    },
  });

  return {
    ok: true,
    quote: {
      quoteId: row.id, priceType, ruleVersion: est.ruleVersion, currency: est.currency,
      distanceMeters, durationSeconds, night: est.night, holiday: est.holiday,
      lines, totalCents, rangeLowCents, rangeHighCents,
      expiresAt: expiresAt.toISOString(), routeAvailable, routeSource,
      pricedForAt: input.scheduledAtUtc ? pricingAt.toISOString() : null,
      dynamic,
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
