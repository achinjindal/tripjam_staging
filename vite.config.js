import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Monotonic build number (UTC YYYYMMDDHHmm), read by src/version.js for the
// minimum-client-build gate. The web bundle and the APK built from the same
// commit share it. CI may pin it via APP_BUILD (the Android workflow does, so
// the number it prints in the log is exactly the one in the bundle).
const APP_BUILD = /^\d{12}$/.test(process.env.APP_BUILD || "")
  ? process.env.APP_BUILD
  : new Date().toISOString().replace(/\D/g, "").slice(0, 12);

// Vite INLINES env vars at build time, so a production bundle built without
// VITE_POSTHOG_KEY can never report its own breakage: main.jsx gates
// posthog.init on the key, and posthog.captureException with no init is a
// silent no-op — no warning, no throw, no event. That is exactly how the
// Android APK shipped for months with zero crash reporting while the web
// app was fully instrumented. Fail the build rather than produce an
// artifact that is structurally incapable of telling us it is broken.
const requireErrorTracking = () => ({
  name: "tripjam-require-error-tracking",
  configResolved(config) {
    if (config.command !== "build") return;
    const env = config.env || {};
    if (env.VITE_POSTHOG_KEY) return;
    const detail =
      "VITE_POSTHOG_KEY is not set, so this bundle will have NO error " +
      "tracking. Set it in .env.production (local builds, including " +
      "`npm run build:android`), in the Vercel project env, and as the " +
      "VITE_POSTHOG_KEY repo secret for .github/workflows/build-android.yml.";
    // Only hard-fail a build that claims to be production; a dev/staging
    // build without the key is a legitimate choice, not an incident.
    if (env.VITE_APP_ENV === "production") {
      throw new Error(`[tripjam] refusing to build production: ${detail}`);
    }
    console.warn(`\n\u26a0\ufe0f  [tripjam] ${detail}\n`);
  },
});

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_BUILD": JSON.stringify(APP_BUILD),
  },
  plugins: [
    requireErrorTracking(),
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
