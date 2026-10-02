# Phase 3 — Activity feed + "while you were away" + undo — Plan

Two parts: **Part A = Product/Design** (for your review) and **Part B = Technical** (for the independent eng review). Builds on the current collab stack (branch `collab-phase5-6`, stacked on `realtime`). Everything ships **dark** behind `INVITE_ENABLED` and only activates on shared trips (`members > 1`). Solo trips keep logging (seeds the feed the moment a trip becomes shared) but show none of this chrome.

Phase 3 closes the v1 transparency loop: **unilateral edits + full attribution + undo**. It's the last core collab phase (4 = notifications and 7 = route polls are deferred).

## Current state (audited)

- **`activity_log`** (id, trip_id, user_id, action, entity_type, entity_id, created_at, **summary**, **undo_payload**) EXISTS on staging with **member-read + author-write RLS** and is **in the realtime publication**. `src/activity.js` (`logActivity`) already writes summary + undo_payload, fire-and-forget, on solo trips too.
- **`trip_read_state`** (trip_id, user_id, last_seen_at, PK) EXISTS on staging with **self read/write RLS**. Not in the realtime publication (correct — it's per-user, no broadcast). **May be MISSING on prod** (schema drift noted in docs) → guarded create needed before prod.
- **Summaries already written** at every mutation site (manual + chat): e.g. `Edited "Senso-ji"`, `Added to-do: Book JR Pass`, `Set budget to 3000`.
- **undo_payload already captured** for: `update_day` (prior activities), `update_activity` (prior activity), `remove_activity` (removed activity + dayId), and the BoardView manual todo/bookmark/expense mutations (row snapshot). **NOT captured** for the chat-driven `add_todo` / `add_expense` / `add_bookmark` / `set_budget` (they log a summary but no undo_payload).
- **Info rows** (member joined, credits topped up) are **NOT logged today** — no `activity_log` write on `accept_invite` or credit grant.
- **Realtime `activity_log` handler is a TODO stub** in App.jsx (currently just a DEV console.debug).
- Components already coined in the design: `ActivityFeed`, `WhileAwaySheet`.

---

# PART A — PRODUCT / DESIGN (your review)

## The three surfaces (from `collab-feed-credits-design.html`, Frames 0–2)

1. **🔔 Bell + unseen badge** in the trip header, shared-only, beside the avatar/presence stack. Design intent: _"bell = what changed, avatars = who's here — two questions, two icons."_ Badge = count of changes since your `last_seen_at` (excluding your own). Tapping opens the feed; badge clears.
2. **Activity feed** — a bottom sheet. Reverse-chronological, grouped by day ("Today" / "Yesterday"). Each row: actor avatar (Trippy = 🐧) · summary ("**Ravi** made Day 4 relaxed") · optional italic Trippy rationale ("_via Trippy: slower pace with an onsen afternoon_") · relative time · inline **Undo** (undoable rows only). Info rows (joins, top-ups) render muted with no undo. Empty state: _"No changes yet — start planning together."_ New rows prepend live.
3. **"While you were away"** — a bottom sheet auto-shown on trip open when there are unseen changes. Titled with a count + since-when ("3 changes since Tue"). Condensed rollup, max ~5 bullets + "+N more" (bullets may aggregate: "Aisha added 2 to-dos"). Two actions: **"Review in feed →"** and **"Got it"** — either stamps `last_seen_at = now()`. Never shown twice for the same changes; never for your own.

## Undo (the load-bearing part)

- **Any undoable row** can be undone, **including another member's change** (locked decision US-11). Undo applies the saved prior state, writes a new `action='undo'` feed row, and shows a "Reverted" toast.
- **Best-effort, conflict-warned (R5):** if the affected entity was changed again _after_ the change you're undoing, blind-applying the old snapshot would wipe the newer edit. On undo we detect that and **warn** ("this was built on since — undo may revert newer edits") rather than silently reverting. v1 promise: undo is _best-effort_, not unconditionally safe — and the UI says so.
- **Notify the original actor:** in v1 the notification IS the `action='undo'` feed row (its summary names them: "You undid Ravi's edit to Day 4" / on Ravi's side "Achin undid your edit to Day 4"), surfaced via his next feed/while-away. A dedicated push/email channel is Phase 4.

## Product decisions for you (Phase 3)

- **D-3.1 — Undo coverage in v1:** (a) edits + removes only (day/activity/todo/bookmark/expense — all already snapshot state) [safe, ships now]; (b) **also make the chat-driven _adds_ undoable** (add_todo/expense/bookmark = delete the added row; set_budget = restore prior) by enriching those log calls [recommended — small, makes the feed feel complete]; (c) everything incl. future action types.
- **D-3.2 — Cross-user undo:** allow it (docs lock YES) with the in-feed "X undid your change" notification [recommended], or restrict undo to your own changes in v1.
- **D-3.3 — Conflict handling on undo:** (a) best-effort + **warn** if the entity changed since [recommended]; (b) blind-apply (simplest, unsafe); (c) block undo entirely if it changed since.
- **D-3.4 — Entry point:** 🔔 bell + bottom-sheet feed (matches the mockup) [recommended], vs a Board → "Activity" tab.
- **D-3.5 — "While you were away":** auto-open the sheet on trip open when unseen > 0 [recommended, skippable], vs badge-only (no auto sheet).
- **D-3.6 — Info rows (joins / credit top-ups):** log + show them as muted feed rows [recommended — cheap, adds life], or defer (changes-only feed in v1).
- **D-3.7 — Post-undo original row:** annotate the original row as "· undone" (struck/muted) in addition to appending the undo row [recommended], or leave it and rely on the new undo row only.

---

# PART B — TECHNICAL (independent eng review)

Guiding constraint: **reuse everything that exists** (logger, RLS, realtime publication, undo_payload snapshots) and keep the diff additive + dark.

## 1. Migration `20260806000001_phase3_read_state.sql` (defensive)

- `CREATE TABLE IF NOT EXISTS trip_read_state (trip_id uuid, user_id uuid, last_seen_at timestamptz default now(), PRIMARY KEY (trip_id,user_id))` + `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + guarded self read/write policy + service-role policy. **Idempotent** — no-op on staging (already present), creates it on prod (closes the drift). No other DDL: `activity_log` + its RLS + realtime publication already exist. `trip_read_state` deliberately **not** added to the realtime publication (per-user; the owner of the row is the only reader).
- (If any Phase-3 undo needs it, nothing here — undo reuses existing tables.)

## 2. Data layer `src/feed.js`

- `fetchActivity(tripId, { limit = 60 } = {})` → `activity_log` rows for the trip (member-read RLS), newest first. Actor display names resolved **client-side** from the `members` list (profiles RLS hides other users), same pattern as polls/prefs.
- `fetchReadState(tripId, userId)` → `last_seen_at` (or null).
- `markSeen(tripId, userId)` → upsert `{trip_id,user_id,last_seen_at:now()}` onConflict `trip_id,user_id`.
- `unseenCount(rows, lastSeenAt, selfId)` → pure helper: rows with `created_at > lastSeenAt && user_id !== selfId`.
- `undoActivity(row, { deps })` → the undo engine (see §4).

## 3. App state + realtime

- State: `activity[]`, `lastSeenAt`, `showFeed`, `showWhileAway`. Fetch on `trip.id && isSharedTrip` (like polls/prefs).
- Realtime: replace the `activity_log` handler stub → on INSERT, prepend the row to `activity[]` (dedup by id; author-suppress is unnecessary — seeing your own change appear is fine, it just won't count as unseen). Reconcile-from-DB on backfill (SUBSCRIBED), gated `members > 1`, debounced.
- **Unseen badge** = `unseenCount(activity, lastSeenAt, selfId)`, recomputed from state (no extra query).
- **While-away trigger**: a one-shot effect on `isSharedTrip && trip.id` — fetch read-state + activity, if unseen > 0 set `showWhileAway`. Guard so it fires once per trip-open (not on every realtime tick).

## 4. Undo engine (`undoActivity`)

Invert by `action` using the existing `undo_payload`:

- `update_day` → restore `undo_payload.activities` for `dayId` (reuse the existing day-write path: delete that day's activities + reinsert the snapshot; it already exists for `update_day` dispatch).
- `update_activity` → restore `undo_payload.activity` (update by id).
- `remove_activity` → re-insert `undo_payload.activity` into `dayId`.
- `add_todo | add_expense | add_bookmark` (D-3.1b) → delete the added row by id (**requires enriching the chat-add log calls to capture the inserted id** — currently missing).
- `set_budget` (D-3.1b) → restore prior budget (**requires capturing prior budget in the log call** — currently missing).
- Manual BoardView todo/bookmark/expense → invert per their action verb (add→delete, remove→reinsert, update→restore) using the existing snapshot.

After a successful apply: `logActivity({action:'undo', entityType, entityId, summary: "<me> undid <actor>'s <change>", undoPayload: null})` so the undo is itself a feed event (and the actor's notification). Show "Reverted" toast + optimistic feed refresh.

**Conflict check (R5, best-effort, no schema change):** before applying, check whether any `activity_log` row for the **same `entity_id`** has `created_at > row.created_at` (i.e. the entity was touched after this change). If so → show a warning sheet ("This was built on since — undoing may revert newer edits. Undo anyway?") and only apply on confirm. If not → apply directly. (Open Q for reviewer: is same-`entity_id`-later-row a sufficient divergence signal, or should we also fingerprint the entity's own `updated_at` in undo_payload going forward?)

## 5. UI components

- `src/components/ActivityFeed.jsx` — bottom sheet: grouped-by-day rows (avatar, summary, Trippy rationale, relative time, inline Undo on undoable rows, muted info rows), empty state, live prepend. Opening it calls `markSeen` (clears the badge).
- `src/components/WhileAwaySheet.jsx` — condensed rollup (max ~5 bullets + "+N more"), "Review in feed →" (opens feed) / "Got it"; either calls `markSeen`.
- **Bell + badge** in the trip header (shared-only), beside the avatar stack — opens `ActivityFeed`.
- Both sheets reuse the existing bottom-sheet shell + `theme.js` tokens; both gated `INVITE_ENABLED && isSharedTrip`.

## 6. Enrichment of existing log calls (for D-3.1b)

- Chat `add_todo`/`add_expense`/`add_bookmark`: after the insert returns the new row, include its id in `undoPayload` (`{ id }`) so undo can delete it. Small, localized edits in `dispatchActions`.
- Chat/manual `set_budget`: capture prior `trips.budget` (or the relevant column) into `undoPayload` before the write.
- **(D-3.6) Info rows:** log `action:'member_join'` on invite-accept (client-side after `accept_invite` resolves, or leave to the RPC — reviewer's call) and `action:'credits_topup'` on a successful grant (in the recharge success path). Both summary-only, non-undoable.

## 7. Money / cost

Phase 3 is **free** — no LLM. Undo of a Trippy-made change just restores a snapshot (no regeneration). No new spend path.

## 8. Tests (staging-first, mirroring Phase 5/6)

- Node `scripts/phase3-feed-test.mjs`: two accounts; A edits → row appears in B's `fetchActivity` with correct actor + summary; unseen count excludes B's own + counts A's; `markSeen` zeroes it; **undo** restores the entity + appends an `action='undo'` row; **cross-user undo** works; **conflict path** — A edits, B edits same entity, A undoes → divergence detected; realtime delivery of an `activity_log` INSERT to a subscribed client.
- Two-context Playwright `e2e/collab-feed.spec.ts`: A makes a change → B sees the bell badge increment + the row in the feed live → B taps Undo → row reverts + "undo" row appears. (Deterministic — no LLM; use a manual board/day edit.)

## Cross-cutting

- **Reconcile-from-DB** for realtime (as in the rest of the stack).
- **Migration-history repair** before any `db:push:prod` (collab migs were applied via `db query`, not recorded in `schema_migrations`).
- Branch: `collab-phase3` stacked on `collab-phase5-6` (App.jsx realtime-handler + header edits would otherwise conflict).

## Open technical questions for the reviewer

1. Conflict signal: is "a later `activity_log` row exists for the same `entity_id`" enough, or fingerprint entity `updated_at` in `undo_payload`?
2. Undo of chat-driven **adds** — enrich the log to capture the inserted id (proposed), or make adds non-undoable in v1?
3. `member_join` / `credits_topup` logging — client-side after the RPC, or inside the SECURITY DEFINER RPCs (more reliable, but touches deployed functions)?
4. While-away one-shot guard — per session (component mount) or persisted?
5. Any concern with opening the feed = `markSeen` immediately? Alternative: mark seen on close.

---

# LOCKED PRODUCT DECISIONS (user, 2026-08-05)

- **D-3.1 = (b)** Edits **+ adds** undoable. Enrich the add/update log calls to capture what undo needs.
- **D-3.2 = recommended** Cross-user undo allowed, with the in-feed "X undid your change" notification.
- **D-3.3 = (a)** Undo is best-effort + **warn** when the entity changed since.
- **D-3.4 = (a)** 🔔 bell + badge in the header → activity feed bottom sheet.
- **D-3.5 = recommended** "While you were away" auto-opens on trip open when unseen > 0 (skippable).
- **D-3.6 = (a)** Log + show member-join and credit-topup as muted info rows.
- **D-3.7 = recommended** Annotate the original row as "· undone" in addition to the appended undo row.

---

# PART C — REVIEW CORRECTIONS (independent eng review, folded in — verdict: implement-with-changes)

Scaffolding (schema / realtime / feed / while-away / bell) is sound as designed. Rework these before/while implementing:

1. **§4 undo table is wrong that "manual adds already snapshot state."** Reality (verified): only the **removes** and edits carry `undo_payload` today — `update_day`/`update_activity`/`remove_activity` (App.jsx) and `remove_todo`/`remove_bookmark`/`remove_expense` (BoardView 281/923/1390). The **adds/updates do not**: manual `add_todo` (BoardView 306, has entityId, no payload), manual `add_expense` (1360, no payload), manual **bookmark add logs NOTHING at all** (BoardView ~906 — add a `logActivity` with `entityId: data.id`), and `update_expense` (1334, no prior-state). So D-3.1b enrichment spans: chat adds + manual todo-add + manual expense-add + manual bookmark-add (missing) + `update_expense` + `set_budget` (manual & chat).
2. **Two `add_todo` shapes.** Chat `add_todo` (App.jsx:9633) logs **no entityId** and its insert (App.jsx:9623) doesn't `.select()` — add `.select().single()` to capture the inserted id. Manual `add_todo` (BoardView:306) has entityId but no payload. The undo engine must not assume `entityId` is present per-verb.
3. **§4 `update_day` undo is the apply_poll trap again.** The day-write is **inline in the `dispatchActions` switch** (App.jsx:9468–9594), not callable, AND there's a **shape mismatch**: the write path consumes LLM-shaped activities (`geocode`, `geocodeEnd`, `transition`) while `undo_payload.activities` stores **DB-row shape** (`geocode_end`, `transition_data`, `id`, `photo_url`, `position`, `added_by`). Feeding the payload through the inline path drops `geocode_end`/`transition_data`. → Build a **standalone `restoreDayActivities(dayId, dbRows)`** helper that inserts DB-shaped rows directly (delete-by-`day_id` + reinsert preserving `position`, reusing the RLS-safety check at 9480–9496); call it from both `update_day`'s undo and the engine.
4. **§4/R5 conflict signal is unsound for null `entity_id`.** Chat adds (App.jsx:9633/9658/9681) log **no entity_id** → null-vs-null false-matches; the **`action:'undo'` row itself** is a later same-entity row (self-triggers); `set_budget`/`update_day` share one entity_id (tripId/dayId) → unrelated later edits trip the warning. → Scope the divergence query to `entity_id = row.entity_id AND entity_id IS NOT NULL AND action <> 'undo' AND created_at > row.created_at`; treat **null-entity add undos as non-conflicting by definition** (undo = delete the specific inserted id, nothing to diverge from). Long-term: fingerprint the entity's `updated_at` in `undo_payload` going forward.
5. **Realtime `activity_log` handler (App.jsx:6800) must add the `membersRef.current.length > 1` guard** every other handler has; read `membersRef`, never close over `members`/`isSharedTrip` (effect deps are `[trip?.id]`; those would be stale). Only INSERT is consumed (NEW always complete; no REPLICA IDENTITY dependence).
6. **§1 migration is redundant but the version (`20260806000001`) is free.** `trip_read_state` table + RLS + service-role policy already exist idempotently in migs `...0002/...0003`; it is correctly **not** in the realtime publication. If kept as a defensive re-create, mirror the **existing** policy names (`"self read_state"`, `"Service role full access"`) with `DROP … IF EXISTS`.
7. **§6 logging placement:** `credits_topup` has **no reliable client** (grants happen in `payment-webhook`/`revenuecat-webhook`/`revenuecat-verify`, often with no browser open) → log it **inside those edge functions** (service-role bypasses RLS), keyed on the existing `provider_session_id` idempotency. `member_join` → log **inside `accept_invite`** (SECURITY DEFINER, atomic, actor = `auth.uid()`, satisfies the author-writes RLS). Both touch deployed functions → redeploy + the migration-history repair already flagged.
8. **Watch-outs:** solo→shared mid-session doesn't re-run the subscribe effect (channel already up; handler starts counting once `membersRef` flips — fine); guard the while-away one-shot on **trip-open**, not on `isSharedTrip` flipping true; the "Reverted" toast must **not** depend on the `action:'undo'` log write succeeding (fire-and-forget); solo byte-identical holds (all new UI gated `INVITE_ENABLED && isSharedTrip`, handler self-gates).
