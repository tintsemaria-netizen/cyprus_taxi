// ESLint (flat config) — Next.js core-web-vitals + TypeScript rules. Run: npm run lint (also in CI).
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'tests-e2e/**', 'Taxi-Cyprus-Claude-Repo-Package/**', 'next-env.d.ts', 'deploy/**', 'public/sw.js'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Deliberate: booking, tracking, driver and staff screens are separate client apps with
      // long-running effects (GPS watch, offer/ride polling, wake lock). Crossing between them
      // with a full page load guarantees those effects are torn down; next/link would keep them.
      '@next/next/no-html-link-for-pages': 'off',
      // Leading underscore = intentionally unused (kept for API symmetry / documentation).
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
export default config;
