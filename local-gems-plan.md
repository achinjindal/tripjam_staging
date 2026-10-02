# Local Gems Redesign — Activity-Anchored Gems

**Design mockup:** `local-gems-design.html` (open in browser)
**Status:** plan — not implemented
**Scope:** frontend-only + one prompt nudge. No DB migration. No new edge function.

## Goal

Move local gems from a bottom-of-day dump (`WishlistSection`) to inline
suggestions anchored under the activity they're near, with one-tap **Add**
(direct insert, no LLM round-trip) and **Dismiss**. Gems should read as
"while you're here, this is 4 minutes away" — decision support at the moment
the user is looking at that part of their day, not an appendix they scroll
past.

## Why now

- The anchoring data already exists: every gem has `near` — the _exact
  verbatim title_ of its closest activity in the same day (prompt rule at
  `supabase/functions/generate-itinerary/index.ts:73`, schema at `:86`).
  Today `near` is only used to print "📍 Near X" (`src/App.jsx:6075-6086`).
- "Add to Itinerary" currently opens chat and asks the LLM to add the place
  (`src/App.jsx:14712-14723`) — a full `update_day` delete-and-reinsert of
  the whole day (`src/App.jsx:11053-11205`). Slow (LLM latency), costs
  credits, and can mangle the rest of the day. We already have a direct-insert
  template that does this safely: `selectHotel` (`src/App.jsx:9111-9224`) —
  verify-place ladder → position computation → `activities` insert → state
  splice.

## Current state (facts)

| What                             | Where                                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage                          | `days.wishlist` jsonb (`schema.sql`, migration `20260330000002`) — array of `{id, title, geocode, near, dismissed?}` (+legacy `note`/`icon`) |
| Generation                       | `generate-itinerary/index.ts:73,86,118` — 2-3 gems/day, 3 fields only                                                                        |
| Chat rewrite                     | `chat/index.ts:192` — omits `wishlist` unless day area changed                                                                               |
| Render                           | `WishlistSection` `src/App.jsx:6094-6131`, `GemCard` `:5826-6093`, placed after the whole activity loop `:6754-6765`                         |
| Dismiss                          | `dismissGemPersist` `src/App.jsx:10658-10678` (soft `dismissed:true` + system-undo chat msg); undo at `:17012-17040`                         |
| Add                              | chat-delegated `src/App.jsx:14712-14723` — **no direct path exists**                                                                         |
| ID backfill                      | gems get `crypto.randomUUID()` on load `src/App.jsx:7645-7652`                                                                               |
| Leak: dismissed gems still shown | deep-dive roll-up `src/App.jsx:3378-3383` and brainstorm city cards `:4011-4016` don't filter `dismissed`                                    |

## UX spec

### 1. Inline gem row (the core change)

Directly under an activity that is some gem's `near` anchor, render a **gem
row** inside the timeline: visually a suggestion, not an itinerary item —
sand-tinted card, dashed left join to the rail, ✨ marker, smaller (40px)
photo thumb.

Contents: thumb · title (serif, 14px) · walk-time pill when computable
(haversine from anchor's lat/lng to gem geocode result — reuse the
TransitionRow distance helpers in `photos.js`) · two always-visible controls:

- **`+ Add`** (ocean text button) — the one primary action: direct insert
  after the anchor (below)
- **`⋯`** (26px circular button) — menu with exactly three items:
  - **💬 Tell me more** — opens Trippy chat and sends "Tell me more about
    {gem.title} near {anchor.title}" (the existing Ask Trippy path,
    `onAskTrippy` → `src/App.jsx:6123`, but pre-sent rather than prefilled
    so the answer starts streaming immediately)
  - **🗺️ Open in Maps** — same Google Maps search link as today
  - **✕ Dismiss** (danger-styled, last) — existing `dismissGemPersist` +
    undo

Tapping the row body (not the buttons) also opens Google Maps — same as
today's thumb link (`src/App.jsx:5848`). This shrinks the old 4-item GemCard
menu rather than removing it: Add is promoted out to the row, Ask Trippy
becomes "Tell me more".

Multiple gems anchored to the same activity stack (max 2 shown; third+
collapses behind "＋N more nearby" toggle — rare, 2-3 gems/day total).

### 2. Fallback bucket

Gems whose `near` matches no activity title in the day (fuzzy: trim +
case-insensitive compare, same as today's exact check but lowercased) render
in a slim **"✨ Also nearby"** strip at the end of the day — the old
WishlistSection reduced to one compact horizontal scroll row. This keeps
every gem reachable without reviving the old dump. After a chat `update_day`
rewrites activities, orphaned gems degrade here gracefully.

### 3. Add = instant, with undo

Tap **Add** →

1. Row shows inline spinner state ("Adding…"), buttons disabled.
2. Verify + geocode via `places-proxy?action=verify-place` (ladder copied
   from `selectHotel`, `src/App.jsx:9135-9160`). Verification failure does
   NOT block — fall through with the raw geocode string (gems were already
   prompt-validated as real places; never punish the user with an error for
   our lookup miss).
3. Insert into `activities`: `day_id`, `title: gem.title`, `type: "sight"`,
   `duration: "45m"`, `time: ""` (untimed — renders after the anchor by
   position), `icon: "✨"`, `note: gem.note || ""`, `geocode`,
   `position: anchor.position + 0.5` then client-side stable re-sort (the
   day render already orders by position; on next full-day rewrite positions
   get re-integered anyway). `added_by: userId`.
4. Optimistic splice into `days` state right after the anchor; kick the
   existing per-activity photo fetch.
5. Mark the gem `dismissed: true` **with a new flag `promoted: true`** in
   `days.wishlist` (so undo of the activity delete can resurrect it, and
   analytics can tell adds from dismissals).
6. `logActivity("add_activity")` with undo payload; emit the same
   `role:"system-undo"` chat message pattern as dismiss
   (`src/App.jsx:10669-10677`) — "Added Tsukiji Outer Market to Day 2. Undo".
   Undo = delete the inserted row + flip `dismissed/promoted` back.

No chat LLM round-trip, ~1s perceived. (Not fully free: the verify-place
ladder deducts its internal Haiku/Google costs, same as hotel selection —
but an order of magnitude cheaper than the current chat-rewrite path.)

### 4. Dismiss

Unchanged mechanics (`dismissGemPersist`), new entry point (`⋯` → Dismiss).
Undo toast/chat message as today.

### 5. Cleanups riding along

- Filter `dismissed` in the deep-dive roll-up (`src/App.jsx:3378-3383`) and
  brainstorm highlights (`:4011-4016`) — bug today.
- Delete the dead compact-view gem count (`src/App.jsx:6343-6355`, already
  `{false && …}`).
- `GemCard`/`WishlistSection` shrink to the fallback-strip variant; the ⋯
  menu code (~120 lines) goes away.

## Prompt nudge (generate-itinerary only)

Strengthen the `near` rule so anchoring stays reliable:

> "near" MUST be copied verbatim from one of THIS day's activity titles —
> it anchors the gem in the UI; a gem whose near matches nothing is demoted.

One line edit at `generate-itinerary/index.ts:73` (and mirror in the DAYFILL
override at `:118`). No schema change. Chat contract (`chat/index.ts:192`)
already regenerates gems only when the day area changes — keep as is.

## Data model

No migration. `days.wishlist` gains one optional client-written flag:
`promoted: true` (alongside existing `dismissed`). Old rows without it are
unaffected. The activity insert uses only existing `activities` columns.

## Implementation steps

1. **`src/App.jsx` — grouping**: in `DaySection`, build
   `gemsByAnchor: Map<activityTitleLower, gem[]>` + `orphanGems[]` from
   `day.wishlist` (skip `dismissed`). Render `InlineGemRow` after each
   activity block that has entries; render `AlsoNearbyStrip` where
   WishlistSection sits today (`:6754-6765`).
2. **New `InlineGemRow`** (in App.jsx next to GemCard): thumb via
   `_fetchPhoto` (same as GemCard `:5832`), walk-time pill (haversine when
   both coords known — anchor activities carry `lat/lng` columns), Add/×.
3. **`addGemAsActivity(day, anchorActivity, gem)`** — new handler next to
   `selectHotel`, following its verify→insert→splice shape
   (`:9111-9224`), plus wishlist `promoted` write and system-undo message.
   Wire through `DaySection` props like `onAddGemToItinerary` today
   (`:6391-6392`), replacing the chat-delegated body at `:14712-14723`.
4. **Undo**: extend the existing undo handler switch (`:17012-17040`) with
   the promote case (delete activity row, un-promote gem).
5. **Fallback strip**: refit `WishlistSection` → horizontal compact cards
   (thumb 32px, title, same `⋯` menu; tapping the card opens Maps; Add
   lives in the menu here — anchor = last activity of the day).
6. **Cleanups** (§5 above).
7. **Prompt edit** in `generate-itinerary` (+ deploy both envs).
8. **PostHog**: `gem_promoted` {trip_id, day_index, matched_anchor:bool},
   `gem_dismissed` {surface: inline|strip}. Mirrors existing event style.
9. **E2E** (`e2e/` new spec or extend interactions.spec): seeded day with
   wishlist → inline row renders under anchor; Add → activity appears after
   anchor + gem leaves suggestions; Dismiss → row gone + undo restores;
   orphan gem lands in Also-nearby strip.

## Edge cases

- Gem with no `id` → backfill already handles (`:7645`); Add also requires id.
- Anchor activity deleted after render → Add re-checks anchor exists in
  current state; if gone, insert at end of day (position = last + 0.5).
- Same gem title already an activity in the day → hide the gem row entirely
  (dedupe guard, case-insensitive title compare).
- Offline/localStorage days (no DB ids, `tmp-*`) → hide Add, keep × local.
- Public share view (`TripPublicView.jsx`) never rendered gems — unchanged.

## Rollout

No feature flag: this restyles an existing prod surface and replaces a
worse add-path with a better one; blast radius is the day card. Verify on
staging (dev server + E2E), then ship through the normal flow. The prompt
edit deploys with the same release so new trips get stricter `near` values;
old trips degrade gracefully via the fallback strip.

## Estimate

~1 day: grouping + inline row (3h), direct add + undo (3h), strip refit +
cleanups (2h), E2E + prompt + deploy (2h).
