import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    testTimeout: 30000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/server.js', 'src/seed.js'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
