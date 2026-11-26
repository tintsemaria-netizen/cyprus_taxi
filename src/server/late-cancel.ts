import { config } from '@/lib/config';
import { lateCancelSchedule, type LateCancel } from '@/lib/late-cancel';
import { paysByCard } from '@/lib/payment-method';

const rule = () => ({ noShowCents: config.dispatch.lateCancelFeeCents, afterPaidMin: config.dispatch.lateCancelAfterPaidMin,
  prebookCents: config.dispatch.prebookCancelFeeCents, prebookMin: config.dispatch.prebookCancelMin });

/** The late-cancel fees that can apply to this booking (card payment only) — one place for the cancel and the view. */
export function bookingLateCancels(b: { id: string; scheduledAt: Date | null; sharePickupFrom?: Date | null; arriveFrom?: Date | null },
  waiting: { arrivedAt: Date; graceSeconds: number } | null): LateCancel[] {
  // The booked pickup time: a co-rider booking's chosen hour, else the scheduled time (pre-bookings only).
  const pickupAt = b.scheduledAt ? (!b.arriveFrom && b.sharePickupFrom ? b.sharePickupFrom : b.scheduledAt) : null;
  return lateCancelSchedule({ pickupAt, waiting }, paysByCard(b), rule());
}
