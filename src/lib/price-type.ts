// Price types (Task 012 §6, 2026-11-17):
//  REGULATED_METER_ESTIMATE — estimate ±15 %, the taximeter is final;
//  REGULATED_FIXED          — fixed airport ↔ zone fare set by the operator in admin (final);
//  UPFRONT_DYNAMIC          — synthetic/test committed price (final).
export const FIXED_PRICE_TYPES = ['REGULATED_FIXED', 'UPFRONT_DYNAMIC'] as const;

/** The quoted amount is the final price (no taximeter settlement). */
export function isFixedPrice(priceType: string | null | undefined): boolean {
  return priceType === 'REGULATED_FIXED' || priceType === 'UPFRONT_DYNAMIC';
}

/**
 * The price as the passenger sees it (2026-11-18): a taximeter estimate is a range ±15 % (same
 * formula as the passenger quote, src/lib/tariff.ts), a fixed fare is one amount.
 */
export function fareRangeCents(cents: number, priceType: string | null | undefined): [number, number] {
  if (isFixedPrice(priceType)) return [cents, cents];
  return [Math.round(cents * 0.85), Math.round(cents * 1.15)];
}
export function fareRangeText(cents: number, priceType: string | null | undefined, money: (c: number) => string): string {
  const [lo, hi] = fareRangeCents(cents, priceType);
  return lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`;
}
