# 02 — Trip Creation

After signing in, the user lands on the trip list (`Home.jsx`) and starts a new trip via the **+ New Trip** button (or the empty-state CTA). That opens a 3-step wizard (`SetupForm.jsx`) hosted inside `App.jsx`: destinations → dates & travelers → free-text preferences. Submitting the wizard writes a draft row to the `trips` table (with a client-generated UUID), adds the creator to `trip_members`, and immediately hands off to Route Generation (RG) — covered in [03-route-generation.md](03-route-generation.md).

---

## 1. Home trip list (`src/Home.jsx`)

Rendered by `Root` in `main.jsx:279-303` when the authenticated screen is `"home"`.

**Loading trips** — `fetchData()` (`Home.jsx:78-117`) runs once on mount:

1. Query `trip_members` for rows where `user_id = session.user.id` (`Home.jsx:83-86`). If the user has no memberships, loading ends with the empty state.
2. Query `trips` with `.in("id", tripIds)`, ordered by `created_at` descending (`Home.jsx:96-100`).

**Offline cache** — on success the trip array is written to `localStorage` under `tripjam_trips` (`Home.jsx:104-106`). If the fetch throws (offline, Supabase down), the catch block reads that same key back and renders the cached list (`Home.jsx:109-113`). There is no staleness marker — cached trips render exactly like live ones.

**Card contents & status** — each card shows name, a status pill, destination, date range, and day count. Status logic is `tripStatus()` (`Home.jsx:5-15`):

| Condition             | Label           | Meaning                                     |
| --------------------- | --------------- | ------------------------------------------- |
| `ig_response` is null | **Planning**    | RG may be done but no itinerary yet (draft) |
| end date in the past  | **Past**        |                                             |
| today within range    | **In Progress** |                                             |
| otherwise             | **Upcoming**    |                                             |

**Card interactions:**

- **Click** — a _Planning_ trip goes to `onEditTrip` (routes/plans view, URL `/trip/:id/plans`), any other status goes to `onOpenTrip` (itinerary view, URL `/trip/:id`) (`Home.jsx:287-291`, `main.jsx:224-228, 291-295`).
- **ⓘ Info** — toggles a popover with `created_at` ("Generated") and `updated_at` ("Modified") timestamps (`Home.jsx:376-450`).
- **✏️ Edit** — always calls `onEditTrip` (`Home.jsx:451-467`).
- **🗑️ Delete** — after a `confirm()` dialog, deletes client-side in dependency order: `activities` (by day IDs) → `days` → `trip_members` → `trips` (`Home.jsx:54-72`). No soft delete; not undoable.

**Entry points to trip creation** — both call `onCreateTrip`:

- "+ New Trip" header button, shown only when at least one trip exists (`Home.jsx:192-212`).
- "Create a Trip" button inside the empty-state card (`Home.jsx:255-270`).

`onCreateTrip` (defined in `main.jsx:285-290`) clears `activeTrip`, sets `screen = "create"`, `initialStep = 0`, and pushes `/new/0`.

---

## 2. Routing: `/new/:step` → App's setup screen

`parseUrl()` in `main.jsx:104-109` matches `/new` or `/new/:digit` and returns `{ page: "create", step }`. Three places react to it:

- On session load, the initial-URL effect sets `screen = "create"` and `initialStep` from the URL (`main.jsx:188-191`) — so a hard reload of `/new/2` restores the wizard at step 2.
- The `popstate` handler does the same on back/forward (`main.jsx:202-204`).
- `Root` then renders `<App initialScreen="setup" initialSetupStep={initialStep} …/>` (`main.jsx:305-317`). Both `screen === "create"` and `screen === "edit"` map to `initialScreen="setup"`.

Inside `App.jsx`:

- `screen` starts as `initialScreen`, **except** when the opened trip is a draft (`initialTrip && !initialTrip.ig_response`), in which case it jumps straight to `"brainstorm"` (routes), not the setup form (`App.jsx:6413-6415`). So clicking a _Planning_ trip from Home skips the wizard and resumes at route selection.
- For drafts/edits, `editingTrip` is seeded from `initialTrip` (`App.jsx:7180-7184`) and `pendingForm` is reconstructed from the trip row + its `ig_request` JSON (`App.jsx:7185-7203`) — destinations split on `" → "`, dates, travelers, styles, notes, arrival/departure fields.
- The setup screen instantiates `SetupForm` once as `sharedSetupForm` (`App.jsx:9520-9540`) and renders it in either a desktop two-column layout (gradient hero panel with step labels `["Destination", "Dates", "Preferences"]` and a dates/travelers summary pill — `App.jsx:9517-9518, 9542+`) or the mobile single-column shell.
- `onStepChange` mirrors the wizard step into App state and — **only for new trips** (`!editingTrip`) — pushes `/new/${step}` (`App.jsx:9530-9533`).
- From the routes screen, the "✏️ Edit details" button returns to the wizard at step 0 (`App.jsx:10330-10337`, button at `App.jsx:2403-2419`).

---

## 3. The wizard (`src/components/SetupForm.jsx`)

Form state (`SetupForm.jsx:336-349`): `destinations[]`, `destinationCountryCodes[]`, `startDate`, `endDate`, `travelers` (string, default `"2"`), `styles[]`, `notes`, `arrivalCity`, `departureCity`, `baseLocation` — merged with `prefill` (from `initialTrip`) and `prefillForm` (from App's `pendingForm`).

> **Note:** there is **no flight/hotel input step** in this wizard. `arrivalCity`/`departureCity`/`arrivalTime`/`departureTime` exist in form state only as prefill carriers from existing trips (`SetupForm.jsx:310-335`); nothing in the three steps edits them. Similarly `styles` has no UI in the wizard — it survives only via prefill from `ig_request`. Flights and hotels are managed later on the Board's Travel & Hotels tab.

On mount the form pre-warms the `places-proxy` edge function with a throwaway autocomplete request (`q: "lo"`) so the first real keystroke doesn't hit a Deno cold start (`SetupForm.jsx:302-309`).

### Step 0 — Destination(s)

The user adds one or more destinations, shown as removable chips joined by `→` (`SetupForm.jsx:800-845`).

**Autocomplete pipeline** (`handleDestChange`, `SetupForm.jsx:395-456`):

1. Requires ≥ 2 characters ("the autocomplete API charges per call").
2. Checks a per-mount in-memory `Map` cache keyed on the lowercased query (`SetupForm.jsx:408-416`).
3. Otherwise debounces 400 ms, then POSTs `{ q }` to `` `${PLACES_PROXY}?action=autocomplete` `` with an `AbortController` and a 6 s client timeout (`SetupForm.jsx:423-455`). Top 8 suggestions are shown; results are cached.

`PLACES_PROXY` is the `places-proxy` Supabase edge function; `PLACES_HEADERS` is a Bearer anon-key + JSON content type (`theme.js:69-74`).

**Server side** (`supabase/functions/places-proxy/index.ts`): `handleAutocomplete` (`index.ts:392-413`) first checks the `place_cache` Postgres table (key `autocomplete:<q>:<types>`, 7-day TTL) — a cache hit is a single ~5 ms read. On miss it calls the **Google Places API v1** `places:autocomplete` endpoint (`index.ts:145-158`) and caches the result. Usage is counted in `api_usage` (`cache-hit` vs `google`).

> **Accuracy note:** destination autocomplete is **Google Places**, not Photon. Photon/Nominatim are used by _other_ actions of the same `places-proxy` function (`geocode`, `resolve-coords`, `lookup-place` — dispatch at `index.ts:1498-1508`), which come into play during itinerary geocoding, not here.

**Suggestion rendering/selection** — suggestions are Google `placePrediction` objects; the UI shows `structuredFormat.mainText` with `secondaryText` beneath, and picking one stores only `mainText` (e.g. "Ahmedabad", not "Ahmedabad, Gujarat, India") (`SetupForm.jsx:495-504`). Pressing Enter adds the raw typed text as a destination without validation (`SetupForm.jsx:900-903`).

**Mobile vs desktop** — on mobile, tapping the input opens a full-page fixed search sheet (escapes the `overflow:hidden` parent; `SetupForm.jsx:520-759`); desktop uses an inline dropdown (`SetupForm.jsx:892-1017`).

**Shortcuts** (shown only while no destination is picked):

- Eight popular-destination pills whose stored names are fully qualified ("Santorini, Greece", "Patagonia, Argentina") to avoid geocoding ambiguity (`SetupForm.jsx:481-493, 1022-1050`).
- **"🌐 Help me decide"** — adds the literal pseudo-destination `"Help me decide"` and auto-advances to step 1 (`SetupForm.jsx:1051-1075`). This later makes the base-location field mandatory (see step 2) and tells RG to propose destinations.

### Step 1 — Dates & travelers

- **Travelers** stepper, clamped 1–12, stored as a string (`SetupForm.jsx:1135-1191`).
- **`DateRangePicker`** (`SetupForm.jsx:12-255`): 12 months rendered from the current month in one scrollable column; on mount it scrolls the month containing `startDate` (or today) into view (`SetupForm.jsx:77-86`). Click semantics (`handleDay`, `SetupForm.jsx:56-69`): first tap sets start; a later tap sets end; tapping the start again clears; tapping an earlier date restarts the range. Past dates are unclickable. A confirmation pill shows "Mar 3 → Mar 10 · 8 days" once both ends are set.

### Step 2 — Preferences

- **"Where are you based?"** uses `CityInput` (imported from `BoardView.jsx:2211-2365`, exported at `BoardView.jsx:3248`) — a leaner sibling of the step-0 autocomplete: triggers from 1 character, 200 ms debounce, module-level cache (`_cityAutocompleteCache`), same `places-proxy?action=autocomplete` call, top 6 results. It supports `airportOnly`/`hotelCity` type filters elsewhere on the Board, but here it's a plain city search. Optional — **unless** a destination contains "help me decide", in which case it's marked `*` required.
- **"What kind of trip do you want?"** — a free-text `textarea` bound to `form.notes` (`SetupForm.jsx:1283-1302`), e.g. "travelling with two kids under 10, no long drives…".
- **"Start Planning ✨"** — `handleGenerate` (`SetupForm.jsx:506-518`) validates the help-me-decide/base-location rule, sets the local `generating` flag (button becomes disabled "✨ Generating your itinerary…"), and calls `onGenerate(form)` → App's `handleSetupComplete`.

### Validation & step navigation

`handleContinue` (`SetupForm.jsx:1332-1364`) gates the Continue button:

- **Step 0:** any un-committed input text is auto-added as a destination; at least one destination required, else error "Please add at least one destination."
- **Step 1:** both dates required and `endDate >= startDate`.

Errors render as a centered red line via `destError` (`SetupForm.jsx:1468-1481`). Note the DB columns are `NOT NULL` for dates, so a missing-dates draft insert would fail — the step-1 gate prevents that.

### Browser-history sync for steps

Two coordinated layers keep the back button working inside the wizard:

1. **Component level** (`SetupForm.jsx:287-300`): on mount, `history.replaceState({ step: 0 })`, then — when resuming at `initialStep > 0` (returning from routes) — one `pushState({ step: s })` per prior step so back walks through earlier sections. `handleContinue` pushes `{ step: next }` on each advance (`SetupForm.jsx:1359-1362`), and a `popstate` listener restores `e.state?.step ?? 0`.
2. **App/URL level**: `onStepChange` pushes the visible path `/new/:step` for new trips (`App.jsx:9530-9533`), and `main.jsx`'s route parsing restores the step on reload/back (`main.jsx:104-109, 202-204`).

The mobile ← arrow in the progress-dots row calls `setStep(s - 1)` directly rather than `history.back()` (`SetupForm.jsx:1406-1426`).

### Prefill / edit mode

- `initialTrip` (an existing trip row) is mapped to form fields in `SetupForm.jsx:310-335`: `destination` split on `" → "`, dates, `HH:MM` sliced out of timestamps, plus `ig_request` overrides for travelers/styles/times/modes.
- `prefillForm` (App's live `pendingForm`) is merged into initial state (`SetupForm.jsx:348`) and re-applied once via a ref guard if it arrives late, also restoring `initialStep` (`SetupForm.jsx:352-358`). This is the path used when the user hits "Edit details" on the routes screen.
- In edit mode, `handleSetupComplete` (`App.jsx:7709-7815`) diffs the new form against the previous `pendingForm`: destinations, duration, dates-shifted, notes, arrival/departure city, base city. Travelers-only changes are silent. Zero changes → return to routes silently (`App.jsx:7799-7804`). Otherwise a confirmation sheet opens (`setShowEditConfirm`, `App.jsx:7814`) flagging _structural_ changes (destinations/duration/arrival/departure/base) that invalidate the current routes.

---

## 4. Trip record creation (`doSetupComplete`, `App.jsx:7555-7707`)

For a brand-new trip, `handleSetupComplete` goes straight to `doSetupComplete(form, /*regenerate=*/true)` (`App.jsx:7709-7713`). Sequence:

1. PostHog `setup_complete` event with destinations/styles/travelers (`App.jsx:7556-7560`).
2. `setPendingForm(form)` and **immediately** switch `screen` to `"brainstorm"` (`App.jsx:7561-7564`) — the UI moves on before the DB write finishes; the insert below is effectively fire-and-forget from the user's perspective.
3. **Draft insert** (`App.jsx:7611-7666`):
   - `const draftId = crypto.randomUUID()` (`App.jsx:7612`) — the trip ID is generated **client-side**. Per `CLAUDE.md` this avoids RLS issues: the client already knows the ID, so it can insert the `trips` row and the `trip_members` row back-to-back without needing an insert-returning-select on `trips` (whose read policies depend on membership that doesn't exist yet at insert time).
   - Draft `name` = shortened destinations + date range, e.g. `"Osaka → Kyoto (Japan) · Mar 3–Mar 10"` (`shortenDests`, `App.jsx:7539-7553`; name assembly `App.jsx:7613-7622`).
   - `ig_request` JSON snapshot of the form: destinations, computed `numDays`, travelers, styles, notes, dates, arrival/departure city/time/mode (`App.jsx:7623-7645`).
   - Columns written to `trips` (`App.jsx:7646-7666`): `id`, `name`, `destination` (the `" → "`-joined shortened string), `start_date`, `end_date`, `created_by`, `ig_request`, `base_location`, and conditionally `notes`, `arrival_city`, `departure_city`, `arrival_time`/`departure_time` (composed as `${date}T${HH:MM}:00`), `arrival_mode`, `departure_mode`. Everything else (`ig_response`, `summary`, timings, digests…) stays null until IG.
4. On insert success: `trip_members` gets `{ trip_id, user_id, role: "edit" }` (`App.jsx:7668-7670`), `editingTrip` is set so the session is now "editing a draft", and the URL becomes `/trip/:id/plans` (`App.jsx:7671-7679`). If the insert errors, none of that happens — the code has no explicit error UI here; the user continues into RG with an unsaved trip (unclear whether this is intentional; there is no retry).

**`trips` table shape** — base table in `schema.sql:3242-3273` (`id uuid DEFAULT gen_random_uuid()`, `name`, `destination`, `start_date`, `end_date` all NOT NULL; `created_by`, flight/hotel legacy columns, `ig_request`/`ig_response` jsonb, `share_token`, timestamps). Note `schema.sql` is a dump that lags the migrations; later additions include `budget_amount`/`budget_currency` (`20260428000003`), `compact_ready_at`/`detailed_ready_at` (`20260427000002`), `ig_count` (`20260423000001`), `base_location` + `arrival_airport_iata`/`departure_airport_iata` (`20260511000001`), `inspirations_digest` (`20260530000001`), `magazine_digest` (`20260601000001`).

---

## 5. Handoff to Route Generation

Because `regenerate` is true, `doSetupComplete` finishes with:

```js
setTimeout(() => {
  triggerRgRef.current?.();
}, 0); // App.jsx:7702-7706
```

`triggerRgRef` is an imperative handle wired into `BrainstormView` (`App.jsx:7216`, passed at `App.jsx:10323`), which is already on screen (step 2 above switched to `"brainstorm"`) with `pendingForm` as its input. That kicks off the `generate-brainstorm` edge function and the 4-route selection flow — see [03-route-generation.md](03-route-generation.md).

For edits with structural changes, the same path additionally clears stale state first: `inspirations_digest`/`magazine_digest` nulled in DB, routes and days deleted, `ig_response` nulled (`App.jsx:7566-7609`).

---

## Key files

- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/Home.jsx` — trip list, offline cache, delete, create/edit entry points
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/main.jsx` — `parseUrl()` (`/new/:step`), Root screen state, popstate handling
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/components/SetupForm.jsx` — 3-step wizard, `DateRangePicker`, destination autocomplete, history sync, validation
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/components/BoardView.jsx` — `CityInput` (base-location autocomplete), exported at line 3248
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/App.jsx` — setup screen host, `handleSetupComplete`/`doSetupComplete`, draft trip insert, RG trigger
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/theme.js` — `PLACES_PROXY`, `PLACES_HEADERS`
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/supabase/functions/places-proxy/index.ts` — autocomplete handler (Google Places + `place_cache`)
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/schema.sql` + `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/supabase/migrations/` — `trips` table shape
