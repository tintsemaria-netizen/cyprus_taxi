'use client';
import { useT } from '@/i18n/I18nProvider';
// The client's rating from drivers, shown next to the name on the driver's cards (operator 2026-11-26): offer, free
// orders, pre-bookings, the trip screen.
export type PaxRatingValue = { average: number; count: number } | null | undefined;

// Always shown next to the client's name (2026-11-26, operator «она должна быть везде»): no ratings yet → «★ новый».
export function PaxRating({ r, className = '' }: { r: PaxRatingValue; className?: string }) {
  const { t } = useT();
  if (!r || r.count <= 0) return <span className={`whitespace-nowrap text-muted ${className}`} data-testid="pax-rating">★ {t('driver.offer.newClient')}</span>;
  return <span className={`whitespace-nowrap font-semibold text-accent ${className}`} data-testid="pax-rating">★ {r.average.toFixed(1)}</span>;
}
