// The client's rating from drivers, shown next to the name on the driver's cards (operator 2026-11-26): offer, free
// orders, pre-bookings, the trip screen. Nothing while the client has no ratings yet.
export type PaxRatingValue = { average: number; count: number } | null | undefined;

export function PaxRating({ r, className = '' }: { r: PaxRatingValue; className?: string }) {
  if (!r || r.count <= 0) return null;
  return <span className={`whitespace-nowrap font-semibold text-accent ${className}`} data-testid="pax-rating">★ {r.average.toFixed(1)}</span>;
}
