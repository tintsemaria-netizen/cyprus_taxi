'use client';
import { BRAND_PIN_SVG } from '@/components/carMarker';

// The IL-Y logo standing in the middle of a map (2026-11-25, operator: «везде как на главном»): while the map
// is being moved it rises 10 px and a small shadow shows on the spot under it; let go — it comes down.
// One component for the start screen and both «на карте» pickers (MapLibre + Google).
export default function LiftPin({ lift, svg = BRAND_PIN_SVG, shake = false, red = false }: { lift: boolean; svg?: string; shake?: boolean; red?: boolean }) {
  return (
    <div className="relative h-full w-full" data-lift={lift ? '1' : undefined}>
      <div className="h-full w-full transition-transform duration-150" style={{ transform: lift ? 'translateY(-10px)' : 'none', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.55))' }}>
        <div className={`h-full w-full ${shake ? 'ily-pin-shake' : ''}`} dangerouslySetInnerHTML={{ __html: svg }} data-red={red ? '1' : undefined} />
      </div>
      <div className={`absolute left-1/2 top-full h-1.5 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/40 transition-opacity ${lift ? 'opacity-100' : 'opacity-0'}`} />
    </div>
  );
}
