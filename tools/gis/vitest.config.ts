import { defineConfig } from 'vitest/config';

// real.test.ts reads the multi-GB external store (whole ZIPs/GeoJSON in memory), so it only runs
// when explicitly requested via `pnpm test:real`, and then in a single worker.
const real = process.env.GTEKI_GIS_REAL === '1';

export default defineConfig({
  test: {
    include: real ? ['test/real.test.ts'] : ['test/**/*.test.ts'],
    exclude: real ? [] : ['test/real.test.ts'],
    maxWorkers: real ? 1 : '50%',
    fileParallelism: !real,
    testTimeout: 10_000,
    watch: false,
  },
});
