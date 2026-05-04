# TripJam — CLAUDE.md

## What is this?
TripJam is an AI-powered travel planning and collaboration app. Solo founder project.

## Tech Stack
- **Frontend:** React 18 (JSX) + Vite 8, single-page app, no router library (History API for URL routing)
- **Backend:** Supabase (Postgres, Auth, Edge Functions, RLS, Realtime)
- **AI:** Anthropic Claude API — Sonnet 4.6 for route generation & chat, Haiku 4.5 for todos/expenses
- **Maps:** Leaflet + react-leaflet, Nominatim geocoding, OSRM routing
- **Photos:** Wikipedia/Wikimedia Commons (free, no API key)
- **Analytics:** PostHog
- **Mobile:** Capacitor (Android APK), vite-plugin-pwa
- **Testing:** Playwright E2E

## Project Structure
```
src/
  App.jsx          — Main UI (~7000+ lines, all views and logic)
  main.jsx         — Entry point, Supabase init, PostHog init
  Auth.jsx         — Login/signup
  Home.jsx         — Trip list
  TripPublicView.jsx — Read-only shared trip view
  JoinView.jsx     — Join trip via invite link
  supabase.js      — Supabase client

supabase/
  functions/       — Edge Functions (Deno, TypeScript)
    generate-brainstorm/  — Route Generation (RG): 4 route options
    generate-itinerary/   — Itinerary Generation (IG): day-by-day plan
    chat/                 — Unified chat endpoint (action-based)
    chat-brainstorm/      — Legacy brainstorm chat (deprecated)
    chat-trip/            — Legacy trip chat (deprecated)
    city-deep-dive/       — Magazine deep dive content
    places-proxy/         — Geocoding proxy (Photon + Nominatim)
    generate-todos/       — AI todo suggestions
    estimate-expenses/    — AI budget estimation
    generate-wishlist/    — Wishlist generation
  migrations/      — Postgres migrations (chronological)

e2e/               — Playwright E2E tests
  helpers.ts       — Login, createTrip, snap utilities
  *.spec.ts        — Test suites
```

## Commands
```bash
# Dev server
npm run dev                    # Vite on localhost:5173

# Build
npm run build                  # Production build
npm run build:android          # Build + Capacitor sync

# E2E tests (requires dev server running or uses webServer config)
npx playwright test            # Run all tests (sequential, workers: 1)
npx playwright test e2e/smoke.spec.ts   # Run specific file
npx playwright show-trace <path>        # View test trace on failure

# Supabase
npx supabase functions serve   # Local edge functions
npx supabase db push           # Apply migrations
```

## Internal Nomenclature
- **RG** — Route Generation. Pre-IG step where 4 route options are generated.
- **IG** — Itinerary Generation. Full day-by-day plan from selected route.
- **Magazine** — Destination guide tab (highlights, deep dives, food, tips).
- **Board** — Tab with Notes, To-dos, Bookmarks, Expenses widgets.
- **Pre-IG sheet** — Bottom sheet shown after route selection, before IG (budget, pace, morning preference).

## Architecture Notes
- App.jsx is a single large file containing all views and state. No component library or state management.
- Auth uses username + password only (no email). Fake email = `username@tripjam.app`.
- Trip ID generated client-side (`crypto.randomUUID()`) to avoid RLS issues on insert+select.
- Home page uses 3 flat Supabase queries (not nested joins — RLS caused 500s).
- Unified chat uses action-based responses: LLM returns `actions[]` array, client dispatcher maps action types to state mutations.
- Route labels (P1, P2...) are computed at render time from display index, never stored.
- Photos use Wikipedia with person-page filtering and portrait URL detection.
- Geocoding: Photon primary, Nominatim fallback. Nominatim used for bias city resolution (Photon returns wrong results from Supabase datacenter).

## Testing
- Playwright config: `workers: 1` (sequential) — API-dependent tests can't run in parallel.
- Test user: `qa-tester` / `qaTest123!`
- Tests use real Supabase (not mocked). Some tests create trips and call AI, so they're slow.

## Environments
Two Supabase projects — local dev and staging share one, production is isolated.

| | Staging/Local | Production |
|---|---|---|
| **Supabase ref** | `wlrzvwjdrjpfqcwgmzch` | `viyvdqwwnbbqjuwiuzbh` |
| **Used by** | `npm run dev`, E2E tests, Vercel preview | `npm run build`, Vercel production, APK |
| **Env file** | `.env` | `.env.production` |

- `npm run dev` → staging (`.env`)
- `npm run build` / `vite build` → production (`.env.production`, Vite loads this automatically in production mode)
- E2E tests always hit staging

```bash
# Deploy edge functions
npm run deploy:functions:staging
npm run deploy:functions:prod

# Apply DB migrations
npm run db:push:staging
npm run db:push:prod
```

## Deployment
- Vercel auto-deploys on push. Preview deploys use staging Supabase, production deploys use production Supabase.
- **Do not push to any remote without explicit user approval.** Every remote auto-deploys.
- GitHub Actions APK build points to production (via GitHub Secrets).

## Supabase Edge Functions
- Runtime: Deno (TypeScript)
- All use `Anthropic` SDK from `npm:@anthropic-ai/sdk`
- CORS headers required on every response
- Environment vars: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Deploy to each environment separately — changes to staging don't affect production
