import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    // DB test files share one isolated Postgres; run files sequentially in a single
    // process so their table cleanups never race across workers.
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
  },
});
