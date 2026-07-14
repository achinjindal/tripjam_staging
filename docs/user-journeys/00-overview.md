# TripJam User Journeys — Overview

TripJam is an AI-powered travel planning and collaboration app: a React 18 + Vite SPA (`src/`) backed by Supabase (Postgres, Auth, Edge Functions in `supabase/functions/`), with Anthropic Claude powering generation. This folder documents the product **journey by journey** — each file walks one stage of the user experience end-to-end: the UI flow, the state involved, the backend calls, the persistence, and the edge cases.

These docs were written against the code (with `file:line` references), not against marketing copy or stale notes. Where the code contradicts `CLAUDE.md` or the README, the docs follow the code and call out the discrepancy.

## The journey at a glance

```
Landing → Sign up / Sign in                                   [01]
   → Home (trip list) → Create trip (3-step wizard)           [02]
      → Route Generation "RG" (4 route options)               [03]
         → select route → Pre-IG sheet → Itinerary
           Generation "IG" (compact → detailed streaming)     [04]
            → Live with the itinerary: view, edit, maps,
              photos, transitions, Edit Details               [05]

Parallel surfaces once a trip exists:
   Magazine (destination guide) + Inspirations                [06]
   Board (notes, todos, bookmarks, expenses, travel & hotels) [07]
   Chat (action-based AI assistant, all tabs)                 [08]
   Sharing (public share link; collaboration schema)          [09]

Cross-cutting:
   Credits & payments (gating every AI call)                  [10]
   Offline / PWA / Android app                                [11]
   Admin console (founder-only)                               [12]
```

## Doc index

| Doc                                                             | Journey stage                                                                                                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [01 — Landing & Auth](01-landing-and-auth.md)                   | Landing page, signup/signin (email + auto-derived username, Google OAuth, legacy `@tripjam.app` accounts), password recovery, session lifecycle, new-user side effects (profile trigger, 100-credit grant)            |
| [02 — Trip creation](02-trip-creation.md)                       | Home trip list (with localStorage cache), SetupForm 3-step wizard (destinations → dates/travelers → free-text preferences), browser-history step sync, client-generated trip IDs                                      |
| [03 — Route Generation (RG)](03-route-generation.md)            | `generate-brainstorm` edge function, 4 streamed route options, skeleton + destination map loading UX, route selection/dismissal, render-time P1/P2 labels                                                             |
| [04 — Itinerary Generation (IG)](04-itinerary-generation.md)    | Pre-IG sheet, `extract-preferences` (unbilled), two-phase `generate-itinerary` (compact then detailed streaming), progressive rendering, persistence, replace confirmation                                            |
| [05 — Itinerary experience](05-itinerary-experience.md)         | Day cards, tap-to-edit activities, TransitionRow (haversine, no LLM estimates), transit tips, inter-city transit cards, maps/geocoding, 4-tier Wikipedia photo pipeline, Edit Details flow                            |
| [06 — Magazine & Inspirations](06-magazine-and-inspirations.md) | Lazy-loaded destination guide, `city-deep-dive` (anti-hallucination), Inspirations via `generate-destination-research` (web search), `magazine_digest`/`inspirations_digest` caching                                  |
| [07 — Board](07-board.md)                                       | Notes, To-dos (`generate-todos`), Bookmarks, Expenses (`estimate-expenses`), Travel & Hotels (airport search + Google Places hotel autocomplete — this is where flights/hotels live, not the wizard), CityInput modes |
| [08 — Chat](08-chat.md)                                         | Unified `chat` edge function, `actions[]` contract (full action-type table), per-tab context, frontend dispatch + undo, 6-message history cap                                                                         |
| [09 — Collaboration & sharing](09-collaboration-and-sharing.md) | `trip_members` schema + RLS matrix, public `/share/:token` view, what exists vs. what is schema-only (invites/comments/realtime do **not** exist yet)                                                                 |
| [10 — Credits & payments](10-credits-and-payments.md)           | Credit lifecycle, deduction formula (`ceil((cost/0.007)*100)/100`, cache multipliers), 402 → paywall, Lemon Squeezy (web), RevenueCat (Android), coupons                                                              |
| [11 — Offline, PWA & mobile](11-offline-pwa-mobile.md)          | localStorage offline cache, vite-plugin-pwa auto-update, Capacitor Android, platform detection, staging/production env split                                                                                          |
| [12 — Admin console](12-admin.md)                               | `/admin` (`is_admin`-gated), per-tab queries and metrics, client-side cost model, `llm_usage` table, `scripts/trip-cost.cjs`                                                                                          |

## URL routing (the app has no router library)

All routing lives in `parseUrl()` at `src/main.jsx:76`, driven by the History API:

| URL                                   | Page                    | Notes                                                                                                                                              |
| ------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                   | `home`                  | Landing (signed out) / trip list (signed in)                                                                                                       |
| `/signin`, `/login`, `/signup`        | auth                    | `src/Auth.jsx`                                                                                                                                     |
| `/forgot-password`, `/reset-password` | recovery                |                                                                                                                                                    |
| `/privacy`, `/terms`                  | legal                   | Unauthenticated, `LegalPage.jsx`                                                                                                                   |
| `/new`, `/new/:step`                  | `create`                | SetupForm wizard, step deep-linkable                                                                                                               |
| `/trip/:id`                           | `trip`                  | Authenticated trip view                                                                                                                            |
| `/trip/:id/plans`                     | `edit`                  | Back into the wizard/routes                                                                                                                        |
| `/trip/:id/magazine`                  | `trip` tab `brainstorm` | **Naming quirk:** the friendly URL slug `magazine` translates to legacy internal tab key `brainstorm` at the parse boundary (`src/main.jsx:91-98`) |
| `/trip/:id/map`, `/trip/:id/board`    | `trip` tabs             |                                                                                                                                                    |
| `/share/:token`                       | `public`                | Read-only `TripPublicView.jsx`, anonymous                                                                                                          |
| `/admin`                              | `admin`                 | `is_admin`-gated console                                                                                                                           |

## Nomenclature (used throughout these docs)

- **RG** — Route Generation ("brainstorm" internally): 4 route options generated before any full itinerary.
- **IG** — Itinerary Generation: the full day-by-day plan from a selected route; compact phase (fast) then detailed phase (streaming).
- **Pre-IG sheet** — bottom sheet between route selection and IG (budget, pace, morning preference, transport).
- **Magazine** — destination-guide tab; **Inspirations** is its web-search-backed sub-tab.
- **Board** — notes/todos/bookmarks/expenses/travel-&-hotels tab.
- **Credits** — the metering unit for AI calls; every gated edge function deducts via `_shared/credits.ts` and returns HTTP 402 when exhausted.

## Cross-cutting patterns to know

- **Credit gating:** every AI edge function authenticates (`authenticateUser`), rate-limits, deducts credits post-call, and logs to `llm_usage` (fire-and-forget). The frontend wraps responses with `handleGatedResponse()` (`src/credits.js`) — a 402 opens the paywall (deep dives, todos, and expenses were fixed to do this on 2026-07-13; chat/RG/IG/Inspirations call `openPaywall` directly). Exception: `extract-preferences` logs usage but deliberately doesn't bill.
- **Design system:** all UI reads tokens from `src/theme.js` (`T`, `TYPE`, `RADIUS`, `SHADOW`, `MOTION`). Never hardcode values.
- **State home:** most trip state lives in `App.jsx` (~14.5k lines); BoardView/SetupForm/Magazine/MapView are rendering split-outs, not state owners.
- **Client-generated IDs:** trip IDs come from `crypto.randomUUID()` on the client so the insert satisfies RLS immediately.
- **No realtime:** despite Supabase Realtime being available, the app currently has zero live subscriptions — collaboration is same-account or read-only share links (see doc 09).

## Corrections to stale assumptions (found while writing these docs)

Things the code says that older notes (`CLAUDE.md`, README) get wrong — trust the journey docs:

- Auth is **email-based** with auto-derived usernames + Google OAuth; "username-only, no email" describes only legacy accounts (doc 01).
- Flights and hotels are entered in the **Board → Travel & Hotels** widget, not the setup wizard; there is no `trips.flights_data` column — flights are flat `trips` columns (doc 07).
- The photo queue is **2 concurrent / 400ms** (`photos.js`), not 3/300ms; Inspirations `web_search` allows **6** uses, not 4 (docs 05, 06).
- Comments, invites, and realtime sync exist **only as schema/dead code**, not as features (doc 09).

Several bugs these docs originally flagged were fixed on 2026-07-13: share links are now served by a token-scoped RPC (`get_shared_trip`) with a revoke option, manual activity edits persist to the `activities` table, the dead client-side Anthropic call in Expenses was removed, deep-dive/todo/expense 402s open the paywall, the Admin IG-timing panel derives seconds from `generation_log` timestamps, and the over-broad `USING (true)` RLS policies were scoped to `service_role` (with explicit admin/member policies where clients need access).
