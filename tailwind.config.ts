import type { Config } from 'tailwindcss';

const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // IL-Yas brand palette (Task 007): charcoal / surface / lime / off-white.
        // 2026-11-19: neutrals + status colours are CSS variables (globals.css) so <html data-theme="light">
        // swaps the whole app to the light palette. Lime accent stays the same in both themes.
        page: v('page'),
        panel: v('panel'),
        elevated: v('elevated'),
        edge: v('edge'),
        // Input borders: ≥3:1 against elevated + panel (WCAG 1.4.11 non-text contrast).
        'edge-strong': v('edge-strong'),
        accent: '#C8FF46',
        'accent-dim': '#AEE23A',
        ink: v('ink'),
        muted: v('muted'),
        danger: v('danger'),
        warn: v('warn'),
        ok: v('ok'),
      },
      // Lime text is unreadable on white: text-accent uses a deeper green in the light theme.
      textColor: { accent: v('accent-text') },
      borderRadius: {
        DEFAULT: '12px',
        lg: '16px',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.25)',
      },
    },
  },
  plugins: [],
};

export default config;
