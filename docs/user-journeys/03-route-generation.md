# 03 — Route Generation (RG)

Route Generation ("RG", internally **brainstorm**) is the step between trip setup and full itinerary generation: the app streams 4 route options ("plans") from Claude Sonnet, plots them on a map, and lets the user pick, dismiss, modify (via chat), or request more before committing to a route and generating the itinerary. The frontend lives in `BrainstormView` inside `src/App.jsx`; the backend is the `generate-brainstorm` edge function (Sonnet 4.6, SSE streaming, prompt-cached system prompt). Routes are persisted per-trip in the `brainstorm_items` Postgres table, not on the `trips` row.

## Naming: brainstorm vs magazine vs plans

Three names refer to overlapping things — read carefully:

- **`brainstorm`** is the internal state key for both the pre-IG screen (`screen === "brainstorm"`, `App.jsx:6415`) and, post-IG, the bottom tab that hosts the Magazine (`activeBottomTab === "brainstorm"`, `App.jsx:11942`).
- **`/trip/:id/plans`** is the URL for the pre-IG route-selection screen. `parseUrl()` maps it to `{ page: "edit" }` (`main.jsx:89-90`), and `App.jsx:7679` pushes it after a draft trip is created.
- **`/trip/:id/magazine`** maps to the internal tab key `brainstorm` for the _post-IG_ trip view. The translation is explicit in `main.jsx:91-98`: "URL uses the friendly slug `magazine`; the App state still uses the legacy key `brainstorm` for that tab."

So the CLAUDE.md hint is correct but only for the post-IG tab. The RG flow itself lives at `/trip/:id/plans`.

## 1. Trigger — from setup form to RG

1. User completes the 3-step setup wizard (`SetupForm.jsx`). `handleSetupComplete` (`App.jsx:7709`) runs:
   - New trip or no existing routes → `doSetupComplete(form, true)` directly.
   - Editing an existing trip that already has routes → change detection (`App.jsx:7715-7814`). Destination/duration/arrival/departure/base changes are "structural"; dates-shifted/notes are soft. Material changes open a confirmation sheet (`setShowEditConfirm`, `App.jsx:13011`); no material changes returns to the routes screen silently.
2. `doSetupComplete` (`App.jsx:7555`) sets `screen`/`pretripTab` to `"brainstorm"`, and for a **new** trip immediately inserts a draft `trips` row with a client-generated `crypto.randomUUID()` id, an `ig_request` snapshot of the form, and a `trip_members` row (`App.jsx:7611-7680`), then navigates to `/trip/:id/plans`.
3. If `regenerate` is true it fires RG via an imperative ref: `triggerRgRef.current?.()` (`App.jsx:7702-7706`). `BrainstormView` exposes its `generate()` through this ref (`App.jsx:1795-1801`, prop `triggerGenerateRef` wired at `App.jsx:10323`). The only other caller is the chat action `generate_more_plans` → `triggerRgRef.current?.({ addMore: true })` (`App.jsx:8898`).
4. Regeneration path also wipes stale state: pre-trip routes, itinerary days/activities, `ig_response`, and the cached `inspirations_digest` / `magazine_digest` on the trip row (`App.jsx:7566-7608`).
5. **Draft resume:** opening a trip that has no `ig_response` goes straight to the brainstorm screen (`isDraft`, `App.jsx:6414-6415`). `BrainstormView` then loads saved routes from `brainstorm_items` (`App.jsx:1784-1792`). If none exist, an empty state with a manual "Generate plans" button is shown (`App.jsx:2496-2537`) — RG does _not_ auto-fire on draft resume.

## 2. Frontend request + streaming (`BrainstormView.generate`, App.jsx:1928)

`generate(addMore)` guards against double-fire with `rgInFlight` ref (`App.jsx:1927-1931`), then POSTs to `/functions/v1/generate-brainstorm` (`App.jsx:1953-1986`) with the user's access token and body: `destinations, styles, budget, travelMonth, numDays, arrivalCity, departureCity, notes, existingPlans, baseLocation, numPlans, tripId`.

- `numPlans` is 4 for a fresh run; for "Show me more plans" it's `min(4, 12 - visibleTier1Count)` — a hard cap of 12 route ideas (`App.jsx:1976-1983`; cap UI at `App.jsx:2748-2778`).
- `existingPlans` (titles of current tier-1 items) is sent on add-more so the model avoids duplicates (`App.jsx:1970-1974`).
- The RG loading state bubbles up via `onGeneratingChange` → `setRoutesGenerating` (`App.jsx:1735-1737`, `10324`, declared `App.jsx:6841`) and is used e.g. to hide chat suggestions while RG streams (`App.jsx:14122`).

**Streaming parse:** the response is SSE (`data: "<json-encoded text delta>"` lines). The client runs a hand-rolled incremental JSON parser (`tryParseItem`, `App.jsx:2007-2092`) that tracks brace depth / string / escape state and, each time a top-level `{...}` closes, `JSON.parse`s it. Every complete item with `title` + `category` is pushed into local state immediately — route cards appear one-by-one as they stream. In pre-trip mode each item gets a `temp_<n>` id and (for tier 1) a `routeLabel` of `P<n>` (`App.jsx:2050-2058`). If the stream finishes with zero items, the client throws `no_items` → "Took too long to respond — please try again." (`App.jsx:2112`, `2186-2199`).

**Loading UX:** 4 shimmering skeleton cards before the first route arrives (`App.jsx:2539-2622`), plus additional skeletons below already-streamed cards while more are in flight (`App.jsx:2676-2743`). The route map shows its own skeleton — pulsing colored pins + "Plotting plans…" (`MapView.jsx:641-698`).

## 3. Backend — `supabase/functions/generate-brainstorm/index.ts`

Gate order (`index.ts:84-94`):

1. `llmKillSwitch` — env `LLM_KILL_SWITCH=true` returns 503 (`_shared/credits.ts:209-226`).
2. `authenticateUser(req)` — verifies bearer JWT via service-role `auth.getUser`, rejects the raw anon key, loads `profiles.credits` (`credits.ts:94-117`); 401 on failure.
3. Pre-flight credits: `user.credits < 1.0` → `outOfCredits` HTTP 402 with `{code: "insufficient_credits"}` (`index.ts:89-91`, `credits.ts:128-143`). The comment notes RG can cost ~6 credits worst case; the 1.0 floor just prevents boundary overdraw (actual deduction happens post-stream).
4. `rateLimit(user.id)` — 20 calls/min/user via a `incr_rate_limit` SECURITY DEFINER RPC; 429 with `Retry-After: 60`; fails open on DB errors (`credits.ts:161-204`).

**Model + prompt (`index.ts:156-170`):** `claude-sonnet-4-6`, `max_tokens: 4000`, `temperature: 0.7`, `stream: true`. The fully static system prompt is sent as a single block with `cache_control: {type: "ephemeral"}` (prompt caching; beta header at `index.ts:177`). The prompt (`index.ts:21-76`) asks for a raw JSON array (no markdown fences) of:

- **Tier 1 — exactly 4 route options** with fields `title, tagline, tier:1, category:"Route", icon, city` (comma-separated list of _every_ city named in the days — used to plot the map), `days` (one readable string per day; `**double asterisks**` bold only the 1–2 most important words per day, never the same place twice), `bestFor`, `warning` (nullable), `recommended` (exactly one route `true`), and `points` (2–4 `{text, good}` facts, must address traveler-notes requirements).
- Route rules: realistic pacing, 2+ nights per base, minimal transit, geographic coherence, seasonal awareness, in-region default airports, genuinely distinct routes.
- **Tier 2 — 15–20 named experiences** (though both user-message variants end with "Do NOT generate tier 2 experiences — only routes", `index.ts:144/154`, so in practice current RG requests routes only).
- **City-level destinations** (e.g. "Tokyo") still get 4 routes, but as neighbourhood routes.
- A **"Help me decide"** variant (`index.ts:130-144`): when the destination is "Help me decide"/"open to ideas", each route is a different country/region, with hard rules on seasonal weather and flight-time-vs-trip-length (round-trip travel ≤ 20% of trip days) relative to `baseLocation`.

**Response relay (`index.ts:196-295`):** the function re-streams Anthropic's SSE, forwarding only `content_block_delta` text as `data: <JSON string>` events and a final `data: [DONE]`. Real token usage is captured from `message_start`/`message_delta` events via `accumulateStreamUsage` (`credits.ts:300-316`), with a `length/4` estimate fallback.

**Billing + logging (`index.ts:249-285`):** after the stream closes, wrapped in `runInBackground` (`EdgeRuntime.waitUntil`, `credits.ts:23-32`, so the isolate isn't reclaimed mid-write):

- Fire-and-forget insert into `llm_usage` (trip_id, function_name, model, token counts incl. cache columns).
- `deductCredits` (`credits.ts:230-275`): computes USD from Sonnet rates ($3/$15 per Mtok, cache write 1.25×, cache read 0.10× input) and charges `ceil((usd / 0.007) * 100) / 100` credits via the atomic `deduct_credits` RPC. Deduction failures are logged, never user-facing.

Errors from Anthropic bubble as a 500 `{error}` JSON (`index.ts:296-302`); the client maps 529/"overloaded" to a friendly retry message (`App.jsx:2192-2195`).

## 4. Credit gating on the frontend

On HTTP 402 `generate()` calls `openPaywall("Generating routes needs credits.")` directly and aborts (`App.jsx:1988-1993`) — note it uses `openPaywall` from `src/credits.js:70`, not the `handleGatedResponse` wrapper (`credits.js:93-107`) that some other callers use; behavior is equivalent (paywall sheet opens, call aborts). After every RG attempt (success or failure) the balance is re-fetched with `refreshCredits(session.user.id)` (`App.jsx:2201`).

## 5. Persistence — `brainstorm_items` table

After the stream completes, if there's a trip id (`trip?.id || editTripIdRef.current`, `App.jsx:2114`):

- Fresh run: `DELETE` all existing `brainstorm_items` for the trip, then `INSERT` the streamed items (`App.jsx:2126-2154`). Add-more: append starting after the current max `position` (`App.jsx:2117-2124`).
- Row shape (`App.jsx:2131-2150`): scalar columns `trip_id, title, city, category, note (tagline), icon, geocode, position, tier`, plus a `data` jsonb blob holding `tagline, days, bestFor, warning, recommended, points, routeLabel`. `dismissed` and `selected` are also columns (updated at `App.jsx:2653-2658`, `8838`).
- The insert's returned rows (real UUIDs) replace the `temp_*` items in state, deduped by id and title (`App.jsx:2157-2179`).
- On load, rows are flattened (`{...row, ...row.data}`) and `days`/`points` are normalized back to plain strings / `{text, good}` (`loadSavedBrainstorm`, `App.jsx:1854-1909`).
- Routes are additionally re-saved when the user hits Build (`handleGenerate` save path, `App.jsx:8388-8414`, with `selected: it.vote === 1`) and after chat `update_route` edits (full delete + re-insert, `App.jsx:8820-8853`). Editing a trip's itinerary keeps `brainstorm_items` so the user can "Explore Other Plans" later (`App.jsx:8366`).

There is no route data on the `trips` row itself; only `ig_request` (the form snapshot) lives there.

## 6. Route labels (P1, P2, …)

Labels are **computed at render time from the display index**, not read from storage: `RouteCard` receives `routeLabel={`P${idx + 1}`}` where `idx` is the index within `tier1Items` — the non-dismissed tier-1 list (`App.jsx:2624-2637`; filter at `App.jsx:2241-2243`). Dismiss/modify callbacks use the same `P${idx + 1}` (`App.jsx:2639-2642`).

Why: the chat edge function builds its context the same way — `PLAN P${i + 1} (id="...")` over the non-dismissed routes the client sends (`chat/index.ts:47-56`; client filters dismissed at `App.jsx:9121`). Computing from display index keeps card labels and the LLM's labels in lockstep after dismissals renumber the list. Actual identity is always the DB UUID; labels are presentation only.

Caveat: a `routeLabel` _is_ written into the `data` jsonb (`App.jsx:2148`) and `loadSavedBrainstorm` backfills missing ones (`App.jsx:1890-1901`), but the render path ignores stored labels — the `P${idx+1}` prop always wins. The stored field is effectively vestigial for display.

## 7. Route selection and Build

- Route cards are single-select: `castVote` zeroes all other tier-1 votes (`App.jsx:2206-2225`); selection is mirrored up via `onSelectionChange` → `pretripSelectedRouteId` (`App.jsx:2256-2261`, `10363`), and external selection (map pill tap, chat `select_route`) syncs back down (`App.jsx:2309-2323`). Selecting fires PostHog `route_selected` (`App.jsx:2209`).
- With a route selected, a "Build My Itinerary →" CTA appears (`App.jsx:12554-12576`) → `openPreIgSheet` (budget / pace / morning-start / extra notes). "Generate Itinerary →" merges the pre-IG answers into the form and calls `handleBuildFromBrainstorm(voted, mergedForm)` (`App.jsx:12960-12989`); if an itinerary already exists, a replace-confirmation diff sheet intervenes (`App.jsx:13242+`).
- `handleBuildFromBrainstorm` (`App.jsx:7817-7841`) finds the voted route, freshens items against `pretripRoutes` (so chat edits are included), derives arrival/departure from `baseLocation` if unset, and calls `handleGenerate` (IG). IG uses the chosen route's `city` list as its destinations (`App.jsx:7885-7897`) and navigates to the Magazine tab while the itinerary streams (`App.jsx:7870-7873`).

## 8. Dismiss, bulk dismiss, modify, more plans (chat actions)

- **Card dismiss** (✕ on card): marks the item `dismissed: true` locally and in DB (`App.jsx:2641-2659`), then posts a `system-undo` chat message (`onDismissRoute`, `App.jsx:10349-10361`). Undo goes through `undoDismissRef` which flips `dismissed: false` in state + DB (`App.jsx:1756-1773`).
- **Chat `dismiss_route`** supports a single `routeId` or a bulk `routeIds` array (`App.jsx:8859-8894`; contract defined in the chat prompt, `chat/index.ts:143-147`: "Use routeIds (array) when dismissing multiple plans at once… 'clear all plans', 'dismiss P1 to P6'"). Bulk undo iterates `undoDismissRef` per id (`App.jsx:13869-13875`).
- **Chat `update_route`** replaces a route's fields by id and re-persists all items (`App.jsx:8820-8856`); mass edits return 3 routes plus a `pending_routes` action whose `routeIds` the client drains with follow-up chat calls (`chat/index.ts:205`, `App.jsx:9013-9031`).
- **Modify button** on a card just opens chat pre-filled with `Modify P<n>: ` (`App.jsx:10343-10348`).
- **"✨ Show me more plans"** button calls `generate(true)` (`App.jsx:2780-2781`); chat's `generate_more_plans` triggers the same via ref (`App.jsx:8896-8899`). Capped at 12 visible routes.

## 9. Route map — `RouteMapView` (`src/components/MapView.jsx:454`)

Rendered as the mobile "Map" tab (`App.jsx:10383-10411`) and persistently in the desktop right column (`App.jsx:13551-13553`).

- **Destination centering before pins exist:** geocodes the destination via Photon and converts its `extent` to Leaflet bounds; `DestCenter` fits those bounds (or `setView(coords, 8)`) while RG is still running (`MapView.jsx:465-492`, `49-61`, applied only when `allVisiblePins.length === 0`, `MapView.jsx:735-737`).
- **Pin resolution:** for each route, splits the `city` field on commas and geocodes every city via `geocodePlace(city, routeBias, city)` with the trip destination as bias — or the route's own first city for "Help me decide" trips where a single bias would be wrong (`MapView.jsx:494-526`; the null-destination rationale is at `App.jsx:10396-10408`).
- **Rendering:** pill picker ("All plans" + one per route, colored from the shared `DAY_COLORS` palette); markers are colored `divIcon` dots keyed by the route's index in the full list, with popups showing city, stop number, route title, and a Google Maps link (`MapView.jsx:585-789`). Polylines were deliberately removed — markers alone convey geography (`MapView.jsx:747-749`). Selecting a pill filters pins to one route; `FitBounds` refits on every pin change (`MapView.jsx:63-80`, `738`).
- **Leaflet crash guards:** `MapCleanup` cancels in-flight animations on unmount (`map.stop()`) but only if `map._mapPane` still exists, avoiding the `_leaflet_pos`-on-detached-DOM crash (`MapView.jsx:39-47`). On mobile the map only mounts when its tab is active so Leaflet initializes with real container dimensions (`App.jsx:10379-10383`).

## 10. Regeneration / edit-details recap

Going back to Edit Details (`App.jsx:10330-10337`) reopens the setup form. On submit, change detection decides: structural change → confirmation sheet warns routes will be regenerated; confirming runs `doSetupComplete(form, true)` which clears routes/days/digests and re-fires RG; soft changes let the user keep existing routes. Cancelling returns to the brainstorm tab with everything intact (`App.jsx:13014-13017`).

## Key files

- `src/App.jsx` — `BrainstormView` (1705–2900), `RouteCard` (1165), setup→RG trigger (7555–7815), build flow (7817–7900), brainstorm_items persistence (2114–2179, 8388–8414), chat route actions (8820–8899, 9013–9031)
- `src/components/MapView.jsx` — `RouteMapView` (454), `FitBounds` (63), `MapCleanup` (39), `DestCenter` (51)
- `src/main.jsx` — `parseUrl()` URL↔tab mapping (76–111)
- `src/credits.js` — `openPaywall`, `handleGatedResponse`, `refreshCredits`
- `supabase/functions/generate-brainstorm/index.ts` — RG edge function (prompt at 21–76, gates at 84–94, streaming/billing at 196–295)
- `supabase/functions/_shared/credits.ts` — `authenticateUser`, `rateLimit`, `deductCredits`, `costToCredits`, stream-usage helpers
- `supabase/functions/chat/index.ts` — plan labels + `dismiss_route`/`update_route`/`pending_routes` contracts (47–56, 132–214)
