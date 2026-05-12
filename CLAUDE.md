# TripJam — CLAUDE.md

## What is this?
TripJam is an AI-powered travel planning and collaboration app. Solo founder project.

## Tech Stack
- **Frontend:** React 18 (JSX) + Vite 8, single-page app, no router library (History API for URL routing)
- **Backend:** Supabase (Postgres, Auth, Edge Functions, RLS, Realtime)
- **AI:** Anthropic Claude API — Sonnet 4.6 for RG/IG/chat, Haiku 4.5 for todos/expenses/deep-dives/preferences
- **Maps:** Leaflet + react-leaflet, Photon/Nominatim geocoding (with trip destination enrichment)
- **Photos:** Wikipedia/Wikimedia Commons (free, serialized queue 3 concurrent / 300ms)
- **Places:** Google Places API (autocomplete, hotel search with lodging type)
- **Analytics:** PostHog (tagged with app_env for staging/production filtering)
- **Mobile:** Capacitor (Android APK), vite-plugin-pwa (auto-update, 5-min check interval)
- **Testing:** Playwright E2E (sequential, workers: 1)
- **Hosting:** Vercel (frontend auto-deploy), Supabase (backend/DB/functions)

## Project Structure
```
src/
  App.jsx            — Main UI (~5000 lines, core state + views)
  main.jsx           — Entry point, Supabase init, PostHog init, URL routing
  Auth.jsx           — Login/signup (serif fonts, design system tokens)
  Home.jsx           — Trip list (card hover, warm palette)
  Admin.jsx          — Admin console (/admin, is_admin gated)
  TripPublicView.jsx — Read-only shared trip view
  JoinView.jsx       — Join trip via invite link
  supabase.js        — Supabase client
  theme.js           — Design system: T colors, TYPE, SPACE, RADIUS, SHADOW, MOTION
  photos.js          — Photo fetch, caching, dedup, geocoding, haversine
  context.js         — DebugContext

  components/
    BoardView.jsx    — Notes, Todos, Bookmarks, Expenses, Travel & Hotels, LogisticsTab
    SetupForm.jsx    — 3-step wizard, DateRangePicker, CityInput, ModePills
    Magazine.jsx     — DestinationHero, CityCard, MagazineHighlightCard, FoodSpotlightCard
    MapView.jsx      — FitBounds, MapView (itinerary), RouteMapView (brainstorm)

supabase/
  functions/         — Edge Functions (Deno, TypeScript)
    generate-brainstorm/  — Route Generation (RG): 4 route options with **bold** day text
    generate-itinerary/   — Itinerary Generation (IG): day-by-day plan with transit tips + transitions
    chat/                 — Unified chat endpoint (action-based, 6 message history cap)
    city-deep-dive/       — Magazine deep dive content (anti-hallucination prompt)
    places-proxy/         — Geocoding proxy (Photon + Nominatim)
    generate-todos/       — AI todo suggestions with due dates
    estimate-expenses/    — AI budget estimation
    extract-preferences/  — Pre-IG preference extraction (Haiku)
    generate-wishlist/    — Wishlist generation
  migrations/        — Postgres migrations (chronological)

e2e/                 — Playwright E2E tests
  helpers.ts         — Login, snap utilities
  *.spec.ts          — Test suites (board, chat, interactions, magazine, geocoding, etc.)
```

## Commands
```bash
# Dev server
npm run dev                    # Vite on localhost:5173

# Build
npm run build                  # Production build
npm run build:android          # Build + Capacitor sync

# E2E tests
npx playwright test            # Run all tests (sequential, workers: 1)
npx playwright test e2e/smoke.spec.ts   # Run specific file

# Supabase
npm run deploy:functions:staging    # Deploy edge functions to staging
npm run deploy:functions:prod       # Deploy edge functions to production
npm run db:push:staging             # Apply migrations to staging
npm run db:push:prod                # Apply migrations to production
```

## Internal Nomenclature
- **RG** — Route Generation. Pre-IG step where 4 route options are generated.
- **IG** — Itinerary Generation. Full day-by-day plan from selected route. Two phases: compact (fast) then detailed (streaming).
- **Magazine** — Destination guide tab (highlights, deep dives, food, tips). Lazy-loaded: destination + top 2 cities on route load, rest on Magazine open.
- **Board** — Tab with Notes, To-dos, Bookmarks, Expenses, Travel & Hotels widgets.
- **Pre-IG sheet** — Bottom sheet shown after route selection, before IG (budget, pace, morning preference, transport).
- **Transit tips** — Per-day actionable public transport advice (e.g. "Use Suica card · Day pass ¥600").

## Architecture Notes
- App.jsx split into components: BoardView, SetupForm, Magazine, MapView + shared modules (theme, photos, context).
- Design system in theme.js: T (colors + semantic states), TYPE (6-level typography), RADIUS (4 values), SHADOW (3 levels), MOTION (3 speeds).
- Auth uses username + password only (no email). Fake email = `username@tripjam.app`.
- Trip ID generated client-side (`crypto.randomUUID()`) to avoid RLS issues.
- Unified chat uses action-based responses: LLM returns `actions[]` array with support for bulk dismiss (routeIds array).
- Route labels (P1, P2...) computed at render time from display index, never stored.
- Geocoding enriched with trip destination context (e.g. "Kuta" → "Kuta, Bali") to avoid wrong-continent results.
- Photos: 4-tier Wikipedia lookup with person-page filtering, serialized Magazine fallback to prevent duplicates.
- TransitionRow: haversine walk/drive pill + optional transit icon (🚇/🚌/⛴️) linking to Google Maps transit. No LLM time estimates.
- Inter-city transit cards: rich cards with service name, stations, duration, cost, Rome2Rio link.
- Edit Details flow: smart change detection with confirmation sheet. Destinations/duration force regenerate, other changes user chooses.
- Itinerary replace confirmation: shows parameter diff before overwriting existing itinerary.
- Per-day collapse/expand in detailed view (no Compact/Detailed toggle).
- Pre-loading: Day 1 geocoded/photos cached when streamingDays >= 1. Expanding Day N triggers Day N+1 pre-load.
- Offline: trip list + days cached in localStorage.
- LLM usage logged to llm_usage table (all edge functions, fire-and-forget).

## Admin Console
- Route: `/admin` — gated by `is_admin` boolean on profiles table
- Tabs: Users, Trips, Credits (by function/model), Daily Usage
- Shows: trip counts, chat counts, IG timing, activity breakdown, token usage, cost estimates
- Cost rates: Sonnet $3/$15 per M tokens, Haiku $0.80/$4 per M tokens

## Testing
- Playwright config: `workers: 1` (sequential) — API-dependent tests can't run in parallel.
- Test user: `qa-tester` / `qaTest123!`
- Tests use real Supabase (not mocked). Board tests create trips via serial setup fixture.
- QA skills: `/code-review` (static analysis), `/qa-e2e` (browser tests with cost tracking).

## Environments
Two Supabase projects — local dev and staging share one, production is isolated.

| | Staging/Local | Production |
|---|---|---|
| **Supabase ref** | `wlrzvwjdrjpfqcwgmzch` | `viyvdqwwnbbqjuwiuzbh` |
| **Used by** | `npm run dev`, E2E tests, Vercel preview | `npm run build`, Vercel production, APK |
| **Env file** | `.env` | `.env.production` |

## Deployment
- Vercel auto-deploys on push. Preview deploys use staging Supabase, production deploys use production Supabase.
- **Do not push to any remote without explicit user approval.** Every remote auto-deploys.
- **Do not make code changes without user approval.** Discuss first, implement after approval. Exception: clear bug fixes can be applied directly.
- GitHub Actions APK build points to production (via GitHub Secrets).
- Always deploy edge functions separately to each environment.
- After any file extraction/split, verify no duplicate `const T =` definitions and no escaped unicode (`\\u` sequences).

## Supabase Edge Functions
- Runtime: Deno (TypeScript)
- All use Anthropic API via direct fetch or `npm:@anthropic-ai/sdk`
- CORS headers required on every response
- Environment vars: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- All functions log token usage to `llm_usage` table (fire-and-forget)
- Deploy to each environment separately — changes to staging don't affect production
