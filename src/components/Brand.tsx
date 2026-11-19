import { BRAND } from '@/lib/brand';

/* eslint-disable @next/next/no-img-element */
// Approved IL-Y identity: lime map pin with a charcoal Y-shaped road (see
// public/brand, README-CLAUDE). Assets are self-contained SVGs — used directly.

// Standalone pin for small controls / app-icon contexts. Decorative by default.
export function LogoMark({ className = 'h-7 w-7' }: { className?: string }) {
  return <img src="/brand/mark.svg" alt="" aria-hidden className={className} />;
}

// Horizontal IL-Y lockup for headers. `light` = dark lettering for light backgrounds.
// Sizing comes from `className` (set a height; width stays auto to keep proportions).
export function Logo({ className = 'h-7', light = false }: { className?: string; light?: boolean }) {
  if (light) return (
    <span className={`inline-flex items-center ${className}`} aria-label={BRAND.name}>
      <img src="/brand/logo-horizontal-dark.svg" alt="" className="h-full w-auto" />
    </span>
  );
  // Follows the app theme (2026-11-19): white lettering on dark, dark lettering on light.
  return (
    <span className={`inline-flex items-center ${className}`} aria-label={BRAND.name}>
      <img src="/brand/logo-horizontal-light.svg" alt="" className="theme-dark-only h-full w-auto" />
      <img src="/brand/logo-horizontal-dark.svg" alt="" className="theme-light-only h-full w-auto" />
    </span>
  );
}
