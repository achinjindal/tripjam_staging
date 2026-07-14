# 11 — Offline, PWA & Mobile (Android)

TripJam is a Vite SPA that ships three ways: as a web app on Vercel, as an installable PWA (via `vite-plugin-pwa` with auto-update), and as a Capacitor-wrapped Android APK. Offline support is deliberately thin: a read-only fallback for the trip list and itinerary days via two `localStorage` keys, plus service-worker caching of the app shell and Wikipedia images. Everything that touches Supabase or an edge function (auth, RG/IG, chat, geocoding, mutations) requires a network.

## Offline

### What is cached, and where

Two `localStorage` caches, both write-through on successful fetch and read-only fallback on failure:

| Key                     | Contents                                                                         | Written                                                                                                                                                              | Read                                                                                |
| ----------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `tripjam_trips`         | Full trip rows (`select("*")` from `trips`) for the current user's memberships   | `src/Home.jsx:105` after every successful `fetchData()`                                                                                                              | `src/Home.jsx:111` in the `catch` block when the fetch throws (e.g. offline)        |
| `tripjam_days_<tripId>` | The processed `days` array (incl. activities, wishlist, photo URLs) for one trip | Two places: `src/App.jsx:6488-6495` (a `useEffect` that re-serializes on every `days` state change) and `src/App.jsx:6572-6578` (right after the initial load query) | `src/App.jsx:6580-6586` when the initial `days` query errors **or returns no rows** |

Other `localStorage` keys are UI state, not offline data: `tripjam_panel_split` (desktop panel split, `src/App.jsx:6426`, `6463`) and `tripjam_debug` (debug flag, `src/App.jsx:6501-6502`).

### Staleness / merge behavior

There is no merge and no staleness tracking. The server is always authoritative when reachable: a successful fetch replaces React state and overwrites the cache; the cache is only ever read when the network path fails. No timestamps, no diffing, no queued offline writes — an edit made offline is simply a failed Supabase call.

Caveats grounded in the code:

- The days fallback condition is `else if (error || !data?.length)` (`src/App.jsx:6579`), so a trip that legitimately has zero days will also load stale cached days if any exist.
- `tripjam_trips` is not scoped by user ID. Signing out and in as a different user on the same device can surface the previous user's cached trip list if the fetch fails offline.
- Deep-linking to `/trip/:id` while offline fails: `loadTrip()` in `src/main.jsx:165-172` queries Supabase directly with no cache fallback. Offline viewing works when navigating from the Home trip list, which passes the cached trip object through.

### What is NOT available offline

- Anything hitting Supabase or an edge function: auth/sign-in, RG, IG, chat, Board mutations, Magazine deep dives, Inspirations, geocoding (`places-proxy`), Google Places, credits.
- Map tiles — the Workbox runtime caches (below) cover only `en.wikipedia.org` and `upload.wikimedia.org`; Leaflet tile servers are not cached.
- Any write. There is no offline mutation queue.

## PWA

Configured entirely in `vite.config.js` via `VitePWA` (`vite.config.js:8-61`).

- **Registration/updates:** `registerType: "autoUpdate"` (`vite.config.js:9`) with `skipWaiting: true`, `clientsClaim: true`, `cleanupOutdatedCaches: true` (`vite.config.js:11-13`) — a new service worker takes control immediately without waiting for tabs to close.
- **Precache:** all built `js/css/html/ico/svg/woff/woff2` plus app icons (`icon-*.png`, `apple-touch-icon.png`, `google-maps-icon.png`) — `vite.config.js:14-19`. This is what lets the app shell boot offline.
- **Runtime caching:** two `CacheFirst` caches for Wikipedia (`wiki-images`) and Wikimedia (`wikimedia-images`) image hosts, each capped at 200 entries / 7-day expiry (`vite.config.js:20-39`). This is why activity/Magazine photos often render offline.
- **Manifest:** name/short_name `TripJam`, `display: standalone`, `orientation: portrait`, `start_url: "/"`, theme `#2563A8`, background `#FBF9F5`, 192/512 icons plus a maskable 512 (`vite.config.js:41-60`).
- **Mid-session update flow** lives in `src/main.jsx:46-60`: once the SW is ready, `setInterval(() => registration.update(), 5 * 60 * 1000)` polls for a new build every 5 minutes (`src/main.jsx:50`); a `controllerchange` listener then calls `window.location.reload()` exactly once (guarded by a `refreshing` flag) when the new worker activates (`src/main.jsx:52-58`). Net effect: a deploy reaches open sessions within ~5 minutes as a full page reload — unsaved in-memory state (e.g. an in-flight chat draft) is lost.

## Android / Capacitor

- **Config:** `capacitor.config.json` — `appId: com.tripjam.app`, `appName: TripJam`, `webDir: "dist"`, `server.androidScheme: "https"`. The native app is a WebView loading the same Vite `dist/` bundle.
- **Build:** `npm run build:android` = `vite build && npx cap sync android` (`package.json:8`). `cap sync` copies `dist/` into the native project and updates plugins.
- **`android/` folder:** the generated native Gradle project, checked into git (e.g. `android/app/build.gradle`). Built locally with `./gradlew assembleDebug` or in CI.
- **CI APK build:** `.github/workflows/build-android.yml` runs on push to `main` and on manual dispatch. It runs `npm run build` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MAPBOX_TOKEN` from GitHub Secrets (`build-android.yml:36-39`) — these point at production (per CLAUDE.md; secret values are not in the repo) — then `npx cap add android || true`, `npx cap sync android`, `./gradlew assembleDebug`, and uploads `app-debug.apk` as an artifact (`build-android.yml:41-55`). Notes: `.env*` files are not committed, so the CI build gets **only** those three vars — `VITE_REVENUECAT_ANDROID_KEY`, `VITE_APP_ENV`, `VITE_POSTHOG_KEY`, `VITE_SENTRY_DSN` are absent in CI-built APKs (RevenueCat logs a warning and skips init, `src/billing.js:35-40`; PostHog/Sentry no-op). Also the Java setup step is labeled "JDK 17" but installs `java-version: 21` (`build-android.yml:22-26`).

### Platform detection & Android-only code paths

- `isAndroidApp()` in `src/billing.js:27-29`: `Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"`.
- **RevenueCat init:** `initRevenueCat(userId)` (`src/billing.js:32-46`) is called on every auth state change with a user (`src/main.jsx:156`); it returns immediately on non-Android, otherwise `Purchases.configure({ apiKey, appUserID: userId })` with `VITE_REVENUECAT_ANDROID_KEY`.
- **Purchases:** `purchaseCredits(packId)` (`src/billing.js:52-109`) maps pack IDs to Google Play SKUs (`tripjam_credits_300` / `tripjam_credits_1000`), runs the Play purchase sheet, then immediately POSTs the transaction to the `revenuecat-verify` edge function for an instant credit grant (`src/billing.js:84-91`); the `revenuecat-webhook` is the idempotent fallback.
- **Paywall branching:** `CreditsOverlay.jsx` computes `onAndroid` (`src/CreditsOverlay.jsx:229`) and renders Google Play pack buttons only on Android (`src/CreditsOverlay.jsx:315-367`). On web the current paywall's primary action is coupon redemption — no Lemon Squeezy checkout button is rendered (only a legacy post-checkout redirect handler remains, `src/CreditsOverlay.jsx:426`), even though the `create-checkout` / `payment-webhook` edge functions still exist.
- **External links:** `openUrl()` in `src/components/Magazine.jsx:7-22` dynamically imports `@capacitor/core` and, on native, opens links via `@capacitor/browser` (`Browser.open`, a Chrome Custom Tab) so users can swipe back into the app; on web it falls back to `window.open(..., "_blank")`. The dynamic import keeps the web bundle from erroring where Capacitor isn't present.

## Environments

Two Supabase projects; the split is driven by Vite env files (see CLAUDE.md table):

- `.env` → staging (`wlrzvwjdrjpfqcwgmzch`): used by `npm run dev`, E2E tests, Vercel preview deploys. Contains `VITE_APP_ENV=staging`.
- `.env.production` → production (`viyvdqwwnbbqjuwiuzbh`): used by `npm run build`, Vercel production, and local `npm run build:android`. Contains `VITE_APP_ENV=production`.
- Both files define the same key set: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MAPBOX_TOKEN`, `VITE_BRAINSTORM_ENABLED`, `VITE_APP_ENV`, `VITE_PAYMENTS_ENABLED`, `VITE_REVENUECAT_ANDROID_KEY`. Neither defines `VITE_POSTHOG_KEY` or `VITE_SENTRY_DSN` — those are supplied by hosting-level env vars (Vercel), so analytics/error tracking are off in plain local dev.
- **The APK always talks to production Supabase** — locally because `vite build` (inside `build:android`) reads `.env.production`, and in CI because the GitHub Secrets hold production values.
- **PostHog:** initialized only when `VITE_POSTHOG_KEY` is set (`src/main.jsx:63-72`); every event is tagged via `posthog.register({ app_env: import.meta.env.VITE_APP_ENV || "unknown" })` (`src/main.jsx:71`) so staging vs production traffic can be filtered in one PostHog project. Users are identified on auth change (`src/main.jsx:151`).
- **Sentry:** no-op unless `VITE_SENTRY_DSN` is set; when set, `environment` is `VITE_APP_ENV || "unknown"` (`src/main.jsx:24-44`), with 10% tracing, 1% session replay (100% on error), and browser-extension noise filtered. User context set/cleared on auth change (`src/main.jsx:152-159`).

## Key files

- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/vite.config.js` — PWA plugin: precache, runtime image caches, manifest
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/main.jsx` — SW 5-min update poll + reload, PostHog `app_env`, Sentry init, RevenueCat init hook
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/Home.jsx` — `tripjam_trips` offline cache (write :105, read :111)
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/App.jsx` — `tripjam_days_<tripId>` cache (write :6492/:6574, read :6582)
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/billing.js` — `isAndroidApp()`, RevenueCat init/purchase
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/CreditsOverlay.jsx` — platform-branched paywall
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/components/Magazine.jsx` — `openUrl()` Capacitor Browser wrapper
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/capacitor.config.json` — Capacitor app config
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/.github/workflows/build-android.yml` — CI APK build (production secrets)
