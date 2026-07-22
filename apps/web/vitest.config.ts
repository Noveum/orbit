import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    css: false,
    server: {
      deps: {
        inline: [/@orbit\//],
      },
    },
  },
});
