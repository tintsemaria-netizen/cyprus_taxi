// Price types (Task 012 §6, 2026-11-17):
//  REGULATED_METER_ESTIMATE — estimate ±15 %, the taximeter is final;
//  REGULATED_FIXED          — fixed airport ↔ zone fare set by the operator in admin (final);
//  UPFRONT_DYNAMIC          — synthetic/test committed price (final).
export const FIXED_PRICE_TYPES = ['REGULATED_FIXED', 'UPFRONT_DYNAMIC'] as const;

/** The quoted amount is the final price (no taximeter settlement). */
export function isFixedPrice(priceType: string | null | undefined): boolean {
  return priceType === 'REGULATED_FIXED' || priceType === 'UPFRONT_DYNAMIC';
}
