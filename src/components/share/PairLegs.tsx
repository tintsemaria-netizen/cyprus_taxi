'use client';
import { useT } from '@/i18n/I18nProvider';
import type { PairStops } from '@/lib/pair-stops';

// The shared ride's stops in order with the road time between them (operator, 2026-11-23):
// 1 → 2, 2 → 3, 3 → 4. The driver needs these, not the passengers' «быть на месте».
// Done stops are dimmed, the next one is highlighted.
export function PairLegs({ pair }: { pair: PairStops }) {
  const { t } = useT();
  return (
    <div className="mt-2 rounded-[12px] border border-edge bg-elevated/60 px-3 py-2 text-sm" data-testid="pair-legs">
      {pair.stops.map((s, i) => {
        const next = pair.next === i;
        return (
          <div key={s.n}>
            <div className={`flex items-center gap-2 ${s.done ? 'opacity-45' : ''}`}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${next ? 'bg-accent text-[#0d1608]' : 'bg-edge-strong text-ink'}`}>{s.done ? '✓' : s.n}</span>
              <span className={`truncate ${next ? 'font-bold' : 'font-medium'}`}>
                {s.kind === 'pickup' ? t('share.driver.pair.pickupWord') : t('share.driver.pair.dropoffWord')} · {s.name}
              </span>
            </div>
            {i < pair.stops.length - 1 && (
              <div className={`ms-[11px] border-s-2 border-dashed border-edge-strong py-1 ps-4 text-xs font-semibold ${s.done && pair.stops[i + 1].done ? 'text-muted opacity-45' : 'text-accent'}`} data-testid="pair-leg">
                ↓ {s.toNextMin != null ? t('share.driver.pair.legMin', { min: s.toNextMin }) : '…'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
