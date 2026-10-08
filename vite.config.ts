/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

export default defineConfig({
  plugins: [react(), svgr()],
  build: {
    rolldownOptions: {
      output: {
        // three.js and the R3F stack only load with the lazily imported 3D scene. Keep them in
        // their own long-cacheable vendor chunks, apart from the scene code that changes more often.
        codeSplitting: {
          groups: [
            // React and zustand are shared by the app shell and the scene, so they get their own
            // eagerly loaded chunk (otherwise they get pulled into the r3f group below).
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/, priority: 40 },
            // three ships as two files: three.core.js (renderer-agnostic core) and three.module.js
            // (WebGL renderer etc.). Splitting them keeps each chunk under the 500 kB warning.
            { name: 'three-core', test: /[\\/]node_modules[\\/]three[\\/]build[\\/]three\.core\.js/, priority: 30 },
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/, priority: 20 },
            {
              name: 'r3f',
              test: /[\\/]node_modules[\\/](@react-three|three-stdlib|three-mesh-bvh|camera-controls|@monogrid|troika-[^\\/]+|@react-spring|maath|meshline|stats-gl|stats\.js|suspend-react|its-fine|react-reconciler|hls\.js|detect-gpu|tunnel-rat|@use-gesture|glsl-noise|@mediapipe)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.{ts,tsx}',
        'src/scene/**/*.tsx',
        'src/main.tsx',
        'src/setupTests.ts',
        'src/**/*.d.ts',
        'e2e/**',
      ],
      thresholds: {
        lines: 75,
        'src/engine/**': { lines: 90, branches: 80 },
      },
    },
  },
});
