import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/isolated/**/*.test.ts',
    ],
    isolate: true,
    testTimeout: 60_000,
  },
});
