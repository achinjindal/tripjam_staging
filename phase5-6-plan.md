# Phase 5 (Per-traveller preferences) + Phase 6 (Polls / group decisions) — Plan

Two parts: **Part A = Product/Design** (for your review) and **Part B = Technical** (for the independent eng review). Both build on the current collab stack (`realtime` branch). Everything ships **dark** behind `INVITE_ENABLED` and only activates on shared trips (`members > 1`).

## Current state (audited)

- **Phase 5:** `trip_preferences(trip_id,user_id,prefs_text,prefs_struct,updated_at)` + RLS (`members read` / `self writes`) already exist. NOT in the realtime publication. No data layer, no UI, and the chat prompt does **not** yet inject per-traveller prefs. `extract-preferences` is a _separate_ solo/pre-IG structured-extraction function — not reused here.
- **Phase 6:** `polls` + `poll_votes` tables + RLS + realtime publication exist. `comments` table exists but has **no RLS for vote-notes** (blocking). `create_poll` is a deliberate **dispatchActions no-op** (`App.jsx`) and is **not** in the chat action vocabulary. `poll_votes` has **no `trip_id`** → live tallies need a denormalized column (or on-demand fetch). No polls UI exists. `apply_poll` needs only `activity_log` (exists) — **not** Phase 3's feed UI.

---

# PART A — PRODUCT / DESIGN (your review)

## Phase 5 — "Your travel style"

**Goal:** each co-traveller tells Trippy what they like; Trippy plans for the _group_, naming whose preference is whose and proposing compromises (it already does tension-resolution in the group prompt — this feeds it the raw material).

**The sheet** (mockup: `collab-members-design.html` frame 4):

- Title "Your travel style" · sub "Trippy plans for everyone on the trip".
- **Free-text field** ("Beaches and great coffee. No 6am starts. Vegetarian.") — primary.
- **Quick tags** (optional, tap to toggle): 🏖 Beaches · 🥾 Hikes · 🍜 Food · 🎨 Culture · 😌 Relaxed · 🌙 Nightlife (final set TBD by you).
- **Save**; indicator elsewhere: "2 of 3 travellers shared their style."

**Entry points** (decision D-P1 below):

- Gentle nudge right after **accepting an invite** (skippable, not a hard gate).
- Always re-editable from **MembersSheet** ("✎ Your travel style").
- Trippy can ask in chat when prefs are sparse.

**How it changes Trippy:** on shared trips, the chat (and optionally IG) prompt gains a `PER-TRAVELER PREFERENCES` block — e.g. _"Achin: beaches, late starts, veg. Ravi: hiking, museums."_ Trippy then plans for everyone and attributes ("beaches for Achin, a museum morning for Ravi").

**States:** empty ("No styles shared yet — add yours"), saved, error/retry. Solo trips: allowed but inert.

### Product decisions for you (Phase 5)

- **D-P1 — Entry point aggressiveness:** (a) gentle post-join nudge + always-editable [recommended], (b) hard post-join step before entering the trip, (c) MembersSheet-only (no nudge).
- **D-P2 — Does IG use prefs too?** Feed prefs into **itinerary generation** for shared trips (higher value, more work), or **chat-only** for v1 [recommend chat-only first, IG as fast-follow].
- **D-P3 — Tag set:** confirm the six tags (or your list). Free-text is primary; tags are convenience.

## Phase 6 — Polls / group decisions

**Goal:** opt-in group decisions without blocking the unilateral-edit model. **v1 scope = day / activity / freeform polls** (route polls are Phase 7, deferred). Modes: **single** (radio, default) + **approval** (checkboxes). Ranking deferred.

**Poll card** (mockup: `collab-decisions-design.html`):

```
🗳  Day 4: Kyoto or Osaka?
    Suggested by 🐧 Trippy · closes 9pm
  ◉ Kyoto — temples & Arashiyama   ▓▓▓ 2
      🟢 Aisha "keep it relaxed"        ← vote-note
  ○ Osaka — food & Dotonbori       ░░░ 0
  You voted Kyoto · Change · + add a note
  Live · anyone can change until it closes   [Close poll]
```

- **Open, changeable, live tallies**; no blind voting.
- **Vote-note:** optional one-liner per voter, shown under your option, visible to all.
- **Close:** creator/owner taps Close, or auto at `closes_at`. On close: for **anchored** (day/activity) polls Trippy **applies the winner** (with vote-notes as context) and the card collapses to `✓ Day 4 → Kyoto`; **freeform** polls just record the result.

**Three surfaces:**

1. \*\*`
2. **Decisions hub** — Board → new **"Decisions"** tab (open polls + resolved history).
3. **Open-poll pin** — a slim cross-tab bar so open polls don't get buried.

**Invocation:**

- **Manual:** chat composer **＋ → Poll** → compose sheet (question + 2–4 options + mode). Free (no LLM).
- **Trippy-suggested:** Trippy proposes a poll when it detects disagreement (decision D-P4).

### Product decisions for you (Phase 6)

- **D-P4 — Trippy-suggested polls in v1?** (a) manual-only in v1, Trippy-suggested as fast-follow [recommended — simpler, safer], (b) include Trippy-suggested now (needs a disagreement-detection prompt + `create_poll` in the LLM vocabulary).
- **D-P5 — Live vote tallies?** (a) **live** via realtime [recommended — polls are the one place live tallies really matter] — costs a small `trip_id` denormalization on `poll_votes`/`comments`; (b) on-demand refresh (simpler, no migration, feels less alive).
- **D-P6 — Who can close a poll?** creator + owner [recommended], or any member.
- **D-P7 — Vote-notes in v1?** include [recommended] or defer.
- **D-P8 — Auto-apply on close:** for day/activity polls, Trippy auto-applies the winner on close [recommended] vs requires a member tap to apply.

---

# PART B — TECHNICAL (independent eng review)

## Phase 5 — technical

1. **Migration `20260805000001_prefs_realtime.sql`:** add `trip_preferences` to `supabase_realtime` (guarded), so prefs updates propagate live (reuses the realtime layer from PR #2). Table + RLS already exist — no other DDL.
2. **Data layer** `src/preferences.js`: `fetchPreferences(tripId)` (all members' rows), `savePreferences(tripId, prefs_text, prefs_struct)` (upsert own row via `.upsert({trip_id,user_id,...})`). No LLM — saving is a plain DB write.
3. **App state:** `preferences[]` + fetch effect keyed on `trip.id && isSharedTrip`; realtime handler in the existing `subscribeTrip` (add `trip_preferences` to `TRIP_SCOPED_TABLES`, reconcile-from-DB like days/routes).
4. **Chat prompt injection:** `App.jsx callUnifiedChat` sends `preferences: [{username, prefs_text, prefs_struct}]` in the request body (shared trips only). `chat/index.ts` builds a `PER-TRAVELER PREFERENCES` block in the **dynamicContext** (uncached, next to the existing GROUP TRIP block, ~line 239) — never in the cached prefix.
5. **(D-P2) IG injection (optional):** thread `preferences[]` into `generate-itinerary` request + inject into its system prompt for shared trips.
6. **UI:** `src/components/PreferencesSheet.jsx` (free-text + tag pills + count indicator + Save→`savePreferences`); mount from MembersSheet ("✎ Your travel style") + post-accept nudge in `JoinTrip`/App.
7. **Tests:** Node — save prefs as A + B, fetch returns both; chat request carries `preferences[]` and the reply attributes by style. Staging-first.

## Phase 6 — technical

1. **Migration `20260805000002_poll_votes_and_comments.sql`:**
   - **`comments` RLS** for vote-notes (`entity_type='poll'`): member SELECT (via the poll's trip), member INSERT (one per voter+poll — enforce with a partial unique index or app-level), self UPDATE. (Blocking — vote-notes can't be written today.)
   - **(D-P5) `poll_votes.trip_id` + `comments.trip_id` denormalized columns** (backfill from parent `polls`; set on insert via the RPC/action), so both can be `trip_id`-filtered in realtime → live tallies. If D-P5=on-demand, skip this and fetch tallies per poll.
   - Add `poll_votes` (+ `comments`) to `TRIP_SCOPED_TABLES` if denormalized.
2. **Chat action vocabulary + system prompt** (`chat/index.ts`, actions list ~144–215): add `create_poll` (and, if D-P4=Trippy-suggested, the disagreement-detection guidance). Shape: `{type:"create_poll", question, options:[{id,label}], mode, entity_type:"day|activity|freeform", entity_id}`.
3. **`dispatchActions` (App.jsx ~9815):**
   - Replace the `create_poll` no-op → insert a `polls` row (member RLS allows) + optimistic add to Decisions state.
   - New `apply_poll` handler → tally `poll_votes` for the winner, apply via the existing action for anchored polls (`update_day`/`update_activity`) with vote-notes as context, set `polls.status='resolved'` + `resolved_option_id`, and `logActivity({action:'apply_poll', ...})` (activity_log exists; Phase 3 will later render it — **not a blocker**).
4. **Vote + close data layer** `src/polls.js`: `createPoll`, `castVote`/`changeVote` (`poll_votes` upsert), `addVoteNote` (`comments` insert, entity_type='poll'), `closePoll` (owner/creator per D-P6), `resolvePoll` (compute winner + apply).
5. **Realtime handlers** (extend `subscribeTrip`): `polls` (already subscribed) → reconcile Decisions + pin; `poll_votes`/`comments` → live tallies (if D-P5 denormalized) or refetch the open poll.
6. **UI components:** `DecisionsHub.jsx` (Board→Decisions tab), `PollCard.jsx` (single/approval, live tally, vote-notes, close), `OpenPollPin.jsx` (cross-tab slim bar), ＋Poll compose sheet in the chat composer.
7. **Money:** polls are free (no LLM) except the optional Trippy-suggested detection (rides the existing chat call — already gated/pooled). No new spend path.
8. **Tests:** Node — create/vote/change-vote/close each mode; vote-note insert (comments RLS); resolve applies the winning day/activity + writes `apply_poll` activity_log; realtime delivery of poll + vote (two clients). Two-context Playwright — live tally updates + pin cross-tab. Staging-first.

## Cross-cutting technical notes

- **Reconcile-from-DB** for realtime (as in PR #2) — avoids payload-merge traps.
- **`poll_votes`/`comments` parent-scoping** is the key realtime decision (D-P5): denormalize `trip_id` for live, else on-demand.
- **Idempotency/echo:** reuse the members>1 gating + reconcile pattern; votes upsert by (poll,user[,option]).
- **Migrations** additive; apply staging-first via `supabase db query --linked` (staging is the linked project — verify before DDL).

## Suggested sequencing

Phase 5 first (small, rides existing chat work), then Phase 6 (larger). Within 6: migration → data layer + dispatchActions (create/vote/close/apply) → Decisions hub + PollCard → pin → compose → realtime tallies → (optional) Trippy-suggested.

## Open technical questions for the reviewer

- Is reconcile-from-DB fine for poll tallies, or is per-vote patching worth it here (tallies change often during a live vote)?
- `poll_votes.trip_id` denormalization: column + backfill + set-on-insert vs a SECURITY DEFINER RPC that stamps it — which is cleaner/safer?
- Enforcing "one vote-note per voter per poll" — partial unique index on `comments(entity_id,user_id) where entity_type='poll'` vs app-level upsert?
- `apply_poll` for day/activity: reuse `update_day`/`update_activity` dispatch paths exactly, or a dedicated apply that snapshots for undo?
- Poll close race (two closers / close-at-vs-manual) — any locking needed, or last-write-wins on `status`?

---

# PART C — REVIEW CORRECTIONS (independent eng review, folded in — verdict: implement-with-changes)

**Prerequisites (do before any Phase 5/6 build):**

- **Fix the migration version collision** `20260804000001` (`realtime_coedit.sql` on `realtime` vs `photo_query.sql` on `story-mode-cheap-wins`). Rename the realtime one to `20260804000002_realtime_coedit.sql` (objects already applied to staging — pure file/history rename, no re-apply). Phase 5/6 migrations then use `20260805000001+`.
- **Migration-history drift:** the `20260730*`/`0804` migrations were applied via `db query` (SQL editor), so `supabase_migrations.schema_migrations` doesn't record them → `db push` will choke. Before any `db:push`, `supabase migration repair --status applied <versions>` (staging + prod). Staging _objects_ for Phase 5/6 all exist (verified: `is_trip_member`, `trip_preferences`, `polls`, `comments`).

**Phase 5 corrections:**

- Chat injection point is `chat/index.ts:241/252` (dynamicContext) — confirmed correct. `callUnifiedChat` already sends `members[]` as `{id,name}` (App.jsx:9672) — send `preferences[]` alongside, align on `name` naming.
- `.upsert(trip_preferences, onConflict:'trip_id,user_id')` is correct vs the PK + `self writes` RLS.

**Phase 6 corrections (must-fix before build):**

1. **`apply_poll` is under-scoped.** `update_activity` does NOT exist; `update_day` (App.jsx:9366) needs a _full day object_ (delete-all + reinsert) — a poll winner is just an option id/label, so it can't be mechanically dispatched. Anchored (day/activity) apply must either (a) trigger a **Trippy day-regeneration** for the winning option, or (b) require poll options to **carry full day payloads** at creation. Build a **dedicated `apply_poll` handler** that computes the winner, obtains/generates the winning payload, writes an `undoPayload` snapshot via `logActivity`, then mutates. (For v1, freeform polls "just record"; consider deferring auto-apply of day/activity to keep scope sane — flag for D-P8.)
2. **Single-mode change-vote = DELETE-then-INSERT**, not upsert. `poll_votes` only unique key is the 3-col PK `(poll_id,user_id,option_id)` — upsert won't replace A→B. Approval mode = insert/delete individual option rows.
3. **`comments` already has RLS enabled** with one SELECT policy (`"Members can view comments"`) that does NOT cover `entity_type='poll'` and NO INSERT/UPDATE. Migration must **ADD** a poll-scoped SELECT (permissive, alongside the existing one — don't drop it) + INSERT + UPDATE, plus a **partial unique index** `comments(entity_id,user_id) WHERE entity_type='poll'` for one-note-per-voter.
4. **Tighten `poll_votes` insert RLS:** current `WITH CHECK (user_id=auth.uid())` allows non-members and votes on resolved polls. Add `AND EXISTS(SELECT 1 FROM polls p WHERE p.id=poll_id AND is_trip_member(p.trip_id,auth.uid()) AND p.status='open')`. Votes drive auto-apply → this is security-sensitive.
5. **Live tallies — prefer the parent-trigger pattern over `trip_id` denormalization.** `poll_votes`/`comments` are already in the publication. Add a `polls.updated_at` column + a trigger that touches it on `poll_votes` writes (mirrors the proven `activities→days.updated_at` pattern) → the already-subscribed `polls` channel fires → **reconcile-from-DB (debounced ~200ms) the affected poll's tally.** No new columns/backfill/subscription. (Denormalizing `trip_id` is the fallback; if used, stamp it in a SECURITY DEFINER `cast_vote` RPC, never client-supplied.)
6. **Idempotent resolution:** close/resolve via `UPDATE polls SET status='resolved', resolved_option_id=… WHERE id=? AND status='open'`; 0 rows affected = already resolved → skip apply. Handles two-closers / manual-vs-`closes_at` races with no locking.
7. **D-P6 close-permission is NOT RLS-enforceable** (`members update polls` lets any member update any column). Enforce creator/owner via a SECURITY DEFINER `close_poll` RPC, or accept it as client-side advisory (document).
8. **Edge cases to specify:** ties (single & approval) and 0-vote polls must NOT auto-mutate; approval-winner definition (most approvals); resolved-poll immutability (no re-vote/re-resolve); option-id stability (forbid editing `options` once votes exist); **`create_poll` must be guarded to shared trips only** (Trippy prompt + dispatch).
9. **`closes_at` executor:** no cron exists — use a client-side lazy check (on poll read + the closer's session), avoid new infra.

**Verified-correct (no change):** chat seams, `members[]` plumbing, `create_poll` no-op + absent vocab, `apply_poll`→`activity_log` has no Phase-3-UI dependency, `trip_preferences` realtime gap, `extract-preferences` non-collision.
