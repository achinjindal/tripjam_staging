# 05 — Living with the Itinerary: Viewing, Editing, Maps, Photos

Once IG completes, the itinerary tab in `src/App.jsx` renders each day as a compact card that expands into a full timeline of activity cards, transitions, transit tips, and photos. Distances/times between activities are computed client-side from haversine geometry — never by the LLM, which only supplies a transit _mode_. Geocoding flows through the `places-proxy` edge function (Photon + Nominatim with city-bias validation) plus a hardened `verify-place` ladder, and photos come from a 4-tier Wikipedia/Wikimedia lookup with person-page filtering and a rate-limited queue. Manual activity edits apply optimistically and persist to the `activities` table (see "Editing activities").

---

## Viewing: day cards and expansion

Two view modes, both driven from App state (`src/App.jsx:6613-6614`):

- **Compact view** (`compactView`, default `true`): every day renders as `DayCompact` (`src/App.jsx:5479`) — day label, city, one-line transit/hotel links, and meaningful activities grouped into `→`-joined lines (food vs. everything else, `src/App.jsx:5487-5503`). Each item is a Google Maps search link (`src/App.jsx:5505-5506`). Expansion is gated on `canExpand={detailedReady || i < streamingDays}` (`src/App.jsx:11715`) — while the detailed IG phase is still streaming, un-streamed days show a spinner instead of the ▼ chevron (`src/App.jsx:5552-5568`).
- **Detailed view**: tapping a compact card sets `compactView = false` and collapses all _other_ days into `collapsedDays` (`src/App.jsx:11723-11738`), so exactly one `DaySection` (`src/App.jsx:5662`) is open. Expanding also pre-loads the current day and Day N+1 (`src/App.jsx:11740-11742`, see "Pre-loading"), then smooth-scrolls to the day header. A ▲ control re-collapses (`src/App.jsx:5779-5791`, `11769-11773`).

`DaySection` renders:

- **Sticky day header** — day label pill, city (with carried-forward hotel city as `"City (HotelCity)"` when they differ, `src/App.jsx:11716-11722`), date + activity count, and a "Route" link chaining all activities into one Google Maps directions URL (`src/App.jsx:5697-5703`).
- **Day write-up** — `day.description` (generated per-day by IG, persisted to `days.description` at `src/App.jsx:8433`) is hidden behind a 📖 toggle button in the header (`src/App.jsx:5792-5810`); tapping reveals the italic narrative block (`src/App.jsx:5834-5856`). This is distinct from per-city `writeup`s, which belong to the Magazine.
- **City-pill strip** — in detailed view only, a sticky strip of city pills with day ranges for multi-city trips (`src/App.jsx:11557-11650`); hidden when all days share one hotel city.

### Activity rows

`ActivityCard` (`src/App.jsx:4020`) renders each activity: a circular icon badge colored by `typeStyle` (`src/App.jsx:883-889` — `sight`/`food`/`shop`/`transit`/`hotel`, each with bg + color + label) containing the LLM-chosen emoji `activity.icon`, then time, a type/package pill, serif title, optional 💬 note, ⏱ duration, a Google Maps link, an "Ask Trippy" chat shortcut, and a ⋯ menu (Suggest alternatives / Replace via chat prefill, or hotel-specific options; `src/App.jsx:4715-4805`, `11776-11791`). A confirmed activity gets a green right border (`src/App.jsx:4545-4547`). `PhotoStrip` renders under the card (`src/App.jsx:4854`, see "Photos").

---

## Editing activities

Tapping edit on `ActivityCard` flips it into an inline form (`src/App.jsx:4316-4502`) with fields: **time**, **title**, **type** (select over `typeStyle`), **duration**, **note**, and **map pin** (`geocode`; for transit activities a second **arrival** field edits `geocode_end`, `src/App.jsx:4406-4463`).

Persistence: `saveEdit` calls `onEdit(draft)` → `editActivity` (`src/App.jsx:7219`), which updates React state optimistically and then persists the editable fields (`time`, `title`, `type`, `duration`, `note`, `geocode`, `geocode_end`) to the `activities` table (fire-and-forget update; `tmp-*` in-flight IDs from streaming are skipped since those rows don't exist yet). Before 2026-07-13 this path was local-state only and edits were lost on a fresh fetch. Other paths that persist to `activities`:

- Remove: `removeActivity` deletes the row and posts an undo chip; undo re-inserts (`src/App.jsx:7343-7409`).
- Hotel selection: `selectHotel` runs the verify-place ladder then inserts a hotel activity with coords + metadata (`src/App.jsx:7234-7341`).
- Chat `update_day` actions: delete + re-insert the whole day's activities (`src/App.jsx:8914-8945`).
- Background writes: `photo_url` (`src/App.jsx:166-171`, `8561`), `transition_mins`/`transition_mode` (`src/App.jsx:5976-5997`), and verify-place results (`src/photos.js:588-595`).

---

## Transitions between activities

### TransitionRow (in-city)

`TransitionRow` (`src/App.jsx:3707`) renders the pill between consecutive activity cards, plus "from arrival", "from hotel", "to hotel", and "to departure" variants (`src/App.jsx:5870-5897`, `6001-6045`, `6063-6073`).

- **No LLM time estimates — confirmed.** The IG prompt's `transition` object carries only `{"mode":"metro"|"bus"|"ferry"|"tram"}` (`supabase/functions/generate-itinerary/index.ts:62-64`). Minutes are computed client-side: haversine distance × 1.3 road factor, walking at 80 m/min, driving at 400 m/min; walk wins when ≤ 20 min (`src/App.jsx:3772-3792`).
- Coordinates come from stored `lat`/`lng` on the activity when present, else `geocodePlace()` with up to 3 retries/backoff (`src/App.jsx:3736-3765`). Sanity caps reject likely-bad geocodes: 30 km for in-city pairs, 200 km when either end is a transit activity (`src/App.jsx:3777-3783`); stored values > 60 min for in-city pairs are also distrusted and recomputed (`src/App.jsx:3717-3726`).
- The pill (🚶 green walk / 🚗 blue drive) links to Google Maps directions using the _same_ coords the estimate used (avoids the pill-says-8-min/Maps-says-90-min mismatch, `src/App.jsx:3848-3861`, `3919-3923`).
- **Transit icon**: if the LLM supplied a `transition.mode`, an icon (🚇/🚌/⛴️/🚊, `src/App.jsx:3943-3948`) appears next to the pill linking to Google Maps in `travelmode=transit` — only for 500 m–20 km hops that aren't trivially walkable/drivable (`src/App.jsx:3949-3954`).
- Failure state is a "Get directions" link, not a fake number (`src/App.jsx:3863-3917`).
- Resolved minutes are persisted back to `activities.transition_mins`/`transition_mode` via the `onResolved` callback, skipping in-flight `tmp-*` IDs (`src/App.jsx:5976-5997`).

### Inter-city transit cards

A `type: "transit"` activity with a `service` field renders as a rich card instead of a normal row (`src/App.jsx:4074-4314`): service name + icon (ferry detection at `src/App.jsx:4075-4077`), `from_station → to_station` route line, ⏱ `transit_duration`, 💡 `booking_tip`, green `cost_estimate`, and a "Compare options on Rome2Rio →" link built from the stations (`src/App.jsx:4078-4081`). These fields are mandated for every transit activity by the IG prompt (`supabase/functions/generate-itinerary/index.ts:65-72`) and stored on the activity row.

### Transit tips (per day)

`day.transit_tip` (e.g. "Use Suica card · Ginza + Hanzomon Lines · Day pass ¥600") is generated per day by the IG prompt — actionable, one sentence, only for cities with real public transit (`supabase/functions/generate-itinerary/index.ts:74`) — saved to `days.transit_tip` (`src/App.jsx:8437`) and rendered as a purple 🚇 banner under the day header (`src/App.jsx:5814-5831`).

---

## Maps

`src/components/MapView.jsx` exports two Leaflet maps plus shared helpers:

- **`FitBounds`** (`MapView.jsx:63-80`) fits the map to the visible pins (single pin → `setView` zoom 14). **`MapCleanup`** (`MapView.jsx:39-47`) stops in-flight animations on unmount to avoid a Leaflet 1.9 crash.
- **`MapView` (itinerary)** (`MapView.jsx:82`): resolves pins for all days in parallel, coloring markers per day (`DAY_COLORS`, `MapView.jsx:10-21`), with day-filter pills and a multi-select toggle. Pin resolution ladder (`MapView.jsx:107-171`): (1) trust stored, properly-verified coords; (2) authenticated → `verifyActivity` (full verify-place ladder, persists coords); (3) unauthenticated (public share view) → legacy `geocodePlace`, deliberately without DB write-back. Skeleton renders _outside_ `MapContainer` so Leaflet never boots at `[20,0]` grey ocean (`MapView.jsx:332-396`). Tiles are Mapbox when `VITE_MAPBOX_TOKEN` is set, else OSM (`MapView.jsx:401-408`).
- **`RouteMapView` (brainstorm)** (`MapView.jsx:454`): plots each RG route's cities; pre-centers on the destination bbox fetched straight from Photon while RG runs (`MapView.jsx:468-492`).

### Geocoding pipeline

Client side (`src/photos.js:406-488`): `geocodePlace(title, city, geocodeHint)` short-circuits raw `"lat,lng"` hints, builds candidates from the LLM `geocode` hint and `extractPlace(title)` (strips "walk at X" / "tour" phrasing, `src/photos.js:385-397`), caches in-memory, and calls `places-proxy?action=geocode` with 2 attempts per candidate. **Destination-context enrichment**: the trip destination (set via `setTripDestination`, `src/photos.js:401-404`, called from `src/App.jsx:6478-6481`) is appended to the city — `"Kuta"` → `"Kuta, Bali"` — whenever the city string doesn't already contain it (`src/photos.js:439-449`), preventing wrong-continent matches.

Server side (`supabase/functions/places-proxy/index.ts:541-693`, `handleGeocode`): (1) DB cache; (2) resolve a city **bias point** from the main city (last comma segment) via Nominatim, falling back to Photon (`index.ts:552-606`); (3) Photon with up to 7 query variations (place+city, dehyphenated, suffix-stripped, etc.), rejecting results farther than 200 km from the bias (1500 km for country-level bias) (`index.ts:608-659`); (4) Nominatim fallback with the same distance check (`index.ts:661-679`); (5) misses cached for only 5 minutes so transient failures don't poison a trip for a day (`index.ts:681-692`). A `geocode_overrides` table is consulted for manual corrections (`index.ts:366-378`). The stricter `verify-place` action adds name-similarity checks, Haiku name repair, and Google Places escalation; the client wrapper `verifyActivity` (`src/photos.js:521-647`) persists `lat/lng`, `geocode_source`, `geocode_confidence`, `geocode_verified_at`, `place_id`, and corrected titles (`geocode_corrected_from`) onto the activity row, deduping concurrent calls per activity id.

`scripts/backfill-activity-geocodes.cjs` is a one-off batch script that fills missing `lat`/`lng` on existing activities via `places-proxy?action=geocode` (Photon/Nominatim only, no Google), 50 per batch with 200 ms stagger (`scripts/backfill-activity-geocodes.cjs:1-57`).

---

## Photos

`_fetchPhoto` in `src/photos.js:121-345` (behavior documented in the header comment at `src/photos.js:84-120`):

- **4-tier lookup** — Tier 1: Wikipedia exact-title lookup (with redirects) on the geocode; Tier 2: same with the city stripped and generic POI suffixes ("Temple", "Market"…) removed (`src/photos.js:236-269`); Tier 3: Wikipedia full-text search, top 5 results sorted by rank, **person pages filtered** via a description regex (`born|politician|actor|…`, `src/photos.js:299-306`) with a filename-relevance check for the relaxed top-2 (`src/photos.js:219-230`); Tier 4: Wikimedia Commons file search (`src/photos.js:322-341`). Hotels bypass all of this and hit `places-proxy?action=hotel-photo` instead (`src/photos.js:155-177`).
- **Filtering** — `_isPortrait` (`src/photos.js:21-26`) and `BAD_PATTERNS` (`src/photos.js:122-123`) reject portraits, maps, flags, logos, svgs, panoramas.
- **Queue** — all Wikipedia/Commons calls go through `wikiQueuedFetch = makeQueue(400, 2)`: **2 concurrent, 400 ms stagger** (`src/photos.js:82`), with a global cool-down honoring `Retry-After` on 429s (`src/photos.js:28-80`). (Note: CLAUDE.md's "3 concurrent / 300ms" is stale relative to the code.)
- **Caching + dedup** — `_photoCache` keyed by `geocode||city` with an in-flight sentinel to prevent racing duplicates; `_usedPhotoUrls` prevents the same photo appearing on two activities (hotels exempt, since the same hotel legitimately shows in suggestions and the itinerary) (`src/photos.js:8-10`, `130-138`, `152-154`).
- **Lazy loading** — `PhotoStrip` (`src/App.jsx:114`) only fetches when the card scrolls within 200 px of the viewport via `IntersectionObserver` (`src/App.jsx:126-141`); until then a shimmer skeleton shows. Found URLs are written back to `activities.photo_url` (`src/App.jsx:163-171`) so subsequent loads skip the lookup. It searches by `extractPlace(title)` rather than the geocode, which may be a raw street address (`src/App.jsx:118`).

---

## Pre-loading strategy

`preloadDay(dayIndex)` (`src/App.jsx:6625-6683`) warms geocode + photo caches for a day and lazily runs `verifyActivity` for unverified activities (persisting coords, then patching state). Idempotent via `preloadedDaysRef`. It fires from three places:

1. Opening an existing trip pre-loads Day 1 (`src/App.jsx:6590`).
2. As detailed-IG days stream in, every streamed day is pre-loaded in parallel (`src/App.jsx:6690-6696`).
3. **Expanding Day N pre-loads Day N and Day N+1** (`src/App.jsx:11740-11742`), so the next day's transitions and photos are warm before the user gets there.

---

## Edit Details flow (change detection + confirmation sheet)

`handleSetupComplete` (`src/App.jsx:7709-7815`) runs when the setup wizard is submitted for an existing trip with routes:

- Diffs the new form against `pendingForm`: destinations, duration (day count), date shift, notes, arrival/departure/base city (`src/App.jsx:7715-7792`). A travelers-only change is deliberately silent (`src/App.jsx:7794-7796`); no material change returns to the routes tab with no dialog (`src/App.jsx:7799-7804`).
- Changes are classified: **structural** = destinations, duration, arrival, departure, or base city changed (`src/App.jsx:7807-7812`); dates-shifted/notes are soft.
- `setShowEditConfirm({ changes, isStructural, form })` opens a bottom sheet (`src/App.jsx:13011-13240`) showing a red-strikethrough → green diff of every change. Structural: "These changes need new routes"; soft: "Details updated … Generate new routes to apply, or discard". Either way the sheet offers exactly two actions — **Generate New Routes** (`doSetupComplete(form, true)`) or **Discard Changes** — with a caption counting how many routes (and the itinerary, if one exists) will be replaced (`src/App.jsx:13199-13210`).
- Regeneration path (`doSetupComplete` with `regenerate: true`, `src/App.jsx:7555-7609`): clears Magazine/Inspirations digests, resets routes and days state, nulls `trips.ig_response`, deletes all `days` + `activities` rows for the trip, then triggers RG. (Separately, re-building over an existing itinerary from the routes screen goes through the "Replace itinerary" confirmation with its own parameter diff, `src/App.jsx:13242+`.)

---

## Key files

- `src/App.jsx` — DayCompact `:5479`, DaySection `:5662`, ActivityCard `:4020`, TransitionRow `:3707`, PhotoStrip `:114`, typeStyle `:883`, editActivity `:7219`, preloadDay `:6625`, edit-details detection `:7709` + sheet `:13011`, IG persistence `:8416-8476`
- `src/photos.js` — `_fetchPhoto` 4-tier lookup, `makeQueue`/`wikiQueuedFetch`, `geocodePlace` + destination enrichment `:439`, `verifyActivity`/`needsVerification`
- `src/components/MapView.jsx` — `MapView`, `RouteMapView`, `FitBounds`, `DAY_COLORS`
- `supabase/functions/places-proxy/index.ts` — `handleGeocode` `:541`, verify-place ladder, `geocode_overrides`
- `supabase/functions/generate-itinerary/index.ts` — transition/transit-tip/inter-city prompt rules `:62-74`
- `scripts/backfill-activity-geocodes.cjs` — lat/lng backfill via places-proxy
