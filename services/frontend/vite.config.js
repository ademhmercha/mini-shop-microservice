import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// En développement hors Docker, les appels /api/* sont redirigés vers les services locaux (préfixe retiré, comme Nginx).
const proxy = (port) => ({
  target: `http://localhost:${port}`,
  rewrite: (path) => path.replace(/^\/api\/[a-z]+/, '') || '/',
});

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/auth': proxy(3001),
      '/api/catalog': proxy(3002),
      '/api/cart': proxy(3003),
      '/api/orders': proxy(3004),
    },
  },
  build: { sourcemap: false, target: 'es2022' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    testTimeout: 30000,
    include: ['test/**/*.test.{js,jsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx', 'src/illustrations/**'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80, statements: 80, functions: 70, branches: 70 },
    },
  },
});
