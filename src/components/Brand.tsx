import { BRAND } from '@/lib/brand';

// Lime Y-shaped branching-road / navigation symbol. Flat fills, crisp edges,
// recognizable at small sizes.
export function LogoMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden role="img">
      {/* branching road: single stem forking into two waypoints */}
      <path
        d="M50 86 L50 54 M50 54 L30 22 M50 54 L70 22"
        fill="none"
        stroke="#C8FF46"
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* waypoint nodes */}
      <circle cx="30" cy="20" r="7" fill="#C8FF46" />
      <circle cx="70" cy="20" r="7" fill="#C8FF46" />
      <circle cx="50" cy="88" r="6.5" fill="#C8FF46" />
    </svg>
  );
}

// Wordmark "IL-Yas". The uppercase L is drawn with a clearly visible foot; the
// rest is a strong sans wordmark. `light` renders dark text for light backgrounds.
export function Logo({ className = 'h-7', light = false }: { className?: string; light?: boolean }) {
  const text = light ? 'text-[#10191C]' : 'text-ink';
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label={BRAND.name}>
      <LogoMark className="h-7 w-7" />
      <span className={`text-lg font-extrabold tracking-tight ${text}`}>
        <span aria-hidden>IL</span>
        {/* explicit L-foot accent kept crisp via letter-spacing of the wordmark */}
        <span aria-hidden>-Yas</span>
      </span>
    </span>
  );
}
