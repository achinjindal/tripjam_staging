# Local Gems Redesign — Engineering Plan (v2, post-review)

**Product spec:** `local-gems-plan.md` · **Design:** `local-gems-design.html`
**Status:** reviewed — ready to implement
**Review:** independent senior-eng review 2026-09-25 — verdict **APPROVE
WITH CHANGES**; all blockers (B1, B2) and majors (M1–M9) incorporated below.

---

## 0. Verified constraints

Checked against the codebase (citations corrected per review M8):

1. **`activities.position` is `integer`** (`schema.sql:3020`). Fractional
   positions are not implementable.
2. **Precedent tolerates duplicate positions.** `selectHotel`
   (`src/App.jsx:9117-9224`) inserts at a computed index with no shifting.
   Activities are ordered by a **client-side stable sort on `position`** at
   trip load (`App.jsx:7656`) and realtime reconcile (`App.jsx:7270`) —
   ties fall back to unspecified PostgREST embed order, so duplicates can
   swap on reload. (The `.order("position")` calls at 7292/7679 are for
   _days_, not activities.)
3. **Write discipline:** every write awaited + `error` checked. Note
   `selectHotel`'s own insert (`App.jsx:9197-9201`) does NOT check error —
   it is a counter-example, not the pattern to copy.
4. **Gems have no coordinates**; anchors have `lat/lng` columns.
5. Gem identity: `gem.id` backfilled on load (`App.jsx:7645-7651`,
   persisted `:7693-7704`); `dismissGemPersist` requires it (`:10660`).
6. Wishlist write sites (5): `App.jsx:7699, 10668, 11127-11130,
17032-17035`, `feed.js:138-143`.
7. **Anchor titles are mutable client-side:** `verifyActivity` persists
   Haiku-repaired titles (`photos.js:869-885`) and `preloadDay` runs it on
   every day expand (`App.jsx:8294-8310`) — `gem.near` keeps the ORIGINAL
   title. Grouping must account for this (D5).
8. **Add is not credit-free** (review M4): the verify-place ladder deducts
   Haiku credits fire-and-forget internally and charges ~$0.017 Google
   pass-through at tier 4 (`places-proxy/index.ts:1162-1170, 1553-1556`);
   it never returns 402. Same cost profile as hotel selection today. No
   client-side 402 branch — it would be dead code.
9. **`GemCard` spans `App.jsx:5826-6090`**, `WishlistSection` `:6092-6131`;
   single call sites each; no references in TripPublicView/StoryView/
   Magazine → deletion safe.
10. System-undo chat messages are **session-local** (never persisted —
    `dismissGemPersist` only calls `setChatMessages`). Undo won't survive
    reload; this matches the existing dismiss behavior.

## 1. Decisions

**D1 — Insert position: renumber-on-insert, per-row updates.**
`spliceIdx = anchorIdx + 1`; new row gets `position = spliceIdx`; then
re-sequence every shifted row via `Promise.all` of individual
`supabase.from("activities").update({ position }).eq("id", id)` calls.
NOT a batched upsert (review B2): a concurrently-deleted id would take
upsert's INSERT path with only `{id, position}` → `title NOT NULL` +
INSERT-policy violation → the whole batch aborts. Per-row updates isolate
failures; renumber failure is non-fatal (in-memory order is already
correct; log to console). RLS is safe for co-travellers: activities UPDATE
policy is membership-scoped, not creator-scoped (`schema.sql:5500`).

**D2 — Walk-time pill via `geocodePlace`.** Use the existing
`geocodePlace(gem.title, day.city, gem.geocode)` from `photos.js:700` —
it already enriches with city context and caches in `_geocodeCache`
(`photos.js:680`). No new cache. Haversine vs anchor `lat/lng`; show
"N min walk" only when both coords exist and distance ≤ 2.5 km; silent
absence otherwise.

**D3 — `promoted: true` beside `dismissed: true`** on promoted gems, so
every existing `dismissed` filter keeps working unmodified.

**D4 — "Tell me more" pre-sends** via `sendChatDirect` with
`Tell me more about {gem.title} near {anchor.title}.`
Caveat (review): `sendChatDirect` silently no-ops while `chatLoading`
(`App.jsx:10693`) — if chat is mid-stream, fall back to opening the chat
panel with the text prefilled instead of dropping it.

**D5 — Anchor matching is repair-aware** (review M3). `groupGems` indexes
each activity under BOTH `norm(a.title)` and
`norm(a.geocode_corrected_from)` (when present), so a Haiku title repair
doesn't demote its gems to the strip mid-session.

**D6 — Undo is session-local system-undo only** (review M5).
`add_activity` is not in feed.js's `UNDOABLE` set and gets no feed-undo
case in v1 — the chat system-undo message (same as dismiss) is the undo
surface. `logActivity` is called with its real object signature
(`activity.js:40-48`), summary only, no undoPayload.

## 2. Implementation — file by file

### 2.1 `src/App.jsx` — grouping + components

**(a) `groupGems(day)`** (pure helper near WishlistSection):

```js
function groupGems(day) {
  const norm = (s) => (s || "").trim().toLowerCase();
  const acts = day.activities || [];
  const titleSet = new Set(acts.map((a) => norm(a.title)));
  const anchorKeys = new Map(); // norm key -> activity id (first match only)
  for (const a of acts) {
    if (!anchorKeys.has(norm(a.title))) anchorKeys.set(norm(a.title), a.id);
    const corr = norm(a.geocode_corrected_from); // D5: repair-aware
    if (corr && !anchorKeys.has(corr)) anchorKeys.set(corr, a.id);
  }
  const byActivityId = new Map(); // activity id -> gem[]
  const orphans = [];
  for (const g of day.wishlist || []) {
    if (g.dismissed) continue;
    if (titleSet.has(norm(g.title))) continue; // dedupe guard
    const anchorId = anchorKeys.get(norm(g.near));
    if (anchorId) {
      if (!byActivityId.has(anchorId)) byActivityId.set(anchorId, []);
      byActivityId.get(anchorId).push(g);
    } else orphans.push(g);
  }
  return { byActivityId, orphans };
}
```

Keyed by **activity id**, not title (review M6) — duplicate-title days
render each gem exactly once, under the first matching activity.

**(b) `InlineGemRow`** — new component adjacent to `GemCard`. Props:
`gem, anchor, city, onAdd, onDismiss, onTellMore, busy`. 40px thumb via
`_fetchPhoto(gem.geocode || gem.title, city, "sight")`; serif title;
walk-time pill (D2); `+ Add`; `⋯` → Tell me more / Open in Google Maps
(inline SVG pin) / Dismiss. Menu = GemCard's existing local-state +
backdrop pattern, 3 items. `busy` → "Adding…", both controls disabled.

**(c) `DaySection` wiring:** `const { byActivityId, orphans } =
groupGems(day)` once per render. After each activity card, render up to 2
`InlineGemRow`s from `byActivityId.get(act.id)` + "＋N more nearby"
expander. Replace the WishlistSection block (`:6754-6765`) with
`<AlsoNearbyStrip items={orphans} …/>`. Thread `onPromoteGem`,
`onTellMoreGem` alongside existing `onDismissGem` plumbing
(`:14712-14730`). Dismiss callback gains a `surface` arg
("inline" | "strip") threaded from the calling component (review minor 10).

**(d) `AlsoNearbyStrip`** — replaces `WishlistSection` internals:
horizontal `overflow-x:auto` compact cards (32px thumb, title, same `⋯`
menu; Add lives in the menu, anchor = day's last activity).

**(e) Delete `GemCard`** (`:5826-6090`) once (b)+(d) land.

### 2.2 `src/App.jsx` — `addGemAsActivity(dayId, anchorActivityId, gem)`

```
1. Guards: day exists; gem.id; !gem.dismissed; norm(gem.title) not an
   activity title (re-check at click time).
2. Anchor: find by id → else last activity → else abort with toast
   ("Add an activity first").
3. Mark gem busy (per-gem Set in state).
4. verify-place (copy selectHotel's ladder `:9134-9160`) with
   { name: gem.title, city: day.city, hint: gem.geocode, type: null,
     tripId }.
   type: null, NOT "attraction" (review M1 — invalid Google type would
   400 tier 4 forever, and type is part of the verify cache key).
   Non-blocking on any failure. No 402 branch (constraint 8).
5. spliceIdx = anchorIdx + 1.
6. insertPayload = { day_id, time: null, title (repaired corrected_to if
   returned), geocode, type: "sight", duration: "45m", note: gem.note||"",
   icon: "✨", confirmed: false, position: spliceIdx,
   added_by: session.user.id, + resolved lat/lng/place_id/geocode_* block
   as selectHotel `:9184-9195` }.
   time: null, NOT "" (review M9 — "" <= "14:00" is true and would
   inflate selectHotel's future position math; null compares false; no
   render path parses time, StoryView guards with act.time &&).
7. const { data: newAct, error } = await insert().select().single();
   error → toast, un-busy, return.
8. IMMEDIATELY (review minor 8 — shrink the realtime-reconcile window):
   single setDays that (a) splices newAct at spliceIdx, (b) re-maps
   activities.map((a, idx) => ({ ...a, position: idx })) so in-memory
   position fields match the new order (review M2), (c) marks the gem
   { dismissed: true, promoted: true } in day.wishlist.
9. await days.update({ wishlist }) — check error.
10. Renumber DB (D1): Promise.all of per-row position updates for rows
    whose position changed; failures logged, non-fatal.
11. Photo warm for the single new activity (reuse the update_day applier's
    per-activity fetch pattern `:11147-11190`).
12. logActivity({ tripId, action: "add_activity", entityType: "activity",
    entityId: newAct.id, summary: `added "${title}" from gems` }) — object
    signature, no undoPayload (D6).
13. Push system-undo chat message (shape of `:10669-10677`):
    undoData { promotedGemId: gem.id, dayId, activityId: newAct.id }.
14. posthog gem_promoted { trip_id, day_index, matched_anchor }.
```

**Undo case** — extend the handler switch (`:17012-17040`):
`promotedGemId` → `await activities.delete().eq("id", activityId)` (check
error), remove from state, flip gem `dismissed:false, promoted:false`,
persist wishlist. Position holes are harmless (sort survives gaps).
Session-local only (constraint 10).

**Replace the old add path** (`:14712-14723`): body → `addGemAsActivity`;
delete the `sendChatDirect` add-request. "Tell me more" uses D4.

**Offline:** no `tmp-` id heuristic (review minor 9 — cached days carry
real ids). Don't pre-gate; let the insert fail → toast. (Optional polish:
`!navigator.onLine` hides Add.)

### 2.3 Cleanups (same PR)

| What                                        | Where               |
| ------------------------------------------- | ------------------- |
| Filter `dismissed` in deep-dive roll-up     | `App.jsx:3378-3383` |
| Filter `dismissed` in brainstorm highlights | `App.jsx:4011-4016` |
| Delete dead compact gem count               | `App.jsx:6343-6355` |
| Delete `GemCard`                            | `App.jsx:5826-6090` |

### 2.4 `supabase/functions/generate-itinerary/index.ts` — prompt nudge

Append to the WISHLIST rule at `:73`:
`"near" MUST be copied verbatim from one of THIS day's activity titles.`
(The DAYFILL override starting at `:109` inherits SYSTEM_PROMPT rules, so
the one edit covers both paths; mirroring it there is optional redundancy.)
Deploy both envs with the release.

### 2.5 Telemetry

`gem_promoted {trip_id, day_index, matched_anchor}`;
`gem_dismissed {surface}` via the threaded surface arg. Existing
`posthog.capture` style.

## 3. Test plan

**E2E — new `e2e/local-gems.spec.ts`.** Seeding: use the direct-DB pattern
from `e2e/collab-invite.spec.ts` (`createClient` + qa-user password auth →
table writes; review M7 — `helpers.ts` has no Supabase client and
board.spec seeds via slow UI-driven RG/IG). Create trip/days/activities
rows with client-side UUIDs, then set `days.wishlist` as the qa user
(days UPDATE is member-scoped → passes RLS).

| #   | Case                                         | Assert                                                                                                        |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Gem `near` = activity 1 title                | inline row after activity 1; strip absent                                                                     |
| 2   | Gem with bogus `near`                        | Also-nearby strip only                                                                                        |
| 3   | + Add                                        | activity after anchor (✨, type sight, `time` null, added_by set); gem row gone; DB positions contiguous 0..n |
| 4   | Undo (same session — undo is session-local)  | activity deleted; gem row back                                                                                |
| 5   | ⋯ → Dismiss                                  | row gone; `wishlist[i].dismissed=true`; undo restores                                                         |
| 6   | ⋯ → Tell me more                             | chat opens with sent message containing gem title                                                             |
| 7   | Gem title equals existing activity           | gem hidden                                                                                                    |
| 8   | Day with two same-title activities + one gem | gem renders exactly once                                                                                      |
| 9   | Dismissed gem                                | absent from deep-dive roll-up (leak regression)                                                               |

**Manual staging:** long day (8 activities + 3 gems) on mobile viewport —
rail integrity; title-repair flow (expand a day with a repairable anchor,
confirm the gem stays anchored via `geocode_corrected_from`); shared trip
with the second qa account (renumber under membership RLS; expect a brief
gem-row flash if a realtime reconcile lands mid-add — accepted).

## 4. Rollout

1. **Branch off `main`** (review B1 — NOT routes-lens, which is an
   unmerged flag-dark feature branch; basing there would drag it to prod).
2. `npm run check` + E2E (DNS pin if needed).
3. Deploy `generate-itinerary` to staging → staging QA → prod function →
   merge/push frontend (standard order).
4. Watch: PostHog `gem_promoted` vs `trippy_action_apply`; Sentry for
   insert errors.

**Rollback:** frontend revert restores WishlistSection; inserted
activities are ordinary rows, no cleanup; prompt nudge is
backward-compatible.

## 5. Review outcomes (for the record)

- **B1** wrong base branch → §4.1 branches off `main`.
- **B2** batched upsert atomic-abort footgun → D1 per-row updates.
- **M1** invalid Google type → `type: null` (step 4).
- **M2** stale in-memory positions → step 8(b) re-maps position fields.
- **M3** title-repair demotes gems → D5 `geocode_corrected_from` index.
- **M4** fake 402 branch, "credit-free" claim → constraint 8; product
  spec's "no credits" corrected: Add costs the same as hotel-select
  (internal Haiku deduction + possible Google pass-through), just no chat
  LLM round-trip.
- **M5** logActivity misuse → D6 object signature, session-undo only.
- **M6** duplicate-title double render → groupGems keyed by activity id.
- **M7** E2E seeding pattern → collab-invite pattern cited.
- **M8** citation errors → constraint 2/3 corrected.
- **M9** `time:""` wrinkle → `time: null`.
- Minors adopted: geocodePlace cache reuse (D2), DAYFILL note (§2.4),
  chatLoading fallback (D4), same-session undo note (test 4), reconcile
  window ordering (step 8), no offline tmp-id heuristic (§2.2), surface
  arg threading (§2.1c), GemCard span corrected (§2.1e).
