import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // IL-Yas brand palette (Task 007): charcoal / surface / lime / off-white.
        page: '#10191C',
        panel: '#1D282D',
        elevated: '#26333A',
        edge: '#33424A',
        accent: '#C8FF46',
        'accent-dim': '#AEE23A',
        ink: '#F4F7F5',
        muted: '#9FB0B6',
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
