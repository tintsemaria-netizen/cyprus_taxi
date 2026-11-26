'use client';

// Pieces of an order card shared by every driver screen with an order (2026-11-26/27, operator «на всех как на
// новом заказе»): new order, next order, free orders, pre-bookings.
// When a pre-booking's time comes (2026-11-27, operator): his own pre-booking shows on the trip screen in violet;
// a pre-booking nobody took, now offered to drivers by the system, shows in orange. In the lists — our lime.
export const PREBOOK_FREE_COLOR = '#FFA94D';
export const PREBOOK_MINE_COLOR = '#A78BFA';

import { useT, type MsgKey } from '@/i18n/I18nProvider';
import { PaxRating, type PaxRatingValue } from '@/components/driver/PaxRating';
import { Postcode } from '@/components/driver/Postcode';

/** The client: name, ★ rating and the class next to it (2026-11-26, operator). */
export function ClientLine({ name, rating, vClass }: { name: string; rating?: PaxRatingValue; vClass: string }) {
  const { t } = useT();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="client-line">
      {name && <span className="text-[17px] font-semibold">{name}</span>}
      <PaxRating r={rating} />
      <span className="shrink-0 rounded-md border-2 border-white/25 px-1.5 py-px text-[12px] font-bold uppercase tracking-wide text-ink/80">{t(`common.vClass.${vClass}` as MsgKey)}</span>
    </div>
  );
}

/** Where from, and under it where to (and a stop between), with the line joining them — in the frame (2026-11-26, operator). */
export function RouteLines({ pickup, stop, dropoff }: { pickup: { label: string }; stop?: { label: string } | null; dropoff: { label: string; postcode?: string | null } }) {
  return (
    <div className="mt-2 rounded-[12px] border border-edge bg-elevated p-3 text-sm" data-testid="route-lines">
      <div className="flex items-start gap-2.5"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-accent" /><span className="font-medium">{pickup.label}</span></div>
      {stop && <div className="flex items-start gap-2.5"><span className="ms-[3px] h-4 w-px shrink-0 bg-edge-strong" /></div>}
      {stop && <div className="flex items-start gap-2.5"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#FFC83D]" /><span className="font-medium">{stop.label}</span></div>}
      <div className="flex items-start gap-2.5"><span className="ms-[4px] h-4 w-px shrink-0 bg-edge-strong" /></div>
      <div className="flex items-start gap-2.5"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-ink" /><span className="font-medium">{dropoff.label}<Postcode code={dropoff.postcode} /></span></div>
    </div>
  );
}

