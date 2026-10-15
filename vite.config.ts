import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app from /<repo-name>/. The deploy workflow sets BASE_PATH from the repo name.
const base = process.env.BASE_PATH ?? '/taekwondo-timer/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      pwaAssets: { config: true, overrideManifestIcons: true },
      manifest: {
        name: 'Taekwondo Timer',
        short_name: 'TKD Timer',
        description: 'Offline runner for the 6 month taekwondo plan and daily GTG.',
        theme_color: '#0b0b0c',
        background_color: '#0b0b0c',
        display: 'standalone',
        orientation: 'portrait',
      },
      workbox: {
        // The plugin adds manifest.webmanifest itself; listing it here too makes Workbox reject the precache.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
});
