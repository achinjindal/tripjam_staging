# 07 — Board

The Board is the trip's utility tab: a card list (Travel & Hotels, Expenses, Notes, To-do, Bookmarks) where tapping a card swaps in a full-screen sub-view (`src/components/BoardView.jsx`, 3,248 lines). Each widget persists independently — Notes and logistics write columns on `trips`; To-dos, Bookmarks, and Expenses each have their own table (`trip_todos`, `trip_bookmarks`, `trip_expenses`) with RLS scoped to the trip owner. Two widgets have AI assists (both Haiku 4.5, credit-metered): `generate-todos` for checklist suggestions and `estimate-expenses` for a planned budget. The Travel & Hotels sub-view (`LogisticsTab`) is where flights and hotels live now — flight times saved here feed Day 1 / last-day arrival/departure banners, the chat context, and (on regeneration) the IG day-1/last-day time constraints.

`BoardView` is mounted from `src/App.jsx:12058-12075` with `trip`, `days`, and the save callbacks. There are **no realtime subscriptions** anywhere in the Board — every sub-view fetches its rows on mount, and the card summaries re-fetch when you return from a sub-view (the summary effect depends on `activeSection`, `BoardView.jsx:2798-2814`). Sub-view navigation pushes a history entry so the browser/Android back button closes the sub-view instead of leaving the trip (`BoardView.jsx:2772-2796`). A deep link exists: clicking the flight banner's edit affordance on Day 1 or the last day sets `boardInitialSection = "logistics"` and switches to the Board tab (`src/App.jsx:11857-11863`, `11894-11901`), which `BoardView` consumes via the `initialSection` prop (`BoardView.jsx:2777-2782`).

Card order on the Board screen: **Travel & Hotels → Expenses → Notes → To-do → Bookmarks** (`BoardView.jsx:2897-3242`). Sections below follow that order.

---

## 1. Travel & Hotels (`LogisticsTab`)

Sub-view key `"logistics"`; component at `BoardView.jsx:2368-2753`. This replaced the flight/hotel steps of the setup wizard — `SetupForm` still _prefills_ `arrivalTime`/`arrivalCity` etc. from `trip.arrival_time`/`ig_request` for regeneration (`src/components/SetupForm.jsx:310-335`), but entry/editing happens here.

### Flight (travel) entry

- Two blocks — **Arriving** and **Departing** — each with a `ModePills` selector (flight / train / bus / road, `BoardView.jsx:2175-2206`), a `CityInput`, and a `<input type="time">` (time hidden for `road` mode, `BoardView.jsx:2590`, `2650`).
- Dates are read-only labels derived from `trip.start_date` / `trip.end_date` (`BoardView.jsx:2508-2515`) — arrival is always Day 1, departure always the last day.
- When mode is `flight`, `CityInput` runs in `airportOnly` mode (Google Places autocomplete restricted to `types: "airport"`, see §6).
- **Auto-resolution**: on mount, if `trip.arrival_city`/`departure_city` are empty and the mode is flight, an effect lazy-imports `src/airports.js` and calls `resolveAirportForCity(days[0].city)` / `resolveAirportForCity(lastDay.city)` (`BoardView.jsx:2406-2452`). On a hit it fills `"<Airport Name> (IATA)"`, defaults times to `12:00` (arrival) / `19:00` (departure), and **auto-saves immediately** via `onSaveFlights` — no user action needed.
- `resolveAirportForCity` (`src/airports.js:44-49`) geocodes the city via `geocodePlace` from `src/photos.js`, then scans the bundled OurAirports dataset (`src/airports-data.json`, lazy-loaded, medium/large airports with IATA + scheduled service) for the nearest airport within 250 km by haversine (`src/airports.js:16-32`).

### Hotel entry

- One `CityInput` per unique itinerary city (`cities = [...new Set(days.map(d => d.city))]`, `BoardView.jsx:2375`), prefilled from `trip.hotels_data` (`BoardView.jsx:2453-2460`).
- Each input runs in `hotelCity` mode: Google Places autocomplete with `types: "lodging"` and the query biased by appending the city (`"${val} ${hotelCity}"`, `BoardView.jsx:2234-2235`).

### Save + apply

A single sticky **"Save and update itinerary"** button, enabled only when flights or hotels differ from the saved trip values (`BoardView.jsx:2475-2493`). `handleSaveAll` runs three callbacks in sequence (`BoardView.jsx:2485-2493`):

1. **`onSaveFlights` → `saveLogisticsFlights`** (`src/App.jsx:7431-7487`): writes `trips.arrival_city`, `arrival_time` (composed as `"${trip.start_date}T${HH:MM}:00"`), `arrival_mode`, `arrival_airport_iata`, and the departure equivalents, plus `has_car`. IATA codes are taken from the explicit param (auto-resolution path) or parsed from a trailing `"(XXX)"` suffix in the city string (`src/App.jsx:7449-7460`).
2. **`onSaveHotels` → `saveLogisticsHotels`** (`src/App.jsx:7489-7496`): writes the non-empty `{city, name}` entries to **`trips.hotels_data`** (jsonb), or `null` if all empty.
3. **`onApplyHotels` → `applyHotelsToItinerary`** (`src/App.jsx:7498-7536`): for each named hotel, finds the **first** day in that city containing an activity with `type === "hotel"`, renames it to `"Check in at ${name}"` (`activities.title` update), then fetches a hotel photo via `places-proxy?action=hotel-photo` and writes `activities.photo_url`; local state is updated via `editActivity`. That is the entire "apply" — no re-planning, no time changes, and days without a hotel-type activity are skipped.

Note there is no `trips.flights_data` column — flight data lives in the flat `trips` columns above. `arrival_time`/`departure_time` are used throughout the code but do **not** appear in any checked-in migration (unlike `arrival_city`/`hotels_data` from `20260326000002_add_logistics_to_trips.sql`, modes from `20260327000001`, and `base_location`/`*_airport_iata` from `20260511000001`) — they predate the migrations directory.

### How flight times affect the itinerary

Saving flights does **not** regenerate or re-time existing itinerary days. What actually happens:

- **Rendering**: Day 1 gets an `ArrivalTimeline` banner (`src/App.jsx:5074+`, wired at `11836-11863`) showing "Land at HH:MM … ready by HH:MM" — the ready time is arrival + a hardcoded 90-min buffer rounded to 30 min, computed client-side. The last day gets the departure equivalent. If `trip.base_location` is set, a haversine-based estimate (800 km/h cruise + 90 min) adds an origin-leg "Departs ~HH:MM" pill (`src/App.jsx:6700-6768`).
- **Chat**: the chat edge function injects a `Logistics:` line (arrival/departure time, city, mode) into the trip context (`supabase/functions/chat/index.ts:82-100`), so Trippy answers flight-aware questions and can move Day 1 activities on request.
- **Generation (IG)**: `generate-itinerary` receives `arrivalTime`/`departureTime`/modes in the request body (`src/App.jsx:7903-7913`, defaulting to `09:00`/`22:00` when unset) and converts them into hard prompt constraints — mode-specific buffers (flight 90/150 min, train 45/60, bus/road 20-30) produce a "Day 1's FIRST activity MUST start at or after HH:MM" rule and a last-day cutoff (`supabase/functions/generate-itinerary/index.ts:148-200`). But the IG request is built from the setup form (prefilled from `trip.arrival_time` at `SetupForm.jsx:318-333`), so Board-saved flight times only reach the LLM on the **next** generation/regeneration.

---

## 2. Expenses (`ExpensesView`)

Sub-view key `"expenses"`; component at `BoardView.jsx:1230-2172`.

- **Table**: `trip_expenses` (`supabase/migrations/20260428000003_create_trip_expenses.sql`) — `title`, `amount numeric`, `currency` (default `USD`), `category`, `is_planned boolean`, `day_label`, `note`, `position`. `day_label`/`note` exist in the schema but are not set by this UI. The same migration adds `trips.budget_amount` / `trips.budget_currency`.
- **Two tabs**: _Planned_ vs _Actual_, mapped to `is_planned` (`BoardView.jsx:1245`, `1445-1447`). Adding an expense inherits the active tab's flag.
- **Manual entry**: title + currency select (~40 ISO codes, `BoardView.jsx:2006-2047`) + amount + category pill (Stay/Transport/Food/Activities/Shopping/Other, `BoardView.jsx:1205-1212`). Edit and delete are inline; all writes are optimistic (state first, then Supabase).
- **Budget**: tap-to-edit budget bar reading/writing `trips.budget_amount` (`BoardView.jsx:1335-1345`); progress bar colors flip at 80% (warning) and 100% (error) of planned total (`BoardView.jsx:1641-1654`). "Spent so far" shows the actual-tab total against budget.
- **Currency caveat**: totals, the category chips, and the budget bar sum raw `amount` values with `$` formatting regardless of each row's `currency` (`BoardView.jsx:1448-1469`) — there is no FX conversion. There is also **no splitting logic** (no per-person or per-traveler attribution anywhere in the table or UI).

### AI estimate (`estimate-expenses`)

The "✨ Estimate" button only appears while there are zero planned expenses (`BoardView.jsx:1516-1533`). `generateEstimate` (`BoardView.jsx:1347`) POSTs `{ trip }` to `estimate-expenses` with the user's session token. (A vestigial direct-Anthropic `fetch` with an empty API key used to fire before this path; removed 2026-07-13.)

Edge function (`supabase/functions/estimate-expenses/index.ts`):

- Gated: `llmKillSwitch` → `authenticateUser` → `credits < 1.0` returns 402 → `rateLimit` (`index.ts:38-46`).
- Model: `claude-haiku-4-5-20251001`, max 1,024 tokens, single-shot (no streaming). Prompt asks for 8–12 USD line items as a raw JSON array `{"title","amount","category"}` with specific titles (`index.ts:17-31`); duration is derived from trip dates (fallback 5 days) and budget level from `trip.ig_request.budget` (`index.ts:50-71`).
- Logs to `llm_usage` and calls `deductCredits` fire-and-forget (`index.ts:92-118`). Response: `{ items }` (empty array on parse failure or error).

Client merge: filters out items whose lowercased title matches an existing expense, bulk-inserts the rest as `is_planned: true` rows, and — if no budget is set — auto-sets `trips.budget_amount` to the planned total. A 402 routes through `handleGatedResponse` and opens the paywall (fixed 2026-07-13; previously swallowed silently), and credits refresh after a successful call.

---

## 3. Notes (`NotesView`)

Sub-view key `"notes"`; component at `BoardView.jsx:14-150`.

- One full-screen textarea seeded from `trip.board_notes` (column added in `supabase/migrations/20260406000001_add_board_notes_to_trips.sql`).
- **Autosave** debounced 1 s per keystroke with a "Saving… / ✓ Saved" indicator (`BoardView.jsx:26-38`); a pending save is flushed on unmount so navigating back within the debounce window doesn't lose text (`BoardView.jsx:40-47`).
- The save callback is inlined in `App.jsx`: optimistic `setTrip` then `trips.update({ board_notes })` (`src/App.jsx:12068-12074`). The Board card shows a 120-char preview (`BoardView.jsx:2882-2885`).

---

## 4. To-do (`TodoView`)

Sub-view key `"todo"`; component at `BoardView.jsx:161-809`.

- **Table**: `trip_todos` (`supabase/migrations/20260406000002_create_trip_todos.sql`) — `text`, `done`, `position`; `category` and `due_date` (both free `text`) added in `20260428000002`. Fetched on mount ordered by `position`.
- **Layout**: top half is the saved checklist grouped by category (Bookings, Documents, Health & safety, Money, Packing, Day of travel, + Other; `BoardView.jsx:152-159`, `310-318`); bottom panel holds AI suggestions; a manual add input is pinned to the footer (`BoardView.jsx:761-806`). Toggle/delete/add are optimistic writes.
- **Due dates are relative labels, not dates**: the LLM assigns strings like `"2 months before"` / `"Day of travel"`, stored verbatim in `due_date` and rendered as a `⏰` line on undone items (`BoardView.jsx:515-526`). Nothing converts them to calendar dates.

### AI suggestions (`generate-todos`)

- **Auto-generates on first visit** when the list is empty (`BoardView.jsx:179-183`); otherwise via the "✨ Generate" button. Request: `POST { trip }` with the session token (`BoardView.jsx:188-220`).
- Edge function (`supabase/functions/generate-todos/index.ts`): same gate chain as estimate-expenses (auth, `credits < 1.0` → 402, rate limit, kill switch). Model `claude-haiku-4-5-20251001`, max 1,024 tokens. System prompt requests 15–20 destination-specific items as raw JSON `{"text","category","due_date"}` with the six categories and six due-date labels (`index.ts:17-41`); user message includes destination, travelers, budget label, styles, `arrival_mode`, travel month, and trip notes (`index.ts:70-75`). Logs `llm_usage` + `deductCredits` fire-and-forget; returns `{ items }`.
- **Merge**: suggestions whose lowercased text matches an existing todo are dropped client-side. Suggestions live only in component state (lost on back-navigation) until accepted — per-item ✓ inserts a single row with `category`/`due_date`, "Accept all" bulk-inserts, ✕ discards locally. A 402 routes through `handleGatedResponse` and opens the paywall (fixed 2026-07-13; previously swallowed silently).

The unified chat can also insert/toggle todos via its action vocabulary (see `docs/user-journeys/08-chat.md`), writing to the same table.

---

## 5. Bookmarks (`BookmarksView`)

Sub-view key `"bookmarks"`; component at `BoardView.jsx:812-1202`.

- **Table**: `trip_bookmarks` (`supabase/migrations/20260428000001_create_trip_bookmarks.sql`) — `title`, `url`, `icon` (default 🔗), `position`.
- **No AI, no network metadata fetching.** "Title auto-fetch" is purely local URL parsing: when the URL field is filled and title is empty, the last path segment (dashes/underscores → spaces) or the hostname becomes the suggested title (`BoardView.jsx:847-864`). The icon is a regex heuristic on the URL — booking.com → 🏨, airbnb → 🏠, flight/skyscanner/kayak → ✈️, Google Maps → 📍, tripadvisor → ⭐, Google Docs/Drive → 📄, visa/embassy → 🛂, insurance → 🛡️, else 🔗 (`BoardView.jsx:833-844`) — computed at save time and stored in the `icon` column.
- Missing `https://` is prepended on save (`BoardView.jsx:870`, `898`). Rows render as external links (`target="_blank" rel="noopener noreferrer"`) with inline edit/delete (`BoardView.jsx:1024-1097`).

---

## 6. `CityInput` — shared autocomplete component

Defined at `BoardView.jsx:2211-2365` and exported (`BoardView.jsx:3248`); `SetupForm` imports it (`src/components/SetupForm.jsx:10`) for destination and base-location fields (e.g. `SetupForm.jsx:1251`).

- **Backend**: Google Places autocomplete via the `places-proxy` edge function — `POST ${PLACES_PROXY}?action=autocomplete` with `PLACES_HEADERS` (anon-key bearer), both exported from `src/theme.js:69-74`. The proxy maps `types` to Google's `includedPrimaryTypes` and caches results (`supabase/functions/places-proxy/index.ts:145-158`, `393-407`).
- **Three modes** (`BoardView.jsx:2234-2235`):
  - `airportOnly` → `types: "airport"` (flight fields in LogisticsTab);
  - `hotelCity="<city>"` → `types: "lodging"`, with the query biased as `"${input} ${city}"` (hotel fields);
  - neither → unrestricted place autocomplete (plain city — SetupForm destinations/base location, non-flight arrival/departure).
- Debounced 200 ms with `AbortController` cancellation and a module-level result cache keyed on `query|types` (`BoardView.jsx:2209`, `2236-2272`). Picking a suggestion writes only the `mainText` string — no place ID or coordinates are stored. `openUpward` flips the dropdown above the input for mobile-keyboard situations (`BoardView.jsx:2296-2298`).

---

## 7. Persistence summary

| Widget    | Storage                                                                                   | Migration                                                                                                           | Refresh model                                                     |
| --------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Notes     | `trips.board_notes`                                                                       | `20260406000001`                                                                                                    | debounced autosave; optimistic                                    |
| To-dos    | `trip_todos` (`text`, `done`, `position`, `category`, `due_date`)                         | `20260406000002`, `20260428000002`                                                                                  | fetch on sub-view mount; optimistic writes                        |
| Bookmarks | `trip_bookmarks` (`title`, `url`, `icon`, `position`)                                     | `20260428000001`                                                                                                    | fetch on sub-view mount; optimistic writes                        |
| Expenses  | `trip_expenses` + `trips.budget_amount`/`budget_currency`                                 | `20260428000003`                                                                                                    | fetch on sub-view mount; optimistic writes                        |
| Flights   | `trips.arrival_city/_time/_mode/_airport_iata`, `departure_*`, `has_car`, `base_location` | `20260326000002`, `20260327000001`, `20260511000001` (`arrival_time`/`departure_time` not in checked-in migrations) | explicit Save button (plus silent auto-save of resolved airports) |
| Hotels    | `trips.hotels_data` (jsonb `[{city, name}]`) + `activities.title`/`photo_url` on apply    | `20260326000002`                                                                                                    | explicit Save button                                              |

All three side tables have RLS policies restricting access to trips where `created_by = auth.uid()` (see each `create_*` migration; broadened/fixed in `20260428000004_fix_rls_policies.sql`). No table uses Supabase Realtime in the Board — collaborators see each other's changes only on remount/refetch.

---

## Key files

- `src/components/BoardView.jsx` — all widgets, `LogisticsTab`, `CityInput`, `ModePills`
- `src/App.jsx:7412-7536` — `saveFlights`, `saveLogisticsFlights`, `saveLogisticsHotels`, `applyHotelsToItinerary`; `12058-12075` — BoardView mount; `6700-6768` — origin-leg time estimation; `11836-11901` — arrival/departure banner wiring
- `src/airports.js` + `src/airports-data.json` — nearest-airport resolution (OurAirports)
- `src/theme.js:69-74` — `PLACES_PROXY`, `PLACES_HEADERS`
- `supabase/functions/generate-todos/index.ts`, `supabase/functions/estimate-expenses/index.ts` — Haiku 4.5 AI assists
- `supabase/functions/places-proxy/index.ts` — autocomplete/hotel-photo proxy
- `supabase/functions/generate-itinerary/index.ts:148-200` — arrival/departure prompt constraints
- `supabase/migrations/20260406000001`, `20260406000002`, `20260428000001-3`, `20260326000002`, `20260327000001`, `20260511000001` — Board schema
