# User Journey 04 — Itinerary Generation (IG)

IG turns a selected route (from Route Generation) into a full day-by-day plan. The user taps **Build My Itinerary →**, tunes a few preferences in a pre-IG bottom sheet (pre-filled by a Haiku call that mines their notes/chat), and the app makes a **single streaming call** to the `generate-itinerary` edge function. The model is instructed to emit a `compact` day summary array _before_ the detailed `days` array, so the client gets a quick preview from the same stream, tracks per-day progress, and finally persists everything to `trips`, `days`, and `activities`.

---

## 1. Entry point: "Build My Itinerary" CTA

The CTA appears once a route is selected on the brainstorm (Plans) screen:

- Desktop: pinned bar at the bottom of the center column, gated on `useDesktopShell && screen === "brainstorm" && pretripTab === "brainstorm" && pretripSelectedRouteId` — `src/App.jsx:12500-12530`.
- Mobile: same button inside the collapsed chat bar — `src/App.jsx:12554-12576`.

Both call `openPreIgSheet` (`src/App.jsx:6799`).

## 2. Pre-IG preference extraction (`extract-preferences`)

`openPreIgSheet` first calls the `extract-preferences` edge function with `{ notes: pendingForm?.notes, chatHistory: chatMessages (minus system-undo entries), tripId }` — `src/App.jsx:6805-6821`. The response pre-fills `preIgForm`; on any failure or non-OK response it falls back to defaults `{ budget: "mid", morningStart: "early", pace: "active" }` and the sheet opens regardless (`src/App.jsx:6822-6836`).

`supabase/functions/extract-preferences/index.ts`:

- Requires auth via `authenticateUser` (401 otherwise) — `index.ts:34-35`.
- If there are no notes and no chat history, returns all-null without calling the LLM — `index.ts:53-57`.
- Model: `claude-haiku-4-5-20251001`, `max_tokens: 100`, a keyword-hint system prompt that maps free text to `budget` / `morningStart` / `pace` enums, returning `null` per field when no clue exists — `index.ts:10-23, 65-70`.
- Logs to `llm_usage` fire-and-forget (`index.ts:75-89`) but **intentionally does not call `deductCredits`** — the code comment at `index.ts:30-33` states this is a free system-internal call (~$0.0007) absorbed by the founder because it runs invisibly between the Build click and the sheet opening.
- Output is validated against the allowed enums; anything else becomes `null` — `index.ts:94-107`. Errors return all-null with HTTP 200 (`index.ts:108-113`), so the sheet never blocks on this call.

## 3. Pre-IG sheet ("Fine-tune your itinerary")

State: `showPreIgSheet` (`src/App.jsx:6785`) and `preIgForm = { budget, morningStart, pace, igNotes }` (`src/App.jsx:6788-6793`). Fields rendered in the bottom sheet:

| Field              | Options                                          | UI                                   |
| ------------------ | ------------------------------------------------ | ------------------------------------ |
| Budget range       | `budget` / `mid` / `luxury`                      | 3 cards — `src/App.jsx:12744-12781`  |
| Morning preference | `early` ("Early bird") / `late` ("Slow starter") | 2 cards — `src/App.jsx:12797-12852`  |
| Pace               | `relaxed` / `active`                             | 2 cards — `src/App.jsx:12868-12919`  |
| Additional detail  | free text `igNotes`                              | textarea — `src/App.jsx:12934-12954` |

**Generate Itinerary →** button (`src/App.jsx:12958-12990`):

- If `editingTrip?.ig_response` exists, it opens the replace-confirmation sheet instead of generating (`src/App.jsx:12960-12963`, see §7).
- Otherwise it merges `preIgForm` into `pendingForm` (`igNotes` are _appended_ to existing notes with a newline — `src/App.jsx:12967-12979`), builds `votedItems` from `pretripRoutes` with `vote: 1` on the selected route, and calls `handleBuildFromBrainstorm(voted, mergedForm)` (`src/App.jsx:12981-12989`).

`handleBuildFromBrainstorm` (`src/App.jsx:7817-7841`) freshens route data from `pretripRoutes`, derives `arrivalCity`/`departureCity` from `baseLocation` when unset, and calls `handleGenerate(finalForm, freshenedItems)`.

## 4. Backend: `generate-itinerary` edge function

`supabase/functions/generate-itinerary/index.ts` — one call, one SSE stream.

### Gating and setup

1. `llmKillSwitch` → 503 if `LLM_KILL_SWITCH=true` (`index.ts:91-92`, impl `_shared/credits.ts`).
2. `authenticateUser` → 401 (`index.ts:94-95`).
3. Pre-flight credit check: `user.credits < 1.0` → 402 via `outOfCredits` (comment notes IG can cost 20–50 credits worst case) — `index.ts:96-98`.
4. `rateLimit` → 429 at >20 calls/min/user (`index.ts:100-101`, `_shared/credits.ts:162-204`).

### Prompt structure

- **System prompt** (`index.ts:44-83`) is static and sent with `cache_control: {type: "ephemeral"}` so it's prompt-cached across requests (`index.ts:340-346`; beta header `prompt-caching-2024-07-31` at `index.ts:332`). It encodes the itinerary rules: specific hotel names, real place titles, fully-qualified `geocode` strings, day-trip handling, `package` IDs, per-activity `transition` objects (metro/bus/ferry/tram), mandatory inter-city transit fields (`service`, `from_station`, `to_station`, `transit_duration`, `cost_estimate`, `booking_tip`), per-day `wishlist` gems with a `near` anchor, per-day `transit_tip` (e.g. "Use Suica card · Day pass ¥600"), `summary` and `cities` writeups. Crucially it demands **output order: `compact` array before `days` array** — "The app renders compact immediately while days stream in" (`index.ts:78`).
- **Style rules** for only the selected trip styles are injected into the user message (not the cached system prompt) to save ~600 tokens — `index.ts:23-42, 132-137`.
- **Pace / morning notes** are prose blocks derived from the pre-IG choices — `index.ts:138-145`.
- **Flight/arrival awareness**: `arrivalTime` + `arrivalMode` produce a "DAY 1 CONSTRAINT (ABSOLUTE HARD RULE)" with a mode-specific readiness buffer (flight 90 min, train 45, bus/road 20), rounded to 30 min — `index.ts:147-183`. Similarly `departureTime`/`departureMode` produce a "LAST DAY CONSTRAINT" with departure buffers (flight 150, train 60, bus/road 30) mandating a final transit activity to the airport/station — `index.ts:185-208`. The frontend defaults these to `09:00`/`22:00` and `flight` when unset (`src/App.jsx:7910-7913`).
- **Selected route constraint**: from `votedItems`, the tier-1 upvoted route becomes a "SELECTED ROUTE (ABSOLUTE HARD CONSTRAINT)" block placed _above_ everything else. The function heuristically infers night-by-night overnight bases from the route's day template (regex for "return to / overnight in / day trip / X → Y" patterns) and emits a non-negotiable per-night sleep schedule plus the day-by-day template — `index.ts:217-304`. Upvoted/downvoted tier-2 experiences become include/avoid lines — `index.ts:306-315`.

### Model call and streaming protocol

- Model `claude-sonnet-4-6`, `max_tokens: min(16000, numDays*1800 + 2000)`, `temperature: 0.8`, `stream: true` — `index.ts:335-348`.
- The function re-emits Anthropic SSE `content_block_delta` text as its own SSE stream: each event is `data: <JSON-encoded text chunk>\n\n`, terminated by `data: [DONE]\n\n` — `index.ts:376-424`. Response content type `text/event-stream` (`index.ts:476-482`).

**"Two phases" clarification:** there is only **one LLM call and one stream**. The "compact fast phase" and "detailed streaming phase" are a client-side illusion created by the prompt's output-order rule — the small `compact` array arrives in the first seconds and is parsed/rendered before the large `days` array finishes streaming. (A comment at `src/App.jsx:7918` — "Single call: streams compact first, then full days" — confirms this; an older two-call design is gone.)

### Usage logging and credit deduction

- Real token counts are accumulated from `message_start`/`message_delta` usage events via `accumulateStreamUsage` (`index.ts:399`, `_shared/credits.ts`); if usage events never arrive, it falls back to length/4 estimates (`index.ts:429-432`, estimate built at `index.ts:358-373`).
- In the stream's `finally` block, both the `llm_usage` insert (with `cache_creation_tokens` / `cache_read_tokens`) and `deductCredits` run inside `runInBackground` (`EdgeRuntime.waitUntil`) — `index.ts:436-472`. The comment documents a past bug: fire-and-forget work after a long stream was killed by isolate teardown, dropping _every_ IG usage log and deduction (`_shared/credits.ts:12-19`).
- `deductCredits` charges `ceil((llm_cost_usd / 0.007) * 100) / 100` credits via the `deduct_credits` RPC, with cache-write at 1.25× and cache-read at 0.10× input rate — `_shared/credits.ts:52-77, 230-278`.

### Error paths

- Anthropic non-OK → throws → 500 JSON `{error}` (`index.ts:352-356, 483-489`).
- In-stream Anthropic `error` events are logged server-side but not forwarded as errors (`index.ts:410-415`); malformed SSE lines are skipped (`index.ts:418-420`).

## 5. Frontend: `handleGenerate` and streaming consumption

`handleGenerate(form, votedItems)` — `src/App.jsx:7843` onward.

### Setup

- Re-entrancy guard `_igInFlight` (module-level, `src/App.jsx:112, 7844-7845`).
- Resets `streamingDays`, `preloadedDaysRef`, `allDaysPlanned`, `detailedLoading/Ready`, `compactView` (`src/App.jsx:7860-7866`); sets `igGenerating = true` and navigates to the pre-trip **Magazine** tab so the user has content to read during generation (`src/App.jsx:7870-7873`).
- `numDays` computed from dates; `streamingTotal` set (`src/App.jsx:7875-7882`).
- Request body `igBody` (`src/App.jsx:7898-7916`): destinations come from the **selected route's city list** when available, falling back to form destinations (`src/App.jsx:7885-7897`); plus travelers, styles, budget/pace/morningStart (from the merged pre-IG form), notes, dates, arrival/departure city/time/mode, `votedItems`, `tripId`.
- Fetch with `AbortController` and a 180 s timeout (`src/App.jsx:7924-7938`). "Explore Other Plans" aborts an in-flight IG via `igAbortRef` (`src/App.jsx:11393-11399`).

### Credit gating (402)

`res.status === 402` → `openPaywall("Building the itinerary needs credits.")` and throw (`src/App.jsx:7940-7944`); the catch handler returns the user to the setup screen silently (`src/App.jsx:8236-8241`). Note: this path calls `openPaywall` from `src/credits.js:70` **directly** — the generic `handleGatedResponse` helper (`src/credits.js:93-106`, sets credits to 0, opens paywall, drains body, returns `true`) is used by the deep-dive, todo, and expense paths (since 2026-07-13).

### Parsing the stream

The client reads the SSE body, JSON-decoding each `data:` chunk into `accumulated` (`src/App.jsx:7947-7963`). On every chunk:

1. **Compact detection** — once both `"compact": [` and `"days": [` appear, everything before `"days"` is trimmed, brace-closed, and parsed (`src/App.jsx:7965-7981`). If it yields `compact` entries:
   - Compact entries are converted to placeholder day objects (`id: compact-N`) with a synthetic hotel check-in activity and highlight activities whose icons come from the LLM or a keyword→emoji fallback chain (`src/App.jsx:7988-8068`).
   - `setTrip` is updated with the itinerary name/dates and `ig_response: compactData` (`src/App.jsx:8084-8092`).
   - If editing an existing trip, the `trips` row is updated immediately (`ig_response`, `compact_ready_at`, `generation_started_at`) and a `generation_log` row inserted (`src/App.jsx:8093-8117`).
   - `setDays(compactDays)`; `setDetailedLoading(true)`. Navigation to the itinerary screen is deliberately **disabled** here (Magazine-first — comments at `src/App.jsx:8120-8123`).
2. **Progress tracking** — before compact completes, `streamingDays` counts `"label":` occurrences; after, it counts `"wishlist": [` markers in the `days` section (wishlist appears at the end of each day) — `src/App.jsx:8133-8153`. This drives the "✈ Planning Day X of Y" progress UI (`src/App.jsx:10820-10889`). `allDaysPlanned` flips when all day labels are seen plus a `"summary"` key or a large tail (`src/App.jsx:8154-8160`).

### Final parse and repair

When the stream ends, the accumulated text is stripped of code fences and parsed (`src/App.jsx:8167-8179`). On failure there is a two-step repair: (1) trailing-comma removal and in-string newline escaping; (2) a char-by-char truncation repair that tracks string/bracket state, backs out of a truncated string, strips dangling tokens, and closes open containers (`src/App.jsx:8180-8226`).

### Error handling (client)

- `AbortError` → silent return (`src/App.jsx:8230-8234`).
- Out of credits → back to setup, paywall already open (`src/App.jsx:8236-8241`).
- Any other failure **after** compact was shown → the compact itinerary is kept as a fallback and the user lands on the Magazine tab (`src/App.jsx:8245-8254`).
- Failure before compact → `generateError` set, back to setup (`src/App.jsx:8255-8259`).

## 6. Persistence

Saving happens **after** the stream fully completes and parses (compact-phase saves in §5 are the exception — `ig_response` gets the compact data early for editing trips):

1. **Trip row** (`src/App.jsx:8272-8385`): trip id is `editingTrip.id` or a client-side `crypto.randomUUID()` (avoids RLS issues). Payload includes `name`, `destination`, `start_date`/`end_date`, `generation_started_at` / `generation_completed_at` / `detailed_ready_at`, `ig_request` (the full parameter snapshot used later for the replace diff), `ig_response` (full parsed itinerary), `ig_count` (incremented), `base_location`, `summary`, `notes`, arrival/departure columns. `ig_request`/`ig_response` are `jsonb` columns (`supabase/migrations/20260408000003_add_ig_logs_to_trips.sql`). Editing updates in place and wipes existing `days` + `activities` first (`src/App.jsx:8338-8365`); new trips insert the row plus a `trip_members` organizer row (`src/App.jsx:8367-8384`).
2. **Brainstorm items** — the route options are persisted to `brainstorm_items` with `selected: vote === 1` so the user can revisit "Explore Other Plans" (`src/App.jsx:8388-8414`).
3. **Days + activities** — all days inserted in parallel into `days` (`label`, `date`, `city`, `position`, `description`, `wishlist` jsonb, `hotel_options`, `hotel_check_in_time`, `transit_tip` — the latter from `20260506000001_add_transit_tip_to_days.sql`), each followed by its `activities` rows (`time`, `title`, `geocode`, `geocode_end`, `type`, `duration`, `note`, `icon`, `package`, `position`, `added_by`, `transition_data`) — `src/App.jsx:8416-8476`. Base `trips`/`days`/`activities` table definitions predate the checked-in migrations (only column additions appear under `supabase/migrations/`).
4. **Post-save**: `setDays(savedDays)`, PostHog `ig_detailed_complete`, `refreshCredits`, `generation_log` update with `detailed_ready_at`, then land on the Magazine tab (`activeBottomTab = "brainstorm"`) with `screen = "itinerary"` — `src/App.jsx:8483-8539`. Days are also mirrored to localStorage for offline viewing (`src/App.jsx:6488-6495`).
5. **Background enrichment**: photos are fetched sequentially with a 500 ms delay per activity (Wikimedia rate-limit buffer) and written back to `activities.photo_url` (`src/App.jsx:8541-8567`); Day-1 activities plus all hotels are eagerly verified via `verifyActivity` in parallel, patching coords/titles in place (`src/App.jsx:8569-8612`).

### Pre-loading of geocodes/photos during and after streaming

- `preloadDay(dayIndex)` warms geocode + photo caches and lazily verifies unverified activities; idempotent via `preloadedDaysRef` (`src/App.jsx:6625-6683`).
- **While streaming**: an effect runs `preloadDay(i)` for every `i < min(streamingDays, days.length)` — so as soon as `streamingDays >= 1`, Day 1 (and each subsequently streamed day) is pre-loaded in parallel (`src/App.jsx:6690-6696`; comment notes this was previously Day-0-only).
- **On expand**: expanding Day N calls `preloadDay(i)` and `preloadDay(i + 1)` — the next day is warmed before the user gets there (`src/App.jsx:11740-11742`). Both live in `App.jsx`; `photos.js` supplies the underlying `geocodePlace` / `_fetchPhoto` caches.
- Day cards are only expandable when `detailedReady || i < streamingDays` (`src/App.jsx:11715`).
- Opening an existing trip pre-loads Day 1 after fetch (`src/App.jsx:6590`).

## 7. Itinerary replace confirmation

When the pre-IG sheet's Generate button is pressed and `editingTrip?.ig_response` exists, `showReplaceConfirm` opens instead (`src/App.jsx:6786, 12960-12963`). The sheet (`src/App.jsx:13243-13532`) computes a parameter diff between the stored `editingTrip.ig_request` and the current selection:

- **Route** (selected route title vs `igReq.votedRoute` or old itinerary name), **Budget**, **Pace**, **Morning**, **Dates**, **Travelers** — `src/App.jsx:13251-13312`.
- Zero changes → "Refresh itinerary?" mode: same route/preferences, fresh activities/restaurants/hotels ("✓ No changes to route or preferences") — `src/App.jsx:13313, 13362-13376, 13441-13455`.
- With changes → "Regenerate itinerary?" with an old→new strikethrough diff table (`src/App.jsx:13379-13440`).
- **Replace/Refresh Itinerary** merges `preIgForm` into `pendingForm` and calls the same `handleBuildFromBrainstorm` path (`src/App.jsx:13457-13483`); the old days/activities are deleted during persistence (§6.1). **Keep Current Itinerary** dismisses and returns to the itinerary tab (`src/App.jsx:13511-13531`).

There is also a separate **Edit Details** confirmation (`showEditConfirm`, `src/App.jsx:6787, 13010+`) for the trip-edit flow, where structural changes (destinations/duration/arrival/departure/base) force route regeneration (`src/App.jsx:7806-7814`) — out of scope here but adjacent.

## Key files

- `src/App.jsx` — CTA (`12500`, `12554`), `openPreIgSheet` (`6799`), pre-IG sheet UI (`12690-13006`), `handleGenerate` + streaming (`7843-8613`), `preloadDay` + streaming preload effect (`6625-6696`), expand preload (`11740-11742`), replace confirmation (`13243-13532`)
- `supabase/functions/generate-itinerary/index.ts` — IG edge function (system prompt `44-83`, constraints `147-315`, streaming `376-474`, billing `436-472`)
- `supabase/functions/extract-preferences/index.ts` — Haiku preference extraction (free by design, `30-33`)
- `supabase/functions/_shared/credits.ts` — `authenticateUser`, `outOfCredits`, `rateLimit`, `deductCredits`, `runInBackground`, stream-usage accumulation
- `src/credits.js` — `openPaywall` (`70`), `handleGatedResponse` (`93`)
- `supabase/migrations/20260408000003_add_ig_logs_to_trips.sql`, `20260506000001_add_transit_tip_to_days.sql`, `20260330000002_add_wishlist_to_days.sql` — persistence columns
