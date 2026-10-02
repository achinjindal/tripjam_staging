# Email Ingestion P3 — Flights, Trains (Global), Add-a-Booking Flow

**Design mockup:** `email-p3-design.html` (open in browser)
**Status:** plan — not implemented
**Depends on:** P0/P1 shipped 2026-09-24 (hardened inbound-email, receipts, teaching cards)

## Goal

Close the loop the P0 receipt already promises ("Flight bookings land in
Travel & Hotels soon"): **flight and train confirmations** — from any
carrier or rail operator worldwide — become visible, booked **travel legs**
on the trip. And give users one obvious front door for getting a booking in:
an **"Add a booking"** flow with two options — _forward the email_ or
_upload a screenshot/PDF_. (Paste-text was considered and dropped: too
niche; the two options above cover the real sources.)

Audience note: global English-speaking users. Trains means Amtrak, Eurostar,
DB/ICE, SNCF/TGV, Trenitalia/Frecciarossa, JR/Shinkansen, IRCTC, Via Rail —
the parser is operator-agnostic, with vendor quirks handled as hints, not
special cases.

## Current state (facts)

- **No leg structure exists.** Travel is exactly one arrival + one departure,
  flat scalar columns on `trips` (`arrival_city/_time/_mode/_airport_iata`,
  `departure_*`, migrations `20260326000002`, `20260327000001`,
  `20260511000001`). LogisticsTab edits 6 flat fields
  (`BoardView.jsx:2624-2635`); `saveLogisticsFlights` writes 9 columns
  (`App.jsx:9323-9379`). Arrival is date-pinned to `trip.start_date`,
  departure to `trip.end_date`.
- **inbound-email has no flight apply branch** — flights today only route
  (`flight_date`), log to the feed, and send a receipt that promises the
  feature. Parser flight object has **no time fields**.
- **dry_run** is live, JWT-authed, metered 30/user/day, returns
  `{parsed, routedBy, trip, candidates}` and writes nothing. No frontend
  caller exists yet.

## Data model — one new column

```sql
-- 20261001000001_add_travel_data_to_trips.sql
ALTER TABLE trips ADD COLUMN IF NOT EXISTS travel_data jsonb;
```

`travel_data` = array of **leg** objects (booked transport, any count):

```jsonc
{
  "id": "uuid",
  "kind": "flight" | "train",
  "carrier": "British Airways",   // airline, or rail operator ("Trenitalia")
  "number": "BA 548",             // flight no; train no/name ("Frecciarossa 9528")
  "date": "2027-05-04",
  "depart_time": "08:40",         // "" when unknown
  "arrive_time": "12:10",
  "from": "LHR",                  // IATA / station name verbatim from ticket
  "to": "FCO",
  "confirmation": "MX4KQZ",       // airline PNR / rail booking ref / IRCTC PNR
  "class": "Business",            // verbatim ("3A", "Standard Premier", "")
  "status": "booked",             // "booked" | "cancelled"
  "via": "email" | "upload",      // provenance
  "created_at": "iso"
}
```

Why jsonb list, not more scalar columns: trips have N legs; the single
arrival/departure scalars stay as the _itinerary timeline's_ interface and
get **opportunistically auto-filled** from matching legs (below). Mirrors
the `hotels_data` pattern — same save/merge/RLS story, zero new
infrastructure.

## Part A — Parser + edge function (inbound-email)

### A1. Parser schema v2 (`index.ts` prompt)

```jsonc
{"kind":"hotel"|"flight"|"train"|"other","status":"confirmed"|"cancelled",
 "hotel":{...unchanged...},
 "flight":{"carrier":"","number":"","date":"","depart_time":"HH:MM or empty",
           "arrive_time":"","from":"","to":"","confirmation":""},
 "train":{"operator":"","number":"","name":"","date":"","depart_time":"",
          "arrive_time":"","from":"","to":"","class":"","confirmation":""},
 "summary":"..."}
```

Prompt additions:

- `kind:"train"` for ANY rail confirmation worldwide. Keep operator, train
  number/name, stations, and class **verbatim from the ticket** — do not
  translate, expand or normalize (station codes like NDLS or FCO stay as
  written; classes like "3A", "Standard Premier", "Green Car" stay as
  written).
- **Origin/destination must be human-readable.** Flight `from`/`to` are
  `"City (CODE)"` when the email names the city (almost all confirmations
  do — "London Heathrow (LHR)"), bare code only as last resort. Train
  `from`/`to` are the full station names as printed ("Roma Termini",
  "MUMBAI CENTRAL (BCT)"). Prompt rule: never emit a bare IATA code when
  the city name is present in the email.
- Vendor hints (examples, not an allowlist): Eurostar/Amtrak refs are
  6-char alphanumeric; IRCTC PNR is 10 digits and trains are
  "NUMBER NAME"; DB/SNCF/Trenitalia use coach+seat with 6-8 char refs.
- Times: 24h HH:MM; empty when absent. Never invent.
- `status:"cancelled"` examples extended with rail wording ("ticket
  cancelled", "TDR filed", "refund initiated", "Erstattung").
- max_tokens 400 → 500.

### A2. Routing

`flight_date` branch generalizes to `leg_date`: match on
`parsed.flight?.date || parsed.train?.date`. Everything else (plus-address
first, fallback last, plus_miss stops) unchanged.

### A3. Apply branch for flight/train

After the hotel branches, add:

- Build the leg from parsed fields (`kind`, `confirmation` from either
  object's confirmation field).
- **Any count, any date.** A trip can carry 3–4+ legs (outbound flight,
  two internal trains, a mid-trip hop, return flight). Every parsed leg is
  ingested and stored regardless of where its date falls — start, middle,
  or end of the trip. Mid-trip legs are first-class: they surface on their
  itinerary day (Part B2), not just in the Travel card. A leg whose date
  is outside the trip range entirely still stores (flagged in the feed
  summary as "outside trip dates") — dates on tickets are ground truth;
  the trip's dates might be the thing that's wrong.
- **Dedupe/update key**: same `confirmation`, else same
  `(kind, number, date)`. Existing match → merge (update times/status →
  `leg_updated`); no match → append (`leg_booked`).
- **Cancellation** (`status:"cancelled"`): find by key → set
  `status:"cancelled"` (keep the row); no match → `cancellation_noted`.
- **Boundary auto-fill** (bonus for first/last day only — NOT the primary
  surfacing): booked leg whose `date === trip.start_date` → fill arrival
  editor (time from `arrive_time`, mode flight/train, IATA from `to` when
  3 uppercase letters, city only if empty); symmetric for `end_date` →
  departure from `depart_time`/`from`. Only fill times that were genuinely
  parsed; never overwrite user-typed values. Mid-trip legs skip this and
  rely on Part B2.
- `applied` values: `leg_booked | leg_updated | leg_cancelled |
cancellation_noted | leg_update_failed`.

### A4. Receipts (replace the promise with the outcome)

- flight: "✈️ British Airways BA 548 is on your trip" — route + date +
  ref + "It's in Travel & Hotels{, and your arrival day now shows it}."
- train: "🚆 Frecciarossa 9528 is on your trip" (same pattern, class + ref).
- `leg_cancelled`: "Cancellation noted — {number}".
- All values `esc()`d.
- **Copy-honesty fix rides along**: teaching card + `send-email` P.S.
  footer change "hotel confirmations" → "hotel, flight or train
  confirmations" in the same release that makes it true.

### A5. Upload parsing (extends dry_run)

`dry_run` gains an optional `file` input alongside `subject`/`body`:

```jsonc
{
  "dry_run": true,
  "to": "bookings+abcd1234@…",
  "file": {
    "media_type": "image/jpeg|image/png|image/webp|application/pdf",
    "data": "<base64>",
  },
}
```

- Haiku 4.5 reads both: image content block for screenshots, document
  block for PDFs. Same parse prompt, same JSON contract.
- Limits: base64 ≤ 4 MB (client downscales screenshots to ≤1600px via
  canvas before upload); PDFs ≤ 8 pages. Reject oversize with a clear 413.
- Same 30/user/day meter (uploads and text runs share it); `llm_usage`
  rows tagged `inbound-email:dry` as today.
- Response gains `leg_preview` — the normalized leg the apply branch
  _would_ write — so the sheet renders exactly what will be saved. (Also
  returned for text dry-runs; used by the E2E suite.)

## Part B — Travel card UI (BoardView LogisticsTab)

**"Booked legs"** block inside the 🧭 Travel card, between the Arriving and
Departing editors (see mockup):

- One row per leg, booked first. **The route is the headline**: line 1
  (serif, prominent) = `London LHR → Rome FCO` (city names with small-caps
  codes; full station names for trains) with an ocean-colored arrow;
  line 2 (mist, small) = carrier + number · date · dep time · ref chip ·
  provenance badge (📩 email / 📎 upload). Rendering splits the stored
  `"City (CODE)"` strings for the code styling; falls back to the raw
  string unstyled.
- Cancelled legs struck-through under a "show cancelled (N)" toggle.
- Row `⋯` menu: Copy ref · Remove (confirm sheet).
- A leg that auto-filled a boundary shows "↳ set your arrival" caption.
- Save path: server writes legs (email) or the sheet writes them (upload);
  the card itself only deletes — new `saveTravelLegs(next)` in App.jsx
  mirroring `saveLogisticsHotels`, plus the resync-on-external-change
  effect pattern from P0 (keyed on `trip.travel_data`).

### B2 — Mid-trip legs on the itinerary day cards

A booked leg must show up **on the day it happens**, not just in the Board.
Matching is by date: `leg.date === day.date` (days carry a `date` column).

Two render modes, checked in order per (day, leg):

1. **Badge an existing transit activity** when the day has a
   `type:"transit"` activity whose title/stations loosely match the leg
   (case-insensitive substring of either city/station in the activity
   title or its `from_station`/`to_station` when present in memory) →
   that activity card gets a **"✓ Booked · {ref}"** badge (same visual as
   the hotel ✓ Booked badge from the booked-state slice) and its `⋯` can
   copy the ref. No duplicate row is added — the itinerary already
   describes this movement; we're confirming it.
2. **Standalone leg strip** otherwise: a compact pinned row at the top of
   the day card (above the first activity, below the day header) — same
   route-first layout as the Travel card rows: line 1 `{from} → {to}`
   (prominent), line 2 `{carrier} {number} · dep {time} · ✓ Booked`. Not an `activities` insert:
   it's derived at render time from `trip.travel_data`, so it can never
   drift from the source of truth, survives day regenerates untouched,
   and needs zero migration on `activities`.

Multiple legs on one day (e.g. two connecting flights) stack in
departure-time order. Cancelled legs never render on day cards (Travel
card's cancelled toggle is their only surface). The IG prompt is NOT
changed — legs are user bookings overlaid on the plan, not plan content.

Receipt copy for a matched mid-trip leg: "…saved to {trip}'s Travel &
Hotels — you'll see it on Day {N}."

## Part C — "Add a booking" flow

One obvious front door. The user should never wonder what to do here.

**Entry points**

1. Travel card header button: **"＋ Add a booking"**.
2. The P1 teaching card's body becomes a tap-target for the same sheet
   (its copy already teaches forwarding; the sheet is the actionable
   version).
3. Hotels card `⋯`-adjacent link (same sheet, hotel results land in
   `hotels_data`).

**Sheet — state 1, the chooser** (mocked): title "Add a booking", one line
of promise ("Hotel, flight or train — we'll read it and file it on this
trip"), then two big option cards:

- **📩 Forward the confirmation email** — shows this trip's address
  (`bookings+abcd1234@…`) with a copy chip, caption "Works from Gmail,
  Outlook, anything. We reply once it's filed." Selecting copies the
  address; the sheet stays open with a "waiting" hint that dismisses
  freely (the receipt closes the loop asynchronously).
- **📎 Upload a screenshot or PDF** — caption "Ticket PDFs, app
  screenshots, boarding passes." Opens the file picker
  (`accept="image/*,.pdf"`).

**State 2 — parsed preview** (upload path): kind icon, name/number, route,
date + times, ref — plus the routed trip chip. "Not right? Edit fields"
flips values to inputs. CTA **"Add to trip"**.

**State 3 — apply, client-side (no new endpoint):** hotel → merge into
`hotels_data` (`via:'upload'`); flight/train → append to `travel_data` via
`saveTravelLegs` + run the shared boundary auto-fill helper client-side;
`logActivity("booking_uploaded")`. Done state: "✓ On the trip" with the
row visible behind the sheet.

Metering: dry_run's 30/day cap covers parse abuse; applies are RLS writes.

**Explicitly not building** (stays backlog): paste-text input (niche —
covered by screenshot upload); wrong-trip move UI (the sheet targets the
open trip via plus-address, removing the ambiguity).

## Part D — Flight affiliate redirects (rides along, env-gated)

Mirror of the shipped-dark hotel Level 1 (`VITE_BOOKING_AID` pattern):

- When arrival or departure has no booked leg and no user-entered time, the
  Travel card shows a quiet **"Compare flights ↗"** text link
  (pre-filled origin/destination/date deep link).
- Link template from env: `VITE_FLIGHT_LINK_PREFIX` (empty → link hidden,
  ships dark). Recommended program: **Travelpayouts** — one dashboard
  covers Aviasales/WayAway flight deep links (~1.1–1.3% of ticket),
  Kiwi.com (~3%), plus rail/ground (Omio, 12Go) for later; Skyscanner's
  program pays ~20% _of Skyscanner's referral revenue_ (effectively cents
  per redirect, CPC-like). Expectations: flights are the lowest-margin
  travel affiliate category — this is a "free money on an existing
  surface" play, not a revenue line.
- No affiliate link on booked legs (never upsell what's already bought).

## Sequencing / rollout

1. Migration `travel_data` → both envs (additive).
2. inbound-email: parser v2 (global trains) + leg apply + receipts +
   `leg_preview` + `file` upload input. Deploy both envs
   (`--no-verify-jwt`). Extend the dry-run suite: BA flight, Eurostar,
   Frecciarossa, Amtrak, IRCTC booking + IRCTC cancellation, flight
   reschedule (same ref, new time → `leg_updated`), screenshot fixture,
   PDF fixture.
3. Frontend: legs block + Add-a-booking sheet + copy-honesty edits +
   `send-email` footer wording (redeploy send-email) + affiliate link
   (dark until `VITE_FLIGHT_LINK_PREFIX` set).
4. E2E: upload flow with a fixture image → leg row renders → remove works;
   boundary auto-fill asserted on a flight matching `start_date`; mid-trip
   train leg → strip renders on the matching day card (and NOT on other
   days); day with a matching transit activity → badge mode, no duplicate
   strip; two same-day legs stack in time order.
5. Live loop test (temp identity): forwarded flight + rail fixtures.
6. Independent engineering review before ship (same bar as P0/P1).
   Reviewer focus: upload size/content validation, base64 memory in the
   edge function, boundary auto-fill overwrite rules, leg dedupe
   collisions, esc() coverage in new receipt branches.

## Estimate

~3 days: function work incl. upload path + suite (1d), Travel-card legs UI
(0.5d), itinerary day-card surfacing B2 (0.5d), Add-a-booking sheet (0.5d),
affiliate link + copy edits (0.15d), E2E + review fixes + deploys (0.35d).
