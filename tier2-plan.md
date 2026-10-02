# Realtime Tier 2 — Board live-sync — Plan

Extends the live-sync layer (currently: itinerary/days, routes, chat, members, polls, prefs, activity feed) to the **Board** — to-dos, expenses, bookmarks (and a decision on notes). Builds on branch `collab-phase3` (top of the collab stack). Dark behind `VITE_REALTIME_ENABLED` + shared-trip gating; solo trips unchanged.

Part A = product/design (light — Tier 2 is mostly mechanics). Part B = technical (for independent eng review).

## Current state (audited)

- `trip_todos`, `trip_expenses`, `trip_bookmarks` all have **`trip_id`** (directly trip-filterable) and **no `updated_at`**. **None are in the `supabase_realtime` publication.** `trips` **is** published (for `board_notes`, a column on `trips` — but keyed by `id`, not `trip_id`).
- **RLS is already member-aware** on all three board tables (SELECT/INSERT/UPDATE/DELETE `USING trip_id IN (owner OR trip_members)`), so co-members already read/write each other's board rows — nothing to change for RLS. Co-editing the board already works; only _live_ propagation is missing.
- `TRIP_SCOPED_TABLES` (src/realtime.js) = days, trip_messages, activity_log, polls, brainstorm_items, trip_members, trip_preferences. Board tables absent.
- **BoardView owns board state locally.** Each sub-view (`TodoView`, `ExpensesView`, `BookmarksView`) fetches its list in a `useEffect` on mount (keyed on `trip.id`); the Board grid shows todo/bookmark **counts** fetched in `BoardView`. Sub-views are only mounted while open. `NotesView` holds a textarea with local state + autosave to `trips.board_notes`.
- **The stack sidesteps realtime's DELETE-filter limitation via parent-triggers.** Under `REPLICA IDENTITY DEFAULT`, a DELETE's `payload.old` carries only the PK — so a `trip_id=eq` filter can't match a DELETE, and filtered DELETE events aren't delivered. days/polls avoid this by having a child-write touch the parent's `updated_at` (an UPDATE that carries `trip_id`), then reconciling-from-DB. Board tables have no such parent.
- **activity_log is an incomplete signal.** Board mutations mostly log (add/remove todo/bookmark/expense, update_expense, set_budget) but **toggle-done (todo update) and bookmark-edit are NOT logged**, so piggybacking board sync on the activity_log stream would miss those.

---

# PART A — PRODUCT / DESIGN

**Goal:** when any co-traveller adds/edits/removes a to-do, expense, or bookmark, everyone viewing that Board widget sees it update within ~1s — no refresh. Matches how the itinerary/chat/polls already feel.

- **In scope:** to-dos (incl. done-toggle + reorder), expenses (incl. edit + budget), bookmarks (incl. edit). Board grid **count badges** update live too.
- **Notes:** a single shared textarea someone may be actively typing in — live-replacing it mid-edit clobbers keystrokes/cursor. See D-T2.1.
- **Feel:** silent reconcile (no toast/flash for board items — the activity feed already narrates _who_ changed what; Tier 2 just keeps the lists themselves current). No presence/typing (that's Tier 3).

### Product decisions

- **D-T2.1 — Board notes live-sync:** (a) **defer** — notes keep autosave + refetch-on-open, no live clobber [recommended, safest]; (b) a passive "notes updated by X — tap to refresh" nudge (no auto-replace); (c) live-replace the textarea (risks wiping in-progress typing). Concurrent rich-text merge is out of scope for v1.
- **D-T2.2 — Self-echo feel:** silent reconcile for your own changes too (you already see your optimistic update; the reconcile is a no-op) [recommended] — i.e., no author-suppression needed. Confirm you don't want any "synced" affordance.

---

# PART B — TECHNICAL (independent eng review)

## The crux: how to deliver board changes (incl. deletes) under trip_id filtering

Three candidate mechanisms — the reviewer's main job is to confirm the recommended one:

- **(A) Direct table subscription + `REPLICA IDENTITY FULL`** on the 3 board tables. Add them to the publication + `TRIP_SCOPED_TABLES`; `REPLICA IDENTITY FULL` makes a DELETE's `old` row carry `trip_id`, so `trip_id=eq` matches DELETEs and they're delivered. Client reconciles-from-DB on any event. **Recommended** — syncs _every_ mutation (toggle, reorder, edit, delete) regardless of activity_log coverage; board tables are small so FULL-identity WAL cost is negligible; most consistent with "these tables have trip_id, subscribe to them."
- **(B) Parent-trigger** — a trigger on each board table touching a per-trip bump the client can trip-filter. But there's no natural parent row (touching `trips.updated_at` collides with other trips logic + `trips` filters by `id` not `trip_id`). More machinery than (A).
- **(C) Reuse the activity_log stream** — bump a board refetch when an `activity_log` INSERT has a board `entity_type`. Zero migration, delete-safe (remove\_\* logs), but requires **filling the logging gaps** (toggle-done, bookmark-edit) and couples data-sync to feed-logging + adds feed noise.

**Recommendation: (A).** Open question for reviewer: does the existing stack's reconcile-from-DB actually receive filtered DELETEs today (i.e., do trip_messages/brainstorm_items rely on FULL identity, or do their deletes go through a parent/refetch)? Confirm whether `REPLICA IDENTITY FULL` is the right/only fix for delivered filtered-DELETEs, and whether it should also be applied to any existing table that currently misses peer deletes.

## 1. Migration `20260807000001_tier2_board_realtime.sql`

- Guarded `ALTER PUBLICATION supabase_realtime ADD TABLE trip_todos, trip_expenses, trip_bookmarks` (each wrapped so re-run is a no-op).
- `ALTER TABLE trip_todos REPLICA IDENTITY FULL;` (+ expenses, bookmarks) — so trip-filtered DELETE events deliver.
- No RLS changes (already member-aware). No new columns.

## 2. src/realtime.js

- Add `trip_todos`, `trip_expenses`, `trip_bookmarks` to `TRIP_SCOPED_TABLES` (they filter cleanly by `trip_id`).
- **Notes (`trips.board_notes`)** — only if D-T2.1 ≠ defer. `trips` filters by `id`, not `trip_id`, so `subscribeTrip`'s hardcoded `trip_id=eq` filter can't be reused; needs a dedicated `.on(..., { table:'trips', filter:'id=eq.'+tripId })` handler. If D-T2.1 = defer, skip entirely.

## 3. App ↔ BoardView integration (the real work)

BoardView sub-views own their lists and mount only when open, so App can't hold their state. Cleanest reconcile hook:

- App keeps a lightweight **`boardTick`** counter (or per-table `{todos,expenses,bookmarks}` revisions). The `subscribeTrip` handlers for the three board tables `debounce`-bump it (guard `membersRef.current.length > 1`, like every other handler; read the ref, don't close over `members`).
- Pass `boardTick` (or per-table rev) into `<BoardView>`, which forwards it to the active sub-view; each sub-view adds `boardTick` to its fetch `useEffect` deps → **refetch-from-DB** on change (reconcile, not patch — consistent with the stack; sidesteps payload-shape/echo issues). The Board-grid count fetches in BoardView also key on `boardTick`.
- **Self-echo:** your own change fires an event → your sub-view refetches → same data (harmless). No author-suppression needed. One care: don't refetch so aggressively it clobbers an in-progress add/edit form — debounce (~250ms) and refetch only the list, not open form state. (Reviewer: any risk a refetch mid-typing in the expense/todo add form resets inputs? The inputs are separate state from the list, so a list refetch shouldn't touch them — confirm.)

## 4. Money / cost

Free — no LLM, no new spend path.

## 5. Tests (staging-first)

- Node `scripts/tier2-board-test.mjs`: two members; A adds/edits/removes a todo + expense + bookmark; assert each fires the table's realtime channel to a subscribed client (INSERT/UPDATE/**DELETE** all delivered — the DELETE assertion is the REPLICA IDENTITY FULL check); toggle-done (UPDATE) delivers.
- Two-context Playwright `e2e/collab-board-sync.spec.ts`: A adds a to-do in the Board → B (Board→To-dos open) sees it appear live; A checks it off → B sees it toggle; A deletes → B sees it vanish.

## Cross-cutting

- Reconcile-from-DB (never patch-from-payload) — matches the stack.
- Guard all handlers on `membersRef.current.length > 1`; dark behind `VITE_REALTIME_ENABLED`; solo byte-identical.
- Branch `collab-tier2` stacked on `collab-phase3`. Migration-history repair before any `db:push:prod`.

## Open technical questions for the reviewer

1. **The crux above** — is `REPLICA IDENTITY FULL` the correct/standard fix for delivering trip*id-filtered DELETEs, and do any \_already-shipped* trip-scoped tables silently miss peer deletes today?
2. `boardTick` refetch vs granular per-row patch — is whole-list refetch acceptable at board sizes?
3. Any concern adding 3 tables to the publication re: realtime quota / fan-out?
4. Notes: is deferring (D-T2.1a) right?
5. Does a list refetch mid-edit disrupt an open add/edit form?

---

# PART C — REVIEW CORRECTIONS (independent eng review — verdict: implement-with-changes)

The crux is **confirmed**: all tables are `REPLICA IDENTITY DEFAULT` today (verified live), filtered DELETEs are dropped under DEFAULT, and `REPLICA IDENTITY FULL` on the 3 board tables is the correct/standard fix. Recommendation (A) direct-subscription is right — the board tables have no natural parent (B rejected), and the shipped tables avoid the gap via parent-triggers (days←activities, polls←poll_votes, both AFTER …DELETE) or are INSERT-only (activity_log, trip_messages). Corrections to fold in:

1. **Budget is a real gap (must fix).** `budget_amount` + `budget_currency` live on **`trips`** (filtered by `id`), not on `trip_expenses` — so the 3-table subscription silently misses a co-member changing the budget, even though Part A promised it. Decision **D-T2.3**: either (a) **scope budget OUT of Tier 2** [recommended — tight v1, budget changes are rare], or (b) sync it via the **same dedicated `trips` (`id=eq`) handler** that notes would need — bundle budget + notes into one small follow-up. Do NOT leave it promised-but-undelivered.
2. **`boardTick` must feed BOTH the sub-view fetches AND the Board-grid count/preview fetch.** Add it to the deps of: `TodoView` fetch (BoardView.jsx:189), `ExpensesView` fetch (:1311), `BookmarksView` fetch (:864), AND the grid count/preview effect (:2868, which fetches the todo top-5 preview + bookmarkCount, keyed `[trip?.id, activeSection]`). Note there is **no expense count** in the grid to update. A single scalar `boardTick` bumped by all three tables over-refetches slightly (harmless at tens of rows); per-table revisions are tidier but optional.
3. **Register the board debounce timers in the same `timers` object** cleaned up at App.jsx:6835, or they leak on unmount.
4. **Mid-edit safety CONFIRMED** — form inputs are separate `useState` from the lists in all three sub-views (TodoView `newText` vs `todos`; ExpensesView `addTitle`/`editingExpense`/`budgetInput` vs `expenses`; BookmarksView `title`/`url`/`editing` vs `bookmarks`), so a list refetch won't reset an open form. No change needed.
5. **Notes deferral (D-T2.1a) confirmed correct.** `trips` can't join `TRIP_SCOPED_TABLES` (hardcoded `trip_id=eq` filter at realtime.js:50); it needs a dedicated `.on(..., {table:'trips', filter:'id=eq.'+tripId})`. Same handler budget would use (see #1b).
6. **Migration pattern + version valid.** `20260807000001` is free; follow the guarded `DO $$ … IF NOT EXISTS(SELECT 1 FROM pg_publication_tables …) THEN ALTER PUBLICATION … ADD TABLE … END IF; END $$;` block from `20260805000001_prefs_realtime.sql`, one per table. `REPLICA IDENTITY FULL` statements are idempotent, no guard needed.
7. **RLS confirmed member-aware** on all three (SELECT/UPDATE/DELETE `trip_id IN (owner OR trip_members)`) — realtime enforces SELECT, so co-members WILL receive peer INSERT/UPDATE/DELETE. No RLS change.
8. **The DELETE-delivers Node test is the single most valuable test** — it directly proves FULL identity fixed the filter. Keep it front and center.

**Tracked follow-up (NOT a Tier 2 blocker):** App.jsx:8150 does a filtered bulk `days.delete().eq('trip_id', …)` on itinerary regen — a peer subscriber won't receive that DELETE under DEFAULT identity, but it self-heals because regen immediately re-INSERTs days (which deliver + trigger `reconcileDays`). Worth a note, not a fix here.
