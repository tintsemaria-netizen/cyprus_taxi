// ESLint (flat config) — Next.js core-web-vitals + TypeScript rules. Run: npm run lint (also in CI;
// since Next 16, `next build` no longer lints).
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'tests-e2e/**', 'Taxi-Cyprus-Claude-Repo-Package/**', 'next-env.d.ts', 'deploy/**', 'public/sw.js'] },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Deliberate: booking, tracking, driver and staff screens are separate client apps with
      // long-running effects (GPS watch, offer/ride polling, wake lock). Crossing between them
      // with a full page load guarantees those effects are torn down; next/link would keep them.
      '@next/next/no-html-link-for-pages': 'off',
      // Leading underscore = intentionally unused (kept for API symmetry / documentation).
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // New in eslint-plugin-react-hooks 6 (shipped with eslint-config-next 16), aimed at the React
      // Compiler. Existing, working patterns (load-on-mount effects, imperative Google Maps marker
      // mutation, ref reads for polling) trip them; refactoring ~35 sites incl. GPS/offer polling is
      // tracked separately rather than folded into the framework upgrade. Kept visible as warnings.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
];
export default config;
