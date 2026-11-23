import { isFixedPrice } from '@/lib/price-type';

// The ride's amount once the driver pressed «Завершить» (operator 2026-11-24): the sum he was shown to
// collect — fixed price or the app's fare — PLUS the recorded waiting (pickup + stop). It is fixed at
// completion and goes on unchanged to the receipt, the ride history, the driver's earnings / today card /
// analytics / trip list, the admin's per-driver view and the bookkeeping. A driver's later correction in the
// trip details (a meter ride only) replaces it everywhere. ONE rule — do not rebuild it elsewhere.
export interface CompletedFare { priceType: string | null; estimateCents: number | null; waitingCents: number; finalCents: number | null }

export function completedTotalCents(fare: CompletedFare, correctionCents?: number | null): number | null {
  if (correctionCents != null && !isFixedPrice(fare.priceType)) return correctionCents;
  const base = isFixedPrice(fare.priceType) ? fare.finalCents : fare.estimateCents;
  return base != null ? base + fare.waitingCents : null;
}
