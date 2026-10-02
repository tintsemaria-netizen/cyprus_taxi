import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    // DB test files share one isolated Postgres; run files one at a time so their table cleanups
    // never race. (Vitest 4+: poolOptions.forks.singleFork → top-level maxWorkers.) Each file still
    // gets a fresh module graph (isolate), which env-dependent tests rely on.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
