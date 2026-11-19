// Launch fixes §6 (2026-11-19): ONE rule for «how much did this ride cost», used by the receipt,
// the passenger's ride history, the receipt e-mail, driver earnings / analytics / trip list and the
// admin analytics. Before this, the receipt added waiting to the estimate while earnings ignored it,
// and history hid the «≈» on unconfirmed amounts.
//
// Rules (documented in docs/LAUNCH_FIXES.md §6):
//  • Fixed price (REGULATED_FIXED / UPFRONT_DYNAMIC / SHARED_FIXED): the accepted price
//    (Fare.finalCents) + the pickup waiting the app recorded (Fare.waitingCents). This is what the
//    passenger was shown live on the tracking screen. Confirmed at completion.
//    OPERATOR DECISION OPEN: whether waiting may be added to a fixed airport fare at all — if not,
//    set FIXED_PRICE_ADDS_WAITING to false (one place).
//  • Meter (REGULATED_METER_ESTIMATE): the amount the DRIVER entered from the car's taximeter
//    (latest DriverSettlement). The taximeter already counts waiting, so app waiting is NOT added
//    again (no double waiting). Until the driver enters it, the figure is the estimate + app
//    waiting and is always shown as approximate («≈»).
//  • Status: ESTIMATE (ride not finished) → AWAITING_AMOUNT (finished, meter amount not entered)
//    → AMOUNT_CONFIRMED → PAID (driver marked the payment received).
import { isFixedPrice } from '@/lib/price-type';

export const FIXED_PRICE_ADDS_WAITING = true;

export type TotalState = 'ESTIMATE' | 'AWAITING_AMOUNT' | 'AMOUNT_CONFIRMED' | 'PAID';
export interface FareTotal {
  cents: number | null;
  approx: boolean;
  state: TotalState;
  source: 'fixed' | 'meter' | 'estimate' | null;
  currency: string | null;
}
export interface FareTotalInput {
  priceType: string | null | undefined;
  completed: boolean;
  fare: { estimateCents: number | null; waitingCents: number; finalCents: number | null; currency?: string; paymentStatus?: string } | null;
  settlement: { reportedFinalCents: number; currency?: string; paymentReceived: boolean } | null;
  /** Booking.fareCents — the quoted price when there is no Fare row yet. */
  quotedCents?: number | null;
}

export function fareTotal(i: FareTotalInput): FareTotal {
  const f = i.fare;
  const currency = i.settlement?.currency ?? f?.currency ?? null;
  if (isFixedPrice(i.priceType)) {
    const base = f?.finalCents ?? (i.completed ? null : i.quotedCents ?? null);
    const cents = base == null ? null : base + (FIXED_PRICE_ADDS_WAITING ? f?.waitingCents ?? 0 : 0);
    if (!i.completed || !f) return { cents, approx: false, state: 'ESTIMATE', source: 'fixed', currency };
    return { cents, approx: false, state: f.paymentStatus === 'COLLECTED' ? 'PAID' : 'AMOUNT_CONFIRMED', source: 'fixed', currency };
  }
  if (i.completed && i.settlement) {
    return { cents: i.settlement.reportedFinalCents, approx: false, state: i.settlement.paymentReceived ? 'PAID' : 'AMOUNT_CONFIRMED', source: 'meter', currency };
  }
  const est = f ? (f.estimateCents != null ? f.estimateCents + f.waitingCents : null) : i.quotedCents ?? null;
  return { cents: est, approx: true, state: i.completed ? 'AWAITING_AMOUNT' : 'ESTIMATE', source: est == null ? null : 'estimate', currency };
}

/** Amount that counts as the driver's confirmed earnings (null = not confirmed yet, never 0). */
export function confirmedCents(t: FareTotal): number | null {
  return t.state === 'AMOUNT_CONFIRMED' || t.state === 'PAID' ? t.cents : null;
}
