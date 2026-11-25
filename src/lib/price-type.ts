import { TARIFF } from '@/lib/tariff';
// Price types (Task 012 §6, 2026-11-17):
//  REGULATED_METER_ESTIMATE — estimate ±12 % (TARIFF.estimateBandPct), the taximeter is final;
//  REGULATED_FIXED          — fixed airport ↔ zone fare set by the operator in admin (final);
//  UPFRONT_DYNAMIC          — synthetic/test committed price (final);
//  SHARED_FIXED             — ride-share price after the co-rider discount (final, Task 022).
export const FIXED_PRICE_TYPES = ['REGULATED_FIXED', 'UPFRONT_DYNAMIC', 'SHARED_FIXED'] as const;

/** The quoted amount is the final price (no taximeter settlement). */
export function isFixedPrice(priceType: string | null | undefined): boolean {
  return priceType === 'REGULATED_FIXED' || priceType === 'UPFRONT_DYNAMIC' || priceType === 'SHARED_FIXED';
}

/**
 * The price as the passenger sees it (2026-11-18): a taximeter estimate is a range ±12 % (same
 * formula as the passenger quote, src/lib/tariff.ts), a fixed fare is one amount.
 */
export function fareRangeCents(cents: number, priceType: string | null | undefined, minCents?: number | null): [number, number] {
  if (isFixedPrice(priceType)) return [cents, cents];
  // Pre-booking minimum (2026-11-22, src/lib/prebook-min.ts): the range never goes below it.
  const m = minCents ?? 0;
  return [Math.max(m, Math.round(cents * (1 - TARIFF.estimateBandPct))), Math.max(m, Math.round(cents * (1 + TARIFF.estimateBandPct)))];
}
export function fareRangeText(cents: number, priceType: string | null | undefined, money: (c: number) => string, minCents?: number | null): string {
  const [lo, hi] = fareRangeCents(cents, priceType, minCents);
  return lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`;
}
