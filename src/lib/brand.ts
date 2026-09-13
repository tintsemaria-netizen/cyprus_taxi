// Centralized brand configuration. The visible product name is EXACTLY "IL-Y"
// (uppercase I, uppercase L, hyphen, uppercase Y) — matching the il-y.taxi domain
// and the approved logo kit. Repository, API paths, DB names, cookies and secrets
// are intentionally unchanged — this is a visible rebrand only.
export const BRAND = {
  name: 'IL-Y',
  tagline: 'Book and track a ride across Cyprus.',
  colors: {
    charcoal: '#10191C',
    surface: '#1D282D',
    lime: '#C8FF46',
    text: '#F4F7F5',
  },
} as const;
