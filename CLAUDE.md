# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this?

TripJam is an AI-powered travel planning and collaboration app. Solo founder project.

## Tech Stack

- **Frontend:** React 18 (JSX) + Vite 8, single-page app, no router library (History API for URL routing)
- **Backend:** Supabase (Postgres, Auth, Edge Functions, RLS, Realtime)
- **AI:** Anthropic Claude API — Sonnet 4.6 for RG/IG/chat, Haiku 4.5 for todos/expenses/deep-dives/preferences/inspirations
- **Maps:** Leaflet + react-leaflet, Photon/Nominatim geocoding (with trip destination enrichment)
- **Photos:** Wikipedia/Wikimedia Commons (free, serialized queue 2 concurrent / 400ms)
- **Places:** Google Places API (autocomplete, hotel search with lodging type)
- **Analytics:** PostHog (tagged with `app_env` for staging/production filtering)
- **Error tracking:** Sentry (`VITE_SENTRY_DSN` env var; no-op when unset)
- **Mobile:** Capacitor (Android APK), vite-plugin-pwa (auto-update, 5-min check interval)
- **Payments:** Lemon Squeezy (web MoR; credits via `create-checkout` + `payment-webhook` edge functions) + RevenueCat (Android Google Play Billing via `@revenuecat/purchases-capacitor`)
- **Testing:** Playwright E2E (sequential, workers: 1)
- **Hosting:** Vercel (frontend auto-deploy), Supabase (backend/DB/functions)

## Project Structure

```
src/
  App.jsx            — Main UI (~14,700 lines, core state + views)
  main.jsx           — Entry point, Supabase init, PostHog/Sentry init, URL routing
  Auth.jsx           — Login/signup (serif fonts, design system tokens)
  Home.jsx           — Trip list (card hover, warm palette)
  Landing.jsx        — Public marketing/landing page (unauthenticated)
  Admin.jsx          — Admin console (/admin, is_admin gated)
  TripPublicView.jsx — Read-only shared trip view
  credits.js         — Module-level credit store: CREDITS_UI_ENABLED, useCredits,
                       openPaywall, handleGatedResponse, refreshCredits
  billing.js         — Platform-aware billing: RevenueCat on Android, Lemon Squeezy on web.
                       Exports isAndroidApp(), initRevenueCat(userId), purchaseCredits(packId)
  CreditsOverlay.jsx — Paywall bottom sheet (routes to RC or LS based on platform)
  LowCreditsBanner.jsx — Dismissible banner when credits run low
  Avatar.jsx         — User avatar component
  dialogs.jsx        — Module-level toast + confirm sheet (showToast/confirmSheet, replaces
                       native alert/confirm; same store pattern as credits.js)
  activity.js        — Fire-and-forget activity logger → activity_log table (collab Phase 0b)
  realtime.js        — Per-trip Supabase realtime channel scaffold (behind VITE_REALTIME_ENABLED,
                       ships dark until collab Phase 2)
  members.js         — trip_members data layer + invite RPC wrappers; exports INVITE_ENABLED
  JoinTrip.jsx       — /join/:token landing: invite preview + accept, stashes token
                       across sign-in for unauthenticated users
  MemberAvatar.jsx   — Member avatar circle (initials + username-hashed color)
  AddRealEmailPrompt.jsx — Prompt to add a real email (legacy username-only accounts)
  ForgotPassword.jsx / ResetPassword.jsx — Password recovery flow
  LegalPage.jsx      — Shared scrollable layout for Privacy + Terms (no auth required)
  Privacy.jsx / Terms.jsx — Legal pages rendered by LegalPage
  airports.js        — Airport search helpers
  airports-data.json — Bundled IATA airport data
  supabase.js        — Supabase client
  theme.js           — Design system: T colors, TYPE, SPACE, RADIUS, SHADOW, MOTION
                       Also exports PLACES_PROXY + PLACES_HEADERS constants
  photos.js          — Photo fetch, caching, dedup, geocoding, haversine
  context.js         — DebugContext

  components/
    BoardView.jsx    — Notes, Todos, Bookmarks, Expenses, Travel & Hotels, LogisticsTab
    SetupForm.jsx    — 3-step wizard, DateRangePicker, CityInput, ModePills
    Magazine.jsx     — DestinationHero, CityCard, MagazineHighlightCard, FoodSpotlightCard
    MapView.jsx      — FitBounds, MapView (itinerary), RouteMapView (brainstorm)
    MembersSheet.jsx — Members list, invite-link share/revoke, remove/leave/transfer-ownership

  hooks/
    useViewport.js   — Viewport size hook

supabase/
  functions/         — Edge Functions (Deno, TypeScript)
    _shared/
      credits.ts     — Shared auth + credit-deduction helpers for all gated functions
                       (authenticateUser, deductCredits, costToCredits, rateLimit, etc.)
      sentry.ts      — Sentry integration for edge functions
    generate-brainstorm/       — Route Generation (RG): 4 route options with **bold** day text
    generate-itinerary/        — Itinerary Generation (IG): day-by-day plan with transit tips + transitions
    generate-destination-research/ — Inspirations tab: web-search-backed articles/vlogs via Haiku + web_search
    chat/                      — Unified chat endpoint (action-based, 6 message history cap)
    city-deep-dive/            — Magazine deep dive content (anti-hallucination prompt)
    places-proxy/              — Geocoding proxy (Photon + Nominatim)
    generate-todos/            — AI todo suggestions with due dates
    estimate-expenses/         — AI budget estimation
    extract-preferences/       — Pre-IG preference extraction (Haiku)
    generate-wishlist/         — Wishlist generation
    create-checkout/           — Lemon Squeezy checkout session creation
    payment-webhook/           — Lemon Squeezy webhook handler (grants credits on order_created)
    redeem-coupon/             — Coupon code redemption (grants free credits; single-use per user)
    revenuecat-verify/         — Server-side RC purchase verification (called immediately after Android purchase)
    revenuecat-webhook/        — RevenueCat webhook handler for Android IAP (deployed with --no-verify-jwt)
  migrations/        — Postgres migrations (chronological)

scripts/
  backfill-activity-geocodes.cjs — Backfill missing lat/lng on activities
  trip-cost.cjs      — Print actual per-function LLM cost for one trip from llm_usage
                       (needs SUPABASE_SERVICE_ROLE_KEY; anon key returns nothing)

docs/
  user-journeys/     — Journey-by-journey documentation (00-overview.md is the index):
                       UI flow + underlying logic per stage, with file:line references
  collaboration/     — Collaboration feature spec: design.md, v1-scope.md,
                       implementation-plan.md, documentation.md, migrations-draft/

e2e/                 — Playwright E2E tests
  helpers.ts         — Login, snap utilities
  criteria/          — Per-journey acceptance criteria docs (numbered to match test areas)
  *.spec.ts          — Test suites (board, chat, interactions, magazine, geocoding,
                       collab-invite, url-routing, smoke, etc.)
```

### Repo root gotchas

- `ad-hoc/` and `inspiration/` are untracked full copies of the repo (scratch workspaces with their own `src/`, `supabase/`, etc.). When searching or editing, work only in the root `src/` and `supabase/` — a grep hit inside these copies is not the real code.
- `pitch/` — untracked pitch-deck assets (Python deck builder + screenshots), not app code.
- Root-level `*-design.html` files are gitignored design mockups, not production code.
- `RUNBOOKS.md` — operational runbooks (RevenueCat/Play Billing setup, Supabase secrets, ops SQL snippets).

## Commands

```bash
# Dev server
npm run dev                    # Vite on localhost:5173

# Build
npm run build                  # Production build
npm run build:android          # Build + Capacitor sync

# Review gate (run before code review; fix formatting first if it fails)
npm run format                 # Fix formatting with Prettier
npm run format:check           # Verify formatting
npm run lint                   # ESLint
npm run typecheck              # Web TS + Supabase Edge Function Deno checks
npm run typecheck:web          # Web-only TS check (faster)
npm run typecheck:functions    # Deno-only check for edge functions
npm run check                  # format:check + lint + typecheck + build (full gate)

# E2E tests
npm run test:e2e               # Run all Playwright tests (sequential, workers: 1)
npx playwright test e2e/smoke.spec.ts   # Run a specific file

# Supabase
npm run deploy:functions:staging    # Deploy all edge functions to staging
npm run deploy:functions:prod       # Deploy all edge functions to production
npm run db:push:staging             # Apply migrations to staging
npm run db:push:prod                # Apply migrations to production

# payment-webhook and revenuecat-webhook must be deployed with JWT verification disabled:
supabase functions deploy payment-webhook --no-verify-jwt --project-ref <ref>
supabase functions deploy revenuecat-webhook --no-verify-jwt --project-ref <ref>
```

## Internal Nomenclature

- **RG** — Route Generation. Pre-IG step where 4 route options are generated.
- **IG** — Itinerary Generation. Full day-by-day plan from selected route. Two phases: compact (fast) then detailed (streaming).
- **Magazine** — Destination guide tab (highlights, deep dives, food, tips). Lazy-loaded: destination + top 2 cities on route load, rest on Magazine open. Deep-dive content persisted in `trips.magazine_digest`.
- **Inspirations** — Sub-tab of Magazine. Web-search-backed articles/vlogs from named individual creators. Cached per (destinations, tags, monthBucket) in `trips.inspirations_digest`.
- **Board** — Tab with Notes, To-dos, Bookmarks, Expenses, Travel & Hotels widgets.
- **Pre-IG sheet** — Bottom sheet shown after route selection, before IG (budget, pace, morning preference, transport).
- **Transit tips** — Per-day actionable public transport advice (e.g. "Use Suica card · Day pass ¥600").

## Architecture Notes

### Frontend

- `main.jsx` does all URL routing via `parseUrl()` — pages: `home` (Landing), `signin`, `signup`, `trip`, `edit`, `create`, `public` (`/share/:token`), `join` (`/join/:token` invite links), `admin`, `privacy`, `terms`, `forgot-password`, `reset-password`. No router library.
- The URL `/trip/:id/magazine` maps to the internal tab key `brainstorm` (legacy name). This translation happens in `parseUrl()` — the public URL and the internal state key deliberately differ.
- `App.jsx` (~14,700 lines) contains the entire trip view: state, data fetching, all panel/tab/modal logic. Split into sub-components (BoardView, SetupForm, Magazine, MapView) but most state lives in App.
- Design system in `theme.js`: `T` (colors + semantic states), `TYPE` (6-level typography), `RADIUS` (4 values), `SHADOW` (3 levels), `MOTION` (3 speeds). Import from there, never hardcode values.
- Auth is email + password (username auto-derived from the email local part) plus Google OAuth. Legacy accounts created in the username-only era sign in via the fake-email shim `username@tripjam.app`.
- Trip ID generated client-side (`crypto.randomUUID()`) to avoid RLS issues.

### Collaboration (Phases 0–1 built, ships dark)

- Full spec lives in `docs/collaboration/` (design, v1 scope, phased implementation plan). Phases 0a/0b/1 are merged; Phase 2 (realtime sync) onward is not built.
- **Feature flags:** `VITE_INVITE_ENABLED` gates all membership/invite UI (`INVITE_ENABLED` from `members.js`); `VITE_REALTIME_ENABLED` gates the realtime scaffold in `realtime.js`. Both default off, so prod behavior is unchanged until flipped.
- **DB:** migrations `20260721000001`–`0007` — `trip_members`, `trip_invites`, `activity_log`, `is_trip_member()` RLS helper, realtime publication, and SECURITY DEFINER RPCs (`accept_invite`, `create_or_get_invite_link`, `revoke_invite_link`, `get_invite_preview`, `transfer_ownership`, `remove_member`, `leave_trip`).
- **Activity log:** every mutating action calls `logActivity` (`activity.js`) — fire-and-forget, never blocks the mutation; failures are swallowed. Logs on solo trips too.
- **Invite flow:** MembersSheet creates/shares a `/join/:token` link → JoinTrip previews via `get_invite_preview` (safe pre-membership) → accept via `accept_invite`. Signed-out users get the token stashed in localStorage and resume after auth.
- The `/join/:token` route renders regardless of the invite flag; only the invite-creation UI is flag-gated.

### Credits System (launched)

- `credits.js` is a module-level store (not React context). Components read via `useCredits()` / `usePaywall()` hooks backed by `useSyncExternalStore`.
- `CREDITS_UI_ENABLED = true` — credits UI and paywall are live. Backend deduction runs regardless of this flag.
- Edge functions return HTTP 402 when credits are exhausted. Frontend calls `handleGatedResponse(res, userId, reason)` which opens the paywall and returns `true` to abort.
- Each function calls `deductCredits` from `_shared/credits.ts` which charges `ceil((llm_cost_usd / 0.007) * 100) / 100` credits. New users get 100 credits on signup (DB default).
- **Web payments:** Lemon Squeezy (MoR). `create-checkout` creates a checkout session; `payment-webhook` (deployed with `--no-verify-jwt`, uses HMAC verification instead) grants credits on `order_created`.
- **Android payments:** RevenueCat via Google Play Billing. `billing.js` detects platform and calls RC SDK. On purchase: immediately calls `revenuecat-verify` for instant credit grant; `revenuecat-webhook` (also `--no-verify-jwt`) is the idempotent fallback. Both use `"rc_<transactionId>"` as `provider_session_id`.
- **Coupons:** `redeem-coupon` edge function. Single-use per user enforced via `provider_session_id` UNIQUE constraint. Current codes in the function source.

### AI / Edge Functions

- Unified chat uses action-based responses: LLM returns `actions[]` array with support for bulk dismiss (routeIds array).
- Route labels (P1, P2...) computed at render time from display index, never stored.
- All functions log token usage to `llm_usage` table (fire-and-forget).
- `generate-destination-research` uses Haiku 4.5 + `web_search` tool (max 6 uses). Results cached in DB; cache key = (destinations, tags, monthBucket).

### Maps & Photos

- Geocoding enriched with trip destination context (e.g. "Kuta" → "Kuta, Bali") to avoid wrong-continent results.
- Photos: 4-tier Wikipedia lookup with person-page filtering, serialized Magazine fallback to prevent duplicates.
- TransitionRow: haversine walk/drive pill + optional transit icon (🚇/🚌/⛴️) linking to Google Maps transit. No LLM time estimates.
- Inter-city transit cards: rich cards with service name, stations, duration, cost, Rome2Rio link.

### Data / State

- Pre-loading: Day 1 geocoded/photos cached when streamingDays >= 1. Expanding Day N triggers Day N+1 pre-load.
- Offline: trip list + days cached in localStorage.
- Edit Details flow: smart change detection with confirmation sheet. Destinations/duration force regenerate, other changes user chooses.
- Itinerary replace confirmation: shows parameter diff before overwriting existing itinerary.

## Admin Console

- Route: `/admin` — gated by `is_admin` boolean on profiles table
- Tabs: Users, Trips, Credits (by function/model), Daily Usage
- Shows: trip counts, chat counts, IG timing, activity breakdown, token usage, cost estimates
- Cost rates: Sonnet $3/$15 per M tokens, Haiku $0.80/$4 per M tokens

## Testing

- Playwright config: `workers: 1` (sequential) — API-dependent tests can't run in parallel.
- Test user: `qa-tester` / `qaTest123!`
- Tests use real Supabase (not mocked). Board tests create trips via serial setup fixture.
- `collab-invite.spec.ts` members/invite tests skip unless `VITE_INVITE_ENABLED=true` and the invite RPC migrations are applied to staging; the invalid-token test always runs.
- QA skills: `/code-review` (static analysis), `/qa-e2e` (browser tests with cost tracking).
- Before sending code for review, run `npm run check`. If formatting fails, run `npm run format`, then rerun `npm run check`.
- If the local network's ISP hijacks `*.supabase.co` DNS (E2E seeding fails with TLS resets; observed 2026-09), run tests with `TRIPJAM_DNS_PIN=1 NODE_OPTIONS="--import ./e2e/dns-pin.mjs" npx playwright test …` — pins the real edge IPs for Node and Chromium without touching system DNS.

## Environments

Two Supabase projects — local dev and staging share one, production is isolated.

|                  | Staging/Local                            | Production                              |
| ---------------- | ---------------------------------------- | --------------------------------------- |
| **Supabase ref** | `wlrzvwjdrjpfqcwgmzch`                   | `viyvdqwwnbbqjuwiuzbh`                  |
| **Used by**      | `npm run dev`, E2E tests, Vercel preview | `npm run build`, Vercel production, APK |
| **Env file**     | `.env`                                   | `.env.production`                       |

## Deployment

**Standard prod push order:** DB migrations first → edge functions → frontend (git push, Vercel auto-deploys).

- Vercel auto-deploys on push. Preview deploys use staging Supabase, production deploys use production Supabase.
- **Do not push to any remote without explicit user approval.** Every remote auto-deploys.
- **Do not make code changes without user approval.** Discuss first, implement after approval. Exception: clear bug fixes can be applied directly.
- GitHub Actions: `checks.yml` runs the review gate on pushes/PRs to main; `build-android.yml` builds the APK pointed at production (via GitHub Secrets).
- Always deploy edge functions separately to each environment.
- After any file extraction/split, verify no duplicate `const T =` definitions and no escaped unicode (`\\u` sequences).

## Supabase Edge Functions

- Runtime: Deno (TypeScript)
- All use Anthropic API via direct fetch or `npm:@anthropic-ai/sdk`
- CORS headers required on every response
- Environment vars: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Gated functions import `authenticateUser`, `deductCredits`, `rateLimit` from `../_shared/credits.ts`
- All functions log token usage to `llm_usage` table (fire-and-forget)
- Deploy to each environment separately — changes to staging don't affect production
- `payment-webhook` and `revenuecat-webhook` must be deployed with `--no-verify-jwt`; both use their own secret-based verification instead of Supabase JWT
