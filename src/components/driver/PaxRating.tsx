'use client';
// The client's rating from drivers, shown next to the name on the driver's cards (operator 2026-11-26): offer, free
// orders, pre-bookings, the trip screen.
export type PaxRatingValue = { average: number; count: number } | null | undefined;

// Always shown next to the client's name (2026-11-26, operator «она должна быть везде»): no ratings yet → ★ 5.0.
export function PaxRating({ r, className = '' }: { r: PaxRatingValue; className?: string }) {
  if (!r || r.count <= 0) return <span className={`whitespace-nowrap font-semibold text-accent ${className}`} data-testid="pax-rating">★ 5.0</span>;
  return <span className={`whitespace-nowrap font-semibold text-accent ${className}`} data-testid="pax-rating">★ {r.average.toFixed(1)}</span>;
}
