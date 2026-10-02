# Realtime live-sync — implementation plan (Phase 2 completion)

_Revised after independent engineering review (verdict: implement-with-changes). Corrections from the review are marked ✎._

## Goal

When two members have a trip open, each sees the other's changes **live**, without a manual refresh. Data-layer co-editing already works. This plan wires the client so remote `postgres_changes` update local React state correctly — echo-safe and flicker-free.

## Current state (verified against code + live staging)

- `src/realtime.js` `subscribeTrip(tripId, handlers)` — one channel `trip:<id>`, `event:*`, `filter: trip_id=eq.<id>`, for `TRIP_SCOPED_TABLES = [days, trip_messages, activity_log, polls]`. No-op unless `VITE_REALTIME_ENABLED` (on in `.env`/staging).
- Subscription useEffect at **`App.jsx:6660`** (dep `[trip?.id]`, proper cleanup → no leak). Handlers 6663-6701:
  - `trip_messages` — ✅ DONE (echo-safe append, dedup by client `id`).
  - `days`, `activity_log`, `polls` — ⚠️ stubs.
- Editable itinerary = **`days` state from the `days` table** (`.from("days").select("*, activities(*)")`, `App.jsx:6786`). `ig_response` is only read for Magazine writeups (`App.jsx:2929`, `3567`) — ✎ **no itinerary surface renders from `ig_response`** (no showstopper).
- ✎ `activities` has **no `trip_id`** (keyed by `day_id`; has `added_by`). Confirmed on staging.
- ✎ **REPLICA IDENTITY is DEFAULT** → `payload.old` carries only the PK on UPDATE/DELETE. Design all merges to use **`payload.new` + local state only**.
- ✎ **No `updated_at`/`created_at`** on `days`, `activities`, `trip_todos/bookmarks/expenses`. `brainstorm_items` has **`last_modified_at` + `last_modified_by`** (not `updated_at`).
- Publication: `days, activities, trip_messages, polls, poll_votes, comments, trips, brainstorm_items`. ✎ NOT published: `trip_todos, trip_bookmarks, trip_expenses, trip_members`.
- Writes optimistic everywhere; only chat carries a client `id`. `activities.added_by` and `brainstorm_items.last_modified_by` are usable author keys.
- ✎ Route state: `pretripRoutes` is **already App-level** (`App.jsx:7089`), passed to the pre-trip BrainstormView as `externalRoutes` + `onItemsChange={setPretripRoutes}` (`App.jsx:10981`), merged back by id (`2340`). The **in-trip** BrainstormView (`App.jsx:12684`) is NOT given those props — it owns `items` internally.
- ✎ Verified live: RLS scopes realtime delivery to members correctly (member B receives A's `days` UPDATE); a no-op `days` UPDATE **does** emit an event (Option A works); `postgres_changes` does **not** replay on reconnect.

## Cross-cutting design decisions (revised)

**D1. Self-echo — author-based suppression (not timestamp LWW).** ✎ Since `updated_at` doesn't exist, do NOT build timestamp LWW. Instead:

- Chat: dedup by client `id` (done).
- Activities: ignore events where `new.added_by === session.user.id`.
- Routes: ignore where `new.last_modified_by === session.user.id`.
- Rows with no author column (`days.wishlist`, board rows pre-author): short-TTL **`_recentWrites` id set** the local writer populates; ignore an incoming event whose id is present. Fall back to payload-vs-local equality.
- True same-row concurrent edits remain **last-write-wins-lossy by arrival** (already declared acceptable for v1). We are NOT adding version columns.

**D2. Reconnect backfill.** ✎ Correct: `postgres_changes` doesn't replay. On channel status `SUBSCRIBED` (fires on initial connect and every reconnect), refetch days/activities/routes/members once (debounced) to reconcile.

**D3. Subscription lifecycle.** ✎ Do **not** gate on `members.length>1` alone (owner would miss the first joiner, and `trip_members` isn't published). Subscribe whenever `INVITE_ENABLED` and (`members>1` OR an active invite/link exists); simplest acceptable option is **no member-count gate at all** (one channel per open trip — negligible cost, per review). Add `trip_members` to the publication so the owner learns of a joiner live.

**D4. Realtime authorization.** ✎ Verified: `postgres_changes` delivery is RLS-filtered per the subscriber's JWT; members only receive their trips' rows. No extra channel-auth needed in supabase-js v2 for postgres_changes.

**D5. Flicker/perf.** Fine-grained patch by id; never blanket-refetch the whole itinerary. ✎ Route Option-A activity refetches through the existing `processDays` photo-dedup path (`App.jsx:6752`) so we don't duplicate photos or re-fire the photo queue.

## Per-surface plan

| Surface                              | Sub source                                                   | Merge                                                                                                                                                             | Echo suppression                          | Notes                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chat**                             | `trip_messages` ✅                                           | append INSERT                                                                                                                                                     | client `id` dedup ✅                      | add reconnect backfill                                                                                                                        |
| **Itinerary — days**                 | `days` (trip_id)                                             | ✎ **anti-clobber merge**: keep local `d.activities` (days payload has none), merge `wishlist` by item id (don't blanket-replace → preserves in-flight dismissals) | `_recentWrites` (no author on wishlist)   | stub → implement                                                                                                                              |
| **Itinerary — activities**           | via **Option A** (day-touch → refetch that day's activities) | replace that day's `activities` by day_id, through `processDays` dedup                                                                                            | `added_by === self`                       | delete path relies on the DB trigger (client delete doesn't day-touch)                                                                        |
| **Routes**                           | `brainstorm_items` (trip_id)                                 | patch item by id into `pretripRoutes`; handle `dismissed`                                                                                                         | `last_modified_by === self`               | add to `TRIP_SCOPED_TABLES`; ✎ pre-trip already wired; also pass `externalRoutes`/`onItemsChange` to the **in-trip** BrainstormView (`12684`) |
| **Members**                          | `trip_members` (trip_id)                                     | refetch `fetchMembers` (coarse)                                                                                                                                   | n/a                                       | ✎ add `trip_members` to publication + `TRIP_SCOPED_TABLES`                                                                                    |
| **Board (todos/bookmarks/expenses)** | each table (trip_id)                                         | patch by id in BoardView state                                                                                                                                    | `_recentWrites` (add author col optional) | Tier 2: publication add + subscribe inside BoardView                                                                                          |
| **Presence**                         | Realtime Presence API                                        | header count + typing                                                                                                                                             | n/a                                       | Tier 3, optional, degrade gracefully                                                                                                          |
| **Activity feed / polls**            | activity_log / polls                                         | —                                                                                                                                                                 | —                                         | Phases 3/6 not built — leave stubs                                                                                                            |

### Option A (activities), with review caveats

`AFTER INSERT/UPDATE/DELETE ON activities` trigger → `UPDATE days SET updated_at = now() WHERE id = coalesce(NEW.day_id, OLD.day_id)`. The `days` (trip_id) subscription fires → handler refetches that day's activities.

- ✎ Needs a touchable column: add **`days.updated_at`** (one column) — this is the ONLY `updated_at` we add (echo uses author cols, not timestamps).
- ✎ Self-echo/debounce: the editor also receives the day-touch echo → would refetch on every own edit. Debounce + suppress when the triggering change was self (`added_by`).
- ✎ Delete: client `removeActivity` (`App.jsx:7640`) does NOT day-touch → **the DB trigger is what makes live-delete work.** Keep the trigger's DELETE branch.
- No recursion risk (trigger touches `days`, not `activities`). Preferred over Option B (denormalize `trip_id` onto activities) for v1 — no backfill.

## Migrations (revised, minimal)

1. ✎ **`ALTER TABLE days ADD COLUMN updated_at timestamptz DEFAULT now()`** (only this table; for Option A's touch). No updated_at on activities/board/brainstorm.
2. **Option A trigger** on `activities` (INSERT/UPDATE/DELETE → touch parent `days.updated_at`).
3. **Publication adds** (guarded): `trip_members` (+ Tier 2: `trip_todos`, `trip_bookmarks`, `trip_expenses`). `brainstorm_items` already published.
4. (Tier 2, optional) author column on board tables for cleaner echo suppression.
   All additive; apply staging-first via `supabase db query --linked`.

## Files to change

- `src/realtime.js` — add `brainstorm_items`, `trip_members` to `TRIP_SCOPED_TABLES`; surface a `SUBSCRIBED`-status callback for backfill (D2).
- `src/App.jsx:6660` — implement `days` handler (anti-clobber merge + Option-A activities refetch via `processDays`), `brainstorm_items` handler (route patch, author-suppress), `trip_members` handler (refetch members), reconnect backfill, `_recentWrites` guard, revised D3 gating.
- `src/App.jsx:12684` — pass `externalRoutes={pretripRoutes}` + `onItemsChange={setPretripRoutes}` to the in-trip BrainstormView.
- `src/components/BoardView.jsx` (Tier 2) — subscribe within todo/bookmark/expense views, patch by id, echo-guard.
- Presence (Tier 3) — chat header.

## Testing

- **Node realtime smoke** (two authed clients, one trip): A writes day/activity/route → assert B receives + applies; assert A's own echo suppressed (no double-apply); assert DELETE removes by id; reconnect → backfill reconciles. ✎ Assert the `days` merge preserves local activities + wishlist.
- **Two-context Playwright** (owner+member, branch dev server): live chat, live itinerary edit (A edits activity → B sees it, no flicker/dupe photos), live route edit, live member-join; owner-only columns still blocked.
- Regression: solo trip byte-identical.

## Rollout

Behind `VITE_REALTIME_ENABLED` (on staging; off in prod until shipped). Staging-first: apply migrations via `db query --linked`, run Node + Playwright, flip prod flag when ready.

## Sequencing

**Tier 1** (this slice): chat (done) + itinerary (days anti-clobber + Option A) + routes + members-live + reconnect backfill + author-based echo. **Tier 2:** board. **Tier 3:** presence. Defer activity feed (Phase 3) / polls (Phase 6).

## Residual risks

- Same-row concurrent edit = LWW-lossy (accepted v1).
- Option A adds a refetch per activity edit (debounced) — fine at scale; revisit Option B if hot.
- `days.wishlist` / board rows lack authors → rely on `_recentWrites` TTL; add author columns in Tier 2 for robustness.
