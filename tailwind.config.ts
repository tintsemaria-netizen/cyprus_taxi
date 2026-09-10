import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Approved dark graphite + lime tokens (SPEC §2)
        page: '#111719',
        panel: '#1B2226',
        elevated: '#252D31',
        edge: '#343D42',
        accent: '#C8FF52',
        'accent-dim': '#A9DE3A',
        ink: '#F5F7F6',
        muted: '#A4AFB6',
        danger: '#FF6B6B',
        warn: '#FFC857',
        ok: '#4ADE80',
      },
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
