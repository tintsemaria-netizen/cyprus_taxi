// Centralized brand configuration. The visible product name is EXACTLY "IL-Yas"
// (uppercase I, uppercase L, hyphen, uppercase Y, lowercase a, s). Repository,
// domain, API paths, DB names, cookies and secrets are intentionally unchanged —
// this is a visible rebrand only.
export const BRAND = {
  name: 'IL-Yas',
  tagline: 'Book and track a ride across Cyprus.',
  colors: {
    charcoal: '#10191C',
    surface: '#1D282D',
    lime: '#C8FF46',
    text: '#F4F7F5',
  },
} as const;
