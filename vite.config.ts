import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'data/*.json', 'data/*.csv'],
      manifest: {
        name: 'MEDTRACK — NEET PG & INI-CET Planner',
        short_name: 'MEDTRACK',
        description: 'Offline-first preparation tracker for NEET PG & INI-CET',
        theme_color: '#0f766e',
        background_color: '#0b1210',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,csv,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: '/index.html'
      }
    })
  ],
  test: { environment: 'node', setupFiles: ['./src/test/setup.ts'] }
} as any);
