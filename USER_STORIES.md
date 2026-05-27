# TripJam — User Stories for Review

**Status:** v2 — REVIEWED. All decisions locked into [LAUNCH_PLAN.md](LAUNCH_PLAN.md) §1 + §10 backlog as of 2026-05-26 sprint kickoff.
**Owner:** Achin (solo)
**Created:** 2026-05-26 · **Reviewed:** 2026-05-26
**Purpose (original):** Confirm scope and shared understanding for 8 new feature areas before adding to [LAUNCH_PLAN.md](LAUNCH_PLAN.md).
**Purpose (now):** Historical record of decisions. The LAUNCH_PLAN.md is the source of truth from this point on.

---

## Review status — DECISIONS LOCKED 2026-05-26

All 8 features reviewed. Decisions folded into [LAUNCH_PLAN.md](LAUNCH_PLAN.md) §1 (decisions D6-D26) and §10 (post-launch backlog). The per-story `Mark: ___________` lines below are historical — see the summary table for final scope.

### Story-by-story disposition

| Feature | Story | Status | Notes |
|---------|-------|--------|-------|
| F1 Inspirations | 1.1 Pre-trip panel | **KEEP** | Alongside route options. Button opt-in ("Get inspirations · ~8 credits"). Cost: 7.72 credits CHARGED (pass-through, no absorption per D24 directive). Switch from Sonnet → Haiku + 4 web searches. |
| F1 Inspirations | 1.2 Source pill on activities | **KEEP** | Existing branch design preserved. |
| F1 Inspirations | 1.3 Interest-aware | **KEEP** | Tags drive cache key (existing branch already does this). |
| F1 Inspirations | NEW: Bookmark, refresh, filter | **KEEP** | New ideas added 2026-05-26 per Q1c suggestion request. |
| F2 Chat | 2.1 Faster first response | **KEEP** | Target ≤1.5s TTFT. |
| F2 Chat | 2.2 Visual recommendations | **KEEP** | Wikipedia free first, Google Photo fallback at 0.70 credits (pass-through). |
| F2 Chat | 2.3 Actionable replies | **KEEP** | Buttons: Add / Open in Maps / Tell me more. |
| F2 Chat | 2.4 Cleaner shorter replies | **KEEP** | Prompt tweak for brevity. |
| F2 Chat | NEW: Update Itinerary snippet preview | **KEEP** | Added per Q2c — "View Updated Itinerary" button gets snippet + thumbnail of changes. |
| F3 Google Photos | 3.1 Premium photo button | **REJECTED** (2026-05-26) | No opt-in "Get better photo" button. F3 simplifies to: Wikipedia first → Google Photo automatic fallback when Wikipedia returns nothing. Charged 0.70 credits/photo (pass-through, silent). |
| F3 Google Photos | 3.2 Cached photos free | **KEEP** | Server-side cache; subsequent users free. |
| F3 Google Photos | 3.3 Wikipedia fallback always free | **KEEP** | Hotels stay on TripAdvisor (existing). |
| F4 Homepage | 4.1 Visual trip cards | **KEEP** | Cached destination photo, no editorial commission. |
| F4 Homepage | 4.2 Jump to any section | **REVISE** (2026-05-26) | Tab buttons differ by trip state: **show Routes always** (the RG/Brainstorm view) + **show Itinerary only when IG has been generated**. Pre-IG card: `Routes · Map · Board · Magazine`. Post-IG card: `Routes · Itinerary · Map · Board · Magazine`. Default tap on the card still goes to the most recent active view (Itinerary if present, else Routes). |
| F4 Homepage | 4.3 Inspirational empty state | **KEEP** | Smart featured destinations — curated initially, data-driven post-launch. |
| F4 Homepage | 4.4 Past trips memories | **CUT** | Not required per Q4d. |
| F5 Desktop | 5.1 Full screen on desktop | **KEEP** | Breakpoint ≥1024px (D21). |
| F5 Desktop | 5.2 Side-by-side map and itinerary | **REVISE** | Per Q5b: also include persistent chat. Final layout = sidebar + center itinerary + right column (map top + chat bottom). |
| F5 Desktop | 5.3 Persistent navigation sidebar | **KEEP** | 240px sidebar with trips list. |
| F6 IG speedup | 6.1 Something within 3s | **REVISE** | Per Q6b: only show days when COMPLETE (photos + navigation loaded). "Half-baked stuff" rejected. |
| F6 IG speedup | 6.2 Day-by-day progressive disclosure | **REVISE** (2026-05-26) — keep "complete days only" constraint AND add target: **Day 1 photos + navigation must load within 2-3 seconds of Day 1 itinerary text first appearing**. Stronger than the 8s in the earlier draft. Requires aggressive parallelism (Wikipedia + Photon in parallel for all Day 1 activities). |
| F6 IG speedup | 6.3 Warm-cache regeneration | **CUT** | Per Q6d: every trip unique, no caching. |
| F7 Credits | 7.1 No persistent indicator | **KEEP** | Pill removed entirely (D19). |
| F7 Credits | 7.2 On-demand credit check + top-up | **REVISE** (2026-05-26) | Avatar dropdown in top-right (D20). **Two pack SKUs**: Small `$5 → 300 credits` ($0.0167/credit) and Large `$10 → 1000 credits` ($0.01/credit). Top-up flow shows pack selector ("Small · 300 credits · $5" vs "Large · 1000 credits · $10 — best value"). Stripe checkout supports both products. |
| F7 Credits | 7.3 Polite low-credit warning | **KEEP** at **≤10 credits** (D4 changed from 15 → 10). |
| F7 Credits | 7.4 100 credits on signup | **KEEP** | D1 stays at 100. |
| F8 Navigation | 8.1 Background pipeline | **REVISE** | Per multi-iteration cost negotiation: hotels use smart escalation (Photon-first + heuristic check + Google fallback when needed). Activities use Photon-only + on-demand "Fix location" button. Pass-through Google cost (D24). |
| F8 Navigation | 8.2 Hotels via Google Places at selectHotel | **REVISE** | Not always Google — smart escalation (D25). Cheap heuristics first (chain regex, bad-hint detection), only ~30-40% need Google. Charged 1.70 credits/call pass-through. |
| F8 Navigation | 8.3 Fix transition_mins persistence | **KEEP** | Day 1 Part D. |
| F8 Navigation | 8.4 Admin geocode audit | **KEEP** | Post-launch month 1. |
| F8 Navigation | 8.5 User location corrections | **KEEP** | Post-launch month 1. |

### Launch sprint vs backlog

| Feature | Disposition |
|---------|-------------|
| F1 Inspirations | **Phase 1 shipped 2026-05-27** — merged from `inspiration` branch, Haiku 4.5 + 4 web searches, opt-in button in Magazine, ~7 credits per cold call (cached 30d). Surfaces in post-IG Magazine only for now; pre-trip Magazine integration is Phase 2. |
| F2 Chat enhancements | **Backlog** — month 1 |
| F3 Google Photo upgrade | **Backlog** — month 2 |
| F4 Homepage redesign | **Backlog** — month 1 (high impact) |
| F5 Desktop web | **Backlog** — month 2+ (large project) |
| F6 IG speedup | **Launch sprint Day 6** |
| F7 Credits rebuild | **Launch sprint Days 2-3** |
| F8 Navigation fix | **Launch sprint Day 1 (today)** |

### Cross-cutting decisions also locked

| ID | Decision |
|----|----------|
| D4 | Low-credit warning ≤ 10 (was 15) |
| D19 | No persistent credits UI |
| D20 | Top-right avatar dropdown as entry point |
| D21 | Desktop breakpoint ≥1024px |
| D22 | Desktop layout: sidebar + center + persistent map/chat right panel |
| D23 | LLM geocode hint format: "Place, neighborhood, city, country" |
| D24 | Google API pass-through cost model (no founder margin) |
| D25 | Smart hotel escalation (Photon-first + heuristic check) |
| D26 | Sprint kickoff today (2026-05-26) |

---

## Original review instructions (historical, superseded by table above)

For each feature below:
1. ~~Answer the clarifying questions~~ — answered
2. ~~Mark each story with KEEP/CUT/REVISE~~ — see disposition table above
3. ~~Confirm priority~~ — see launch-vs-backlog table above
4. ~~Confirm D4 change~~ — locked at 10

Once you reply, I'll fold approved scope into [LAUNCH_PLAN.md](LAUNCH_PLAN.md). Nothing committed until you say go.

**Priority key:**
- `P0` — Launch sprint (Days 1-11)
- `P1` — Post-launch month 1
- `P2` — Post-launch month 2+

---

## Meta-question

**Q0 — Scope/timing.** Of the 7 features below, which are intended for the **14-day launch sprint** vs the **post-launch backlog**?

My instinct:
- **#7 (credits flow rebuild) is launch-blocker** — must happen alongside Day 2 re-enabling
- **#6 (IG speed-up)** partly already planned for Day 6; expanded scope could move to launch
- **#1, #2, #4** are 2-4 weeks each post-launch
- **#3, #5** are bigger projects (month+)

Your call: ___________

---

# Feature 1 — Inspirations (RG + IG)

Extend the existing Inspirations feature (web-search-backed research digest, currently on the orphaned `inspiration` branch) to surface during both Route Generation and Itinerary Generation.

### Clarifying questions

- **Q1a** Start from the existing `inspiration` branch code, or rebuild from scratch in main?
- **Q1b** For **RG**: should Inspirations *influence* the routes Claude generates (input to prompt), or be *shown alongside* the routes (separate panel)? Or both?
- **Q1c** For **IG**: existing branch shows `ⓘ N sources` pill on each activity card, clicking reveals 2-3 sources with link-out. Keep that pattern?
- **Q1d** Cost: web search has a real per-call cost. Charge users credits per Inspirations digest (e.g., 5 credits per destination)? Subsidize? Free until $N/month?

### Stories

**Story 1.1 — Pre-trip inspiration during route exploration** (P1)
> As someone planning a trip to a place I don't know well, I want to see articles, blog posts, and travel writing about my destination while exploring route options, so I get real-world context that helps me pick the route that matches what I want to experience.

Acceptance:
- During RG (after destination is set, before/during route options appear), a new "Inspirations" panel shows 5-10 web-sourced articles
- Each article shows: title, source (e.g., "BBC Travel"), 1-line summary, link out
- Panel is collapsible; doesn't block route selection
- Cost is communicated to user (e.g., "1-time fetch, 5 credits") OR is free

Mark: ___________

**Story 1.2 — Source attribution on itinerary activities** (P1)
> As a user reviewing my generated itinerary, I want activity cards that pull from real sources (not LLM hallucination) to show me where the recommendation came from, so I can trust them and explore further.

Acceptance:
- Activities that match an Inspirations source show a small `ⓘ N` pill
- Clicking expands to show 1-3 source links with titles
- Activities without matching sources show no pill (don't pretend they have sources)

Mark: ___________

**Story 1.3 — Interest-aware inspirations** (P2)
> As someone with a specific interest (e.g., scuba diving, vegan food, photography), I want my Inspirations to reflect that interest, not generic travel content.

Acceptance:
- The pre-IG sheet's "notes" field is passed into the Inspirations query
- Inspirations digest is keyed on `(destination, monthBucket, derived_tags)` so changing interest tags forces a fresh fetch

Mark: ___________

---

# Feature 2 — Enhanced Chat Experience

Make Trippy chat feel faster, more visual, more actionable.

### Clarifying questions

- **Q2a** Speed — what specifically feels slow? Time to first character (~1.5s today with Sonnet streaming) or total response (~5-10s)?
- **Q2b** Images in chat — auto-fetch when a place is mentioned (has cost), or only on user-requested ("show me Kyoto temples")?
- **Q2c** What's the current biggest annoyance about Trippy's replies — too long? Too short? Wrong tone? No actions? **Give me one example reply that was bad.**
- **Q2d** "More links" — which kinds: Google Maps, Wikipedia, articles from Inspirations, "Add to my itinerary" buttons, all of these?

### Stories

**Story 2.1 — Faster first response** (P1)
> As a user chatting with Trippy, I want to see text start appearing within 1 second of sending my message, so the conversation feels alive.

Acceptance:
- Time to first token ≤ 1.5s on a 4G connection
- If model is slow, show a "Thinking…" indicator immediately (no blank state)

Mark: ___________

**Story 2.2 — Visual recommendations** (P1)
> As a user asking Trippy about places (sights, restaurants, neighborhoods), I want photos to appear inline with the recommendations, so I can quickly evaluate visually without opening external links.

Acceptance:
- When Trippy mentions a specific named place, a small thumbnail (60×60) appears next to the name
- Thumbnails come from cached Wikipedia first, Google Maps Photos as upgrade (charged if Feature 3 is live)
- Click thumbnail → opens Google Maps for that place

Mark: ___________

**Story 2.3 — Actionable replies** (P1)
> As a user, when Trippy suggests something concrete (a place, a day idea, a hotel), I want one-tap buttons to "Add to itinerary", "Open in Maps", or "Tell me more", so I don't have to retype.

Acceptance:
- Trippy's reply includes structured `actions[]` (already partly there per CLAUDE.md)
- Common actions surface as buttons: ➕ Add to itinerary · 📍 Open in Maps · 🔍 Tell me more
- Action results show inline confirmation ("Added Senso-ji to Day 2")

Mark: ___________

**Story 2.4 — Cleaner, shorter replies** (P1)
> As a user on mobile, I want Trippy's replies to be scannable (3-5 sentences max for most queries), not wall-of-text, so I can read on the go.

Acceptance:
- System prompt updated to prefer brevity + bullet structure
- Long-form ("write me a 3-day itinerary") allowed when explicitly requested

Mark: ___________

---

# Feature 3 — Google Maps Images (with cost pass-through)

Use Google Places Photo API (~$0.007 per call, ~1 credit at our rate) for higher-quality photos, with cost passed through to users.

### Clarifying questions

- **Q3a** Confirm: charge **1 credit per Google Maps photo fetch**?
- **Q3b** Default behavior: Google Maps first → Wikipedia fallback? Or user opts in ("Show Google photo, costs 1 credit")?
- **Q3c** Are users billed even if the photo is cached on our side (i.e., we already paid Google once)? Or only on cache miss?
- **Q3d** Scope: cover activities only, or also hotels, restaurants, cities (Magazine), trips list (Homepage)?

### Stories

**Story 3.1 — Premium photo for any place** (P2)
> As a user looking at an activity card with a poor or missing photo, I want to swap in a high-quality Google Maps photo for 1 credit, so my plan looks more realistic and appealing.

Acceptance:
- Activity cards with low-confidence/missing photos show a "📸 Get better photo (1 credit)" button
- Click → fetches Google Places Photo, charges 1 credit, caches server-side so subsequent loads are free
- New users see the same cached photo without re-paying

Mark: ___________

**Story 3.2 — Cached photos are free for the next user** (P0 for fairness)
> As a user, I shouldn't be charged for a Google photo that someone else already paid to fetch for the same place.

Acceptance:
- `place_cache` (or new `place_photo_cache`) stores `place_id → google_photo_url + fetched_at`
- Subsequent requests for the same `place_id` return cached photo, no credit charge
- Cache TTL configurable (default 90 days)

Mark: ___________

**Story 3.3 — Wikipedia fallback never costs credits** (P0)
> As a user with zero credits, I should still see SOME photo on every activity card, even if it's a humble Wikipedia thumbnail, so the app doesn't look broken.

Acceptance:
- Activity cards always show *some* photo when one is available
- The "upgrade to Google" UI is opt-in, never the default
- App is usable end-to-end without ever spending a credit on a photo

Mark: ___________

---

# Feature 4 — Immersive Homepage

Redesign `Home.jsx` to be more visual, more useful, and provide direct routes into all parts of the itinerary.

### Clarifying questions

- **Q4a** Trip card hero — use a cached destination photo (we already fetch one per trip), or commission a designer for editorial-style imagery?
- **Q4b** "Route to multiple parts of itinerary" — Map / Board / Magazine tab buttons on each card? Or list specific days ("Day 1: Tokyo, Day 2: Kyoto…")?
- **Q4c** New-user empty state — show "Featured destinations to inspire you" (carousel of sample trips), or just the "Plan your first trip" CTA we have now?
- **Q4d** Past trips — separate section ("Memories" / "Past adventures") with retrospective design (timeline, photo wall, share button)?

### Stories

**Story 4.1 — Visual trip cards** (P1)
> As a returning user with multiple trips, I want each trip card on my homepage to show a hero photo of the destination, so I can recognize trips at a glance.

Acceptance:
- Trip cards show a destination photo (cached, fetched once per trip)
- Card layout: photo + destination + dates + status badge (Planning / Upcoming / In Progress / Past)
- Photo fades in as it loads (no layout jank)

Mark: ___________

**Story 4.2 — Jump straight to any section** (P1)
> As a user with an active trip, I want to tap "Map", "Board", or "Magazine" directly from the homepage, so I can pick up exactly where I left off without going through the itinerary first.

Acceptance:
- Each active trip card shows 4 tab buttons: Itinerary · Map · Board · Magazine
- Buttons route directly to `/trip/:id/<tab>`
- Default tap (on card itself) still goes to itinerary

Mark: ___________

**Story 4.3 — Inspirational empty state for new users** (P1)
> As a brand-new user with no trips, I want the empty homepage to feel exciting, with sample destinations or trending trips, so I'm motivated to plan something.

Acceptance:
- New user sees: hero ("Where to next?") + 6 featured destinations as cards + primary "Plan a trip" CTA
- Tapping a featured destination pre-fills the setup wizard

Mark: ___________

**Story 4.4 — Past trips as memories** (P2)
> As a user returning from a trip, I want my completed trips to feel celebratory (not just "Past"), so I want to revisit them.

Acceptance:
- "Past adventures" section with photo-grid layout
- Each card shows trip dates + 1-line stat ("7 days · 3 cities · 12 activities")
- Optional: share button for retro-blog-style export

Mark: ___________

---

# Feature 5 — Desktop Web Version

Currently the app is mobile-first (~420px max-width). Add a proper desktop layout that uses the full screen.

### Clarifying questions

- **Q5a** Breakpoint where desktop layout kicks in: `≥1024px` (laptop+) or `≥768px` (tablet+)?
- **Q5b** Desktop architecture — pick one:
  - **(a) Wider mobile**: just stretch current views to ~720px max, more whitespace
  - **(b) Sidebar layout**: persistent left nav (trips list) + main content + right map panel
  - **(c) Map-first**: map is always visible/large, itinerary as overlay or side panel
- **Q5c** Do desktop and mobile share the same React components (responsive CSS) or fork into separate components?
- **Q5d** Any desktop-only features (drag-drop activities to reorder, keyboard shortcuts, multi-window planning)?

### Stories

**Story 5.1 — Use the full screen on desktop** (P1)
> As a user planning on my laptop, I want the app to use my full screen width (not a 420px column floating in the middle), so trip planning feels like a proper desktop experience.

Acceptance:
- Above 1024px viewport: layout uses up to 1440px width
- No 420px max-width visible on desktop
- Whitespace + padding scale up gracefully

Mark: ___________

**Story 5.2 — Side-by-side map and itinerary** (P1)
> As a desktop user reviewing my plan, I want to see the map and itinerary list side-by-side, so I can cross-reference without tab-switching.

Acceptance:
- Desktop layout: left column = itinerary (~50%) + right column = persistent map (~50%)
- Hovering an activity highlights the marker on the map
- Mobile keeps the existing tabbed layout (Map is a separate tab)

Mark: ___________

**Story 5.3 — Persistent navigation sidebar** (P2)
> As a desktop user, I want a persistent left sidebar showing my trip list, so I can switch trips without going to the homepage.

Acceptance:
- Desktop layout: left sidebar (~240px) shows trips + "+ New Trip"
- Selecting a trip switches the main panel without losing scroll position
- Sidebar collapses on viewport < 1024px

Mark: ___________

---

# Feature 6 — Speed Up Itinerary Generation (IG)

IG currently takes a long time and is a weak point. Multiple paths: streaming improvements, progressive disclosure, caching.

### Clarifying questions

- **Q6a** What's the current pain — too long until first day appears (TTI), too long until full plan is done (TTC), or both?
- **Q6b** Acceptable to show **Day 1 fully formed within 5 seconds** while Days 2-N stream in over the next 30s? Or do users need to see the full plan all at once?
- **Q6c** Today IG runs in two phases (compact then detailed). Acceptable to **kill the compact phase entirely** and just stream detailed from the start (saves ~5-10s but harder UX)?
- **Q6d** Caching — if a user generates "Tokyo, 7 days, mid-range, moderate pace" twice in a week, should the second be near-instant from cache?

### Stories

**Story 6.1 — Something happens within 3 seconds** (P0 if in launch sprint)
> As an impatient user, I want to see structural feedback within 3 seconds of clicking "Build", so I'm not staring at a blank screen.

Acceptance:
- Within 1s: day skeletons appear (Day 1, Day 2, Day 3… based on numDays)
- Within 3s: at least one activity or city banner appears
- Within 8s: Day 1 is fully formed
- Total time can still be 30-60s for long trips

Mark: ___________

**Story 6.2 — Day-by-day progressive disclosure** (P0)
> As a user, I want to start engaging with Day 1 while later days are still generating, so I don't have to wait for the full plan.

Acceptance:
- Day cards become interactive (collapse/expand, view activities) as soon as their content arrives
- Loading indicator on incomplete days only

Mark: ___________

**Story 6.3 — Warm-cache regeneration** (P2)
> As a user generating similar trips (e.g., I changed only my budget), I want the second generation to be much faster than the first.

Acceptance:
- IG requests with a high similarity score to a previous request (same destination, ±1 day length, same style tags) serve from cache for the static parts (transit tips, magazine, food specialties)
- Dynamic parts (activity selection) still regenerate

Mark: ___________

---

# Feature 7 — Credits Flow Rebuild

Less intrusive credits UX. No persistent indicator. Easy to check on demand. Low-credit warning at 10. 100 credits on signup.

### Clarifying questions

- **Q7a** "Don't show credits constantly" — kill the current top-right pill entirely? Or move it somewhere less prominent (e.g., inside the profile menu only)?
- **Q7b** "Easy to check" — where does the entry point live? Profile dropdown? Settings page? Account icon in nav?
- **Q7c** Confirm: warning threshold is **≤ 10 credits** (D4 changes from 15 → 10). ☐
- **Q7d** Should we show a small **per-action cost preview** before expensive calls? E.g., "Generate itinerary — ~25 credits" with a confirm button. Or skip and just deduct silently?
- **Q7e** Top-up flow — same Stripe Checkout planned for Day 2, or different (e.g., in-app pack selector with multiple amounts)?

### Stories

**Story 7.1 — No persistent credits indicator** (P0 — for launch)
> As a user planning a trip, I don't want a credit counter constantly visible distracting me — I just want to plan.

Acceptance:
- The persistent top-right green-dot pill is removed
- App has zero credit-related UI in the default planning experience
- Credits balance is only surfaced on demand (Story 7.2) or in low-credit warning (Story 7.3)

Mark: ___________

**Story 7.2 — On-demand credit check + top-up** (P0)
> As a user, I want a simple way to check my balance and buy more credits, accessible from a consistent place in the app.

Acceptance:
- Profile menu / settings includes "Credits" item showing current balance and "Top up" button
- "Top up" opens Stripe Checkout for $5 → 500 credits
- After successful purchase, a brief toast confirms ("500 credits added")

Mark: ___________

**Story 7.3 — Polite low-credit warning** (P0)
> As a user about to run out, I want a clear but non-intrusive warning so I can top up before getting blocked.

Acceptance:
- When `displayCredits(balance) <= 10`, a discrete banner appears at the top of the screen ("10 credits left — top up?")
- Banner is dismissible per-session
- Hard-stop modal still appears at `Math.floor(balance) === 0` (D5)

Mark: ___________

**Story 7.4 — 100 credits on signup** (P0)
> As a new user, I get 100 free credits on signup, enough to plan one full trip without paying.

Acceptance:
- Signup trigger sets `profiles.credits = 100` (replacing current 999999 disable-state)
- Reset all production users from 999999 → 100 (or whatever they had pre-disable + 100 — founder's call)
- Communicated in landing page copy

Mark: ___________

---

# Feature 8 — Navigation Accuracy (permanent fix, no phasing)

Specific bug surfaced 2026-05-26: trip showed "23 min drive" from Omoide Yokocho → Hotel Gracery Shinjuku, actual is ~12 min walk (same Shinjuku block). User reports such misses are common and explicitly directed: **no phasing, "Get directions" is a confusing failure state and we minimize it.**

### Root cause (verified against production data)

- `activities` table has `lat`, `lng`, `place_id`, `business_status` columns — **completely unused** (0 of 2,527 rows populated)
- All 148 hotels in production geocoded by name string only via Photon/Nominatim, re-resolved on every TransitionRow mount
- LLM-provided `geocode` hints are inconsistent: some are city names ("Alaya Resort Ubud" → "Ubud"), some are previous-night hotel names (cross-city pointing), some are chain names with disambiguation risk
- In-city sanity cap is 30km — a 7km mis-geocode within Tokyo passes it silently
- `selectHotel` discards coordinate data and stores only `geocode: hotel.geocode || hotel.title`
- `transition_mins` cache write is broken (0 / 2,527 persisted) — likely RLS or `tmp-` ID race

### Audit data (production, 2026-05-26)

| Metric | Value |
|--------|-------|
| Total activities | 2,527 |
| With lat/lng populated | **0** |
| Hotels | 148 |
| Hotels with lat/lng | **0** |
| With Google `place_id` | **0** |
| Persisted `transition_mins` | **0** |

---

## The permanent fix

**Single approach, no phasing**: every activity gets a resolved + persisted `lat/lng` before the user sees its transition. `TransitionRow` reads stored coords, never re-resolves. `"Get directions"` fallback is reserved for genuinely unfindable places (<1% of activities, logged for admin review).

### Pipeline (background, runs as each IG day streams in)

```
For each activity:
  1. Has activity.lat/lng already? → skip (idempotent)

  2. Try Photon with city bias (free, ~70% hit rate)
     ↓
  3. Sanity-check Photon result:
       - Distance from day.city center < 5km?
       - Result coordinates don't equal the city centroid itself?
       - For hotels: doesn't match a generic chain-fallback pattern?
     ↓
  4. If sanity fails OR Photon returned null
     → Google Places findPlaceFromText with hotel-or-poi type hint (~$0.017)
     ↓
  5. Persist lat, lng, place_id, geocode_source ('photon' | 'google_places' | 'llm_hint' | 'user_corrected'),
            geocode_confidence ('high' | 'medium' | 'low')
     ↓
  6. Done — TransitionRow now renders exact time
```

### TransitionRow after the fix

- If both endpoints have stored `lat/lng` → render exact walk/drive time. ~99% of cases.
- If one is still resolving → render `"···"` indicator with 10s timeout
- If genuinely unresolvable (Google Places returned nothing) → render "Get directions" + log to admin audit table for manual fix

### Cost analysis

| Item | Cost |
|------|------|
| Photon (existing proxy) | Free |
| Google Places `findPlaceFromText` (when Photon fails sanity) | $0.017/call |
| Typical trip (20-30 activities, ~30% need Google fallback) | ~$0.10 first generation |
| With aggressive global `place_cache` reuse across users | ~$0.03 after first 1k trips |
| Hotels always go to Google Places (chains are too risky) — 3-5/trip | $0.05-0.09 |
| **Total per typical trip** | **~$0.13 cold, ~$0.05 warm** |
| One-shot backfill of 2,527 existing activities | **$15-45 one-time** |

**Cost is absorbed**, not passed to users via credits. Accuracy is table-stakes; charging for it creates UX friction. The cost is small at scale and improves with caching.

### Clarifying questions

- **Q8a** Backfill the 2,527 existing activities now (one-time $15-45 to Google), or only resolve activities in newly-generated trips going forward? Backfill makes existing trips accurate retroactively.
- **Q8b** Cache TTL for `place_cache` — current is 5 min on misses, no expiry on hits. Confirm: 90 days for hits (places don't move), 24h for misses?
- **Q8c** Should the LLM be re-prompted to provide better `geocode` strings (e.g., "Hotel Gracery Shinjuku, Yasukuni-dori, Shinjuku, Tokyo, Japan") to improve Photon hit rate? Adds ~200 tokens to IG output → ~$0.003 extra per IG call.
- **Q8d** When does this ship? Options:
  - (i) Before launch sprint kicks off (this week, 2-3 days work)
  - (ii) First item in launch sprint Day 1 (delays other Day 1 work)
  - (iii) Day 6 as part of perf pass (perf-adjacent)

### Stories

**Story 8.1 — Activities have persistent, accurate coordinates** (P0 — launch blocker per user direction)
> As a user, every place on my itinerary has an exact location pinned before I see the transition time, so I never see a misleading "23 min drive" for a 12-min walk.

Acceptance:
- After IG streams a day, background job resolves `lat/lng` for every activity in that day using the escalation pipeline (Photon → Google Places fallback)
- Resolved coordinates persist to `activities.lat`, `lng`, `place_id`, `geocode_source`, `geocode_confidence`
- TransitionRow exclusively reads stored coords; never calls `geocodePlace` for activities that have lat/lng
- For an activity in-flight (background still resolving), TransitionRow shows `"···"` with 10s max wait
- Sanity check rejects Photon results > 5km from `day.city` center; falls through to Google Places
- One-shot backfill script populates lat/lng for all existing 2,527 activities (one execution, $15-45 total cost)

Mark: ___________

**Story 8.2 — Hotels store coordinates from Google Places at selection time** (P0)
> As a user, when I pick a hotel from the carousel, its exact building location is stored — no chain-hotel disambiguation roulette later.

Acceptance:
- `selectHotel` in `App.jsx` calls `places-proxy?action=lookup-place` (new action) before inserting the activity
- The lookup uses `findPlaceFromText` with `type=lodging` and includes the day's city for biasing
- Resulting `lat`, `lng`, `place_id`, `business_status` are written to the new activity row
- If the lookup fails (very rare), fall through to the same background pipeline as Story 8.1

Mark: ___________

**Story 8.3 — `transition_mins` cache write is fixed** (P0)
> As a maintainer, transition calculations persist correctly so we have audit visibility and avoid recomputing across mounts.

Acceptance:
- Investigate why `supabase.from("activities").update({ transition_mins, transition_mode })` writes nothing in production (0/2,527 rows)
- Likely culprits: (a) update RLS policy excludes the caller, (b) `act.id` is `tmp-*` for in-flight activities, (c) the update is fire-and-forget without awaited error handling
- After fix, sample 5 new trip generations and confirm rows have `transition_mins` populated
- Add Sentry breadcrumb for any failed transition write so future breakage is visible

Mark: ___________

**Story 8.4 — Admin audit visibility for genuinely unfindable places** (P1)
> As founder, the rare cases where Google Places truly can't find a place should be visible to me so I can manually fix or remove them.

Acceptance:
- New Admin tab "Geocode Audit" lists activities where `geocode_source = 'unresolved'` OR `geocode_confidence = 'low'`
- Each row shows: place name, day's city, last resolution attempt timestamp, link to Google Maps with the search string
- Founder can manually paste a coordinate → updates the activity AND a global `geocode_overrides` table that future trips with the same place name read first

Mark: ___________

**Story 8.5 — User-driven corrections** (P1 — post-launch acceptable)
> As a user noticing a wrong pin, I fix it in 2 taps, helping myself and future users.

Acceptance:
- 3-dot menu on activity card → "Fix location"
- Opens mini map centered on current pin
- User drags pin or taps new location → saves new `lat`, `lng` to activity + writes to shared `geocode_overrides`
- Small "📍 Fixed" badge appears on the corrected activity
- Other users planning a trip with the same place name get the corrected coords automatically

Mark: ___________

### What we explicitly are NOT building

- ❌ Phased "safety net" hotfix (would mean showing "Get directions" more, which user explicitly rejected)
- ❌ Per-photo / per-geocode credit charging (cost is absorbed — accuracy is table-stakes)
- ❌ Multiple "is this OK?" confirm dialogs in the resolve flow (silent, background, just works)

### Effort + timing

| Story | Effort | When |
|-------|--------|------|
| 8.1 — Pipeline + backfill | ~1.5 days | **Pre-launch sprint** OR **Day 1 of sprint** (your call per Q8d) |
| 8.2 — Hotel Google Places lookup | ~4h | Same as 8.1 |
| 8.3 — Fix transition write | ~2h | Same as 8.1 |
| 8.4 — Admin geocode audit tab | ~4h | Post-launch month 1 |
| 8.5 — User corrections | ~1 day | Post-launch month 1 |

Total launch-blocker work: **~2.5 days** (Stories 8.1, 8.2, 8.3 together).

---

# Summary table — your decisions

| # | Feature | Stories | My recommended timing | Your call |
|---|---------|---------|----------------------|-----------|
| 1 | Inspirations RG + IG | 3 | Backlog month 1 (needs branch merge + schema cleanup) | _________ |
| 2 | Chat enhancements | 4 | Backlog month 1 | _________ |
| 3 | Google Maps images | 3 | Backlog month 2 | _________ |
| 4 | Homepage redesign | 4 | Backlog month 1 (high impact, medium effort) | _________ |
| 5 | Desktop web | 3 | Backlog month 2+ (large project, needs design) | _________ |
| 6 | IG speed-up | 3 | Launch sprint (Day 6 perf, partly already planned) | _________ |
| 7 | Credits flow rebuild | 4 | Launch sprint (Day 2/3 — replaces current pill design) | _________ |
| 8 | Navigation accuracy (permanent fix) | 5 | **Launch blocker** — Stories 8.1-8.3 ship together (~2.5 days). 8.4-8.5 post-launch month 1. | _________ |

---

# Cross-cutting decisions to lock in

| ID | Decision | Current value | Proposed | Confirm? |
|----|----------|---------------|----------|----------|
| D4 | Low-credit warning threshold | ≤ 15 credits | **≤ 10 credits** | ☐ |
| D7-new | "Always-on" credits UI | persistent pill (top-right) | **none — on-demand only** | ☐ |
| D8-new | Free credits on signup | 100 (already set, but currently 999999 in DB) | **100 on next reset** | ☐ |

---

# Next steps (after your review)

1. You mark each story `[KEEP]` / `[CUT]` / `[REVISE: ...]` and answer the questions
2. I update [LAUNCH_PLAN.md](LAUNCH_PLAN.md) with the approved scope split into launch-sprint vs backlog
3. For launch-sprint items, I add detailed task breakdowns to the appropriate Day (1-11)
4. For backlog items, I add to §10 with rough effort estimates
5. Nothing committed until you say so
