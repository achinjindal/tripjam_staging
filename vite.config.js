import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Monotonic build number (UTC YYYYMMDDHHmm), read by src/version.js for the
// minimum-client-build gate. The web bundle and the APK built from the same
// commit share it.
const APP_BUILD = new Date().toISOString().replace(/\D/g, "").slice(0, 12);

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_BUILD": JSON.stringify(APP_BUILD),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: [
          "**/*.{js,css,html,ico,svg,woff,woff2}",
          "**/icon-*.png",
          "**/apple-touch-icon.png",
          "**/google-maps-icon.png",
        ],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/en\.wikipedia\.org\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "wiki-images",
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/upload\.wikimedia\.org\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "wikimedia-images",
              // Story mode adds 1280px hero variants alongside the 700px
              // thumbs, so the cache holds two sizes per place.
              expiration: { maxEntries: 400, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: "TripJam",
        short_name: "TripJam",
        description: "AI-powered travel planning",
        theme_color: "#2563A8",
        background_color: "#FBF9F5",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
});
