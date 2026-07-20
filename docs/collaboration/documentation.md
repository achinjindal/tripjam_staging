# Collaborative Trip Planning — Functional & Technical Documentation

Companion to [`../collaboration-plan.md`](../collaboration-plan.md) (strategy) and [`design.md`](design.md) (UI). This document is the engineering-facing spec: user stories, data model, RLS, credits, notifications, and acceptance criteria.

## Locked decisions

- **Edit model:** unilateral + transparent + undo. No per-edit gates. Opt-in polls for group decisions.
- **Centerpiece:** shared Trippy chat — the group plans _through_ one AI conversation.
- **Roles (v1):** everyone is an equal editor.
- **Credits:** **personal wallet + opt-in trip pool** (see §5). Hardened via `/stress-test`.
- **Notifications:** in-app "what changed while you were away" on every return with unseen changes; **one email digest per day at 9am** (per trip, only when something changed). Push deferred.

## Modes: solo vs shared (architectural principle)

**Collaboration UI is progressive — it activates only when a trip has ≥2 members.**

- A **solo trip** (1 member) is the app exactly as it is today: no members button, no audience `To:` selector (it's just you + Trippy), no attribution/"who" in changes, no pooled-credit fork (personal wallet auto-pays), no presence, no poll UI chrome. Zero collaboration overhead.
- A trip enters **shared mode** the moment a second member joins. Every surface below marked _shared-only_ appears then and only then.

This keeps the majority (solo) case simple and makes the whole feature opt-in by nature. Treat `member_count >= 2` as the gate throughout.

---

## 1. User stories

### Membership

- **US-1** As a trip owner, I can invite co-travelers by sharing a join link, so we can plan together.
- **US-2** As an invited user, I can open a join link and become a member (signing in first if needed).
- **US-3** As a member, I can see everyone on the trip (avatar + name).
- **US-4** As an owner, I can remove a member or revoke an invite link.
- **US-5** As a member, I can leave a trip.

### Shared Trippy chat

- **US-6** As a member, I chat with Trippy in a shared conversation everyone sees, with each message attributed to its author.
- **US-6b** As a member, I can direct each message to **Trippy**, to **all co-travelers**, or to a **specific co-traveler**, and I can see who the message is going to before I send it. Every message is visible to everyone regardless of who it's directed to — directing controls _who it's addressed to and whether Trippy acts on it_, not who can see it.
- **US-7** As a member, I see co-travelers' messages and Trippy's streamed replies appear live, without refreshing.
- **US-8** As a member, I record my personal preferences (e.g. "I want beaches, hate early mornings") so Trippy plans for the whole group.
- **US-9** As a member, when Trippy changes the plan, its explanation is preserved as context others can read later.

### Transparency & undo

- **US-10** As a member, I see a feed of every change — who did what, when, and why.
- **US-11** As a member, I can undo any change in the feed, even one another member made (the original actor is notified).
- **US-12** As a member returning to a trip, I see a summary of everything that changed while I was away.

### Group decisions (polls)

- **US-13** As a member, I can open a poll manually (free, no AI), or Trippy can suggest one when it detects a disagreement — from anywhere the decision lives (chat, a day/activity, or the routes).
- **US-14** As a member, I can vote (single-choice or approval), **see live tallies, and change my vote until the poll closes** — group planning is consensus-building, not a blind ballot.
- **US-15** As a member, I can attach an optional **note to my vote** ("Kyoto — but keep a Nara day trip"), visible to everyone.
- **US-16** As a member, I find every poll (open + resolved) in one place, so an in-chat poll never gets buried.
- **US-17** When a poll closes, Trippy can apply the winning option as a normal plan change, **taking the vote-notes into account**.

### Credits (personal wallet + opt-in trip pool)

- **US-18** As a member, I see the trip's shared credit balance and who has contributed.
- **US-19** As any member, I can recharge the shared pool (purchase or coupon); the credits are usable by everyone on the trip.
- **US-20** As a member, when the pool runs out, I'm prompted to either add credits to the trip or spend my personal credits for this action — my personal balance is never spent silently.

### Notifications

- **US-21** As a member, I receive at most one daily email (9am) summarizing what changed across a trip, only when there were changes.
- **US-22** As a member, I can mute a trip's email digest.

---

## 2. Data model

### Reuse (present in the DB, but UNTRACKED in migrations — reconcile first)

> ⚠️ **Verified 2026-07-20:** these tables exist in live prod + staging but are **not in `supabase/migrations/`** (schema drift). `trip_preferences`/`trip_read_state`/`notification_prefs`/`polls` exist in **staging but not prod**. "Reuse" means *capture the live shape into migrations* (`CREATE TABLE IF NOT EXISTS`) and reconcile prod↔staging — **not** write fresh `CREATE TABLE` from this spec (it will diverge). Columns confirmed present: `invite_links` fully (`token, expires_at, role, created_by`), `trip_members(role, joined_at)`, `credit_transactions.trip_id`. Columns confirmed **missing** (to add): `activity_log.{summary, undo_payload}`, `trip_messages.{audience, directed_user_id}`, `trips.credit_balance`, `brainstorm_items.{last_modified_by, last_modified_at}`. See [`implementation-plan.md` → Schema ground truth](implementation-plan.md).

- `trip_members(id, trip_id, user_id, role='edit', joined_at)` — membership. Keep self-insert-only INSERT; add co-member SELECT.
- `invite_links(id, trip_id, created_by, role, token, expires_at, created_at)` — activate.
- `activity_log(id, trip_id, user_id, action, entity_type, entity_id, created_at)` — activate; **add `summary text` and `undo_payload jsonb`** columns (see §4).
- `trip_messages(id, trip_id, user_id, role, content, created_at)` — already multi-user-capable; add co-member RLS + realtime, plus `audience` + `directed_user_id` for message addressing (§6).
- `comments(entity_type, entity_id, user_id, content, created_at)` — activate for **vote-notes** (`entity_type='poll'`); add member RLS. Freeform discussion stays in chat, not here.
- `brainstorm_items` (routes) — **add `last_modified_by uuid` + `last_modified_at timestamptz`** for route edit attribution (§4). Full edit history already lives in `activity_log`.

### New tables

```sql
-- Pooled credit balance lives on the trip (see §5)
ALTER TABLE trips ADD COLUMN credit_balance numeric NOT NULL DEFAULT 0;
-- credit_transactions gains a trip scope (grants/spend now attributable to a pool)
ALTER TABLE credit_transactions ADD COLUMN trip_id uuid REFERENCES trips(id) ON DELETE SET NULL;

-- Per-traveler preferences fed to Trippy
CREATE TABLE trip_preferences (
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  prefs_text text,          -- free-form ("beaches, no early starts")
  prefs_struct jsonb,       -- optional structured (pace/budget/interests)
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);

-- Read-tracking for "what changed while you were away"
CREATE TABLE trip_read_state (
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  last_seen_at timestamptz DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);

-- Daily email digest bookkeeping (enforces max 1/day)
CREATE TABLE notification_prefs (
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  email_digest boolean NOT NULL DEFAULT true,
  last_digest_sent_at timestamptz,
  PRIMARY KEY (trip_id, user_id)
);

-- Polls (opt-in group decisions)
CREATE TABLE polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  created_by uuid REFERENCES profiles(id),   -- NULL / a system id when Trippy-created
  question text NOT NULL,
  options jsonb NOT NULL,          -- [{id, label}]; for route polls, id = brainstorm route id
  mode text NOT NULL DEFAULT 'single',   -- single | approval | ranking (ranking deferred)
  entity_type text,                -- route | day | activity | freeform (anchor)
  entity_id uuid,                  -- the anchored entity, when applicable
  status text NOT NULL DEFAULT 'open',   -- open | resolved | cancelled
  resolved_option_id text,
  closes_at timestamptz,           -- optional deadline; else closed explicitly by creator/owner
  created_at timestamptz DEFAULT now()
);
-- One row per (voter, chosen option). Single-choice enforces one row/voter at the
-- app layer; approval allows several; ranking uses `rank`.
CREATE TABLE poll_votes (
  poll_id uuid REFERENCES polls(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  option_id text NOT NULL,
  rank int,                        -- ranking mode only
  PRIMARY KEY (poll_id, user_id, option_id)
);
-- Vote notes reuse the dormant `comments` table, anchored to the poll:
--   comments(entity_type='poll', entity_id=poll_id, user_id, content) — one editable
--   row per voter. First real use of that table (see §Polls).
```

> Push (`device_tokens`) is intentionally omitted — deferred with the push channel.

---

## 3. Membership & invites

### Invite creation

- Owner generates an `invite_links` row (`token`, optional `expires_at`, `role='edit'`). Reusable until revoked/expired.
- Shareable URL: `/{origin}/join/{token}` (native share sheet, mirrors the public-share pattern).

### Join / acceptance

- Route `/join/:token` parsed in `main.jsx` `parseUrl()` (new page `join`), rendered pre- or post-auth. Unauthenticated → Auth, then continue to accept.
- Acceptance uses a `SECURITY DEFINER` RPC — never loosen `trip_members` INSERT to arbitrary rows:

```sql
CREATE FUNCTION accept_invite(p_token text) RETURNS uuid  -- returns trip_id
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_trip uuid; v_role text; v_count int;
BEGIN
  SELECT trip_id, role INTO v_trip, v_role FROM invite_links
   WHERE token = p_token AND (expires_at IS NULL OR expires_at > now());
  IF v_trip IS NULL THEN RAISE EXCEPTION 'invalid_or_expired'; END IF;
  -- max-members cap = 8 (decided): guard before insert
  SELECT count(*) INTO v_count FROM trip_members WHERE trip_id = v_trip;
  IF v_count >= 8 THEN RAISE EXCEPTION 'trip_full'; END IF;
  INSERT INTO trip_members(trip_id, user_id, role)
    VALUES (v_trip, auth.uid(), v_role)
    ON CONFLICT (trip_id, user_id) DO NOTHING;
  RETURN v_trip;
END $$;
```

### RLS changes

- **Co-member visibility** (needed for avatars/attribution). ⚠️ **Do NOT write the policy as a self-referential subquery** — a `SELECT` policy *on* `trip_members` that subqueries `trip_members` recurses / returns empty (classic Supabase footgun) and fires per-row on every realtime broadcast. Use a `SECURITY DEFINER` helper that bypasses RLS for the membership check, and reference it from **every** co-member policy across all collab tables:
  ```sql
  CREATE FUNCTION is_trip_member(p_trip uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
      SELECT EXISTS (SELECT 1 FROM trip_members WHERE trip_id = p_trip AND user_id = p_uid);
    $$;
  CREATE POLICY "members read co-members" ON trip_members FOR SELECT TO authenticated
    USING (is_trip_member(trip_id, auth.uid()));
  ```
- **Itinerary editing already works** for `'edit'` members on `days`/`activities` — no change for the core edit flow.
- **Trip-level metadata (name/dates/`share_token`) stays owner-only** in v1.
- `trip_preferences`, `trip_read_state`, `notification_prefs`, `polls`, `poll_votes`: member-scoped read; self-scoped write.

### Membership lifecycle (decided 2026-07-21)

**Ownership model.** Ownership is a single, **transferable** attribute — add **`trips.owner_id uuid`** (backfilled from `created_by`; `created_by` stays immutable as historical record). All owner-only checks (remove member, revoke link, edit trip metadata) key off `owner_id`, **not** `created_by` — so ownership can move. (This is a Phase-1 migration: add the column, backfill, repoint the owner-only RLS policies.)

**Owner leaving → forced transfer first.** An owner *can* leave, but must **transfer ownership** to another member first. The Leave flow for an owner opens a "Choose the new owner" picker (list of co-members); on confirm, `owner_id` moves, then the ex-owner is removed as a normal member. If the owner is the **only** member, Leave = delete the trip (below).

**Last member leaves → trip deleted.** When the final member leaves, the trip and its dependent rows are deleted (cascade). No orphaned/ownerless trips exist.

**Member removed or leaves → cleanup rules:**
- **Poll votes: deleted.** `DELETE FROM poll_votes WHERE user_id = X` for this trip's polls, **plus their poll vote-notes** (`comments WHERE entity_type='poll' AND user_id = X` anchored to this trip's polls). Tallies simply update; **no poll is auto-resolved or auto-closed** — the poll stays open and remaining members vote on as normal ("read-only until someone takes action" — we never recompute an outcome on a departure).
- **Polls they created: kept.** The `polls.created_by` FK points at `profiles(id)`, which still exists (leaving a trip ≠ deleting the account), so the poll persists intact with attribution.
- **Everything else stays.** Their chat messages, `activity_log` entries, itinerary edits, and any **pooled credits they funded remain with the trip** (credits are non-refundable on leave — already specced in §5). Attribution is preserved. No other cascade is triggered.
- **Access is revoked instantly** — deleting their `trip_members` row makes `is_trip_member()` false, so RLS denies all further reads/writes immediately.

**Mechanism — three `SECURITY DEFINER` RPCs** (so cleanup is atomic and RLS-safe):
- `transfer_ownership(p_trip uuid, p_new_owner uuid)` — owner-only; sets `owner_id` (new owner must be a current member).
- `remove_member(p_trip uuid, p_user uuid)` — owner-only; deletes the target's `trip_members` row + their poll votes/vote-notes for the trip.
- `leave_trip(p_trip uuid)` — caller removes self: if caller is owner **and** other members exist → raise `transfer_ownership_first` (UI shows the picker); if caller is owner **and** sole member → delete the trip; else → same cleanup as `remove_member` on self.

---

## 4. Transparency, activity feed & undo

### Change logging

Every mutating action writes an `activity_log` row: `{action, entity_type, entity_id, summary, undo_payload}`.

- `action` — e.g. `update_day`, `add_todo`, `remove_activity`, `set_budget`, `apply_poll`.
- `summary` — human-readable. **For chat-driven changes, store Trippy's own sentence** ("Replaced Day 3 lunch with Trishna in Colaba…"). For manual edits, generate a terse summary client-side ("Edited Day 2 · 'Lunch' → 'Sushi Zanmai'").
- `undo_payload` — the prior state needed to reverse the change (e.g. the day/activity snapshot before edit).

### Feed

- Reverse-chron list per trip; each row: actor avatar, summary, relative time, inline **Undo**.
- Undo applies `undo_payload`, writes a new `activity_log` row (`action='undo'`), and notifies the original actor in-app.
- ⚠️ **Conflict check (not blind-revert):** if the entity was edited *again* after the change being undone, applying the old snapshot silently wipes the newer edit. On undo, verify the current entity still matches the post-change state; if it diverged, warn *"this was built on since — undo may revert newer edits"* rather than blind-applying. (v1 minimum: ship as best-effort but say so — don't present undo as unconditionally safe.)

### "What changed while you were away"

- On trip open, compare `activity_log.created_at` against the user's `trip_read_state.last_seen_at`.
- If unseen rows exist, show the summary sheet (see design §"Since you were away"). Dismiss/opening updates `last_seen_at`.

### Route edits are attributed too (shared-only)

- Routes are editable (via Trippy's `update_route`). Like everything else, each edit writes an `activity_log` row and stamps `brainstorm_items.last_modified_by`/`last_modified_at`.
- **On the route card, surface attribution only once a route is human-edited** — a subtle secondary line `✏️ Edited by <name> · <when>` (untouched AI-generated routes stay clean). Tapping opens that route's slice of the feed.
- **Vote-integrity rule:** if a route is edited _while a poll on it is open_, flag the poll (`⚠️ P2 changed after voting started`) and nudge voters on that option to reconsider. Because votes are openly changeable (see §Polls), this is a nudge, not a correctness bug — but it must be visible, which is what attribution buys.

---

## 5. Credits — personal wallet + opt-in trip pool

> Hardened via `/stress-test` (2026-07). The earlier "pure pool" model was rejected: it had a griefing hole, a tragedy-of-the-commons incentive, and a spine-rewrite migration. This model keeps the group-friction win while protecting the payer and staying migration-safe.

### Model

Two balances:

- **Personal wallet** (`profiles.credits`) — unchanged from today. The 100 free signup credits land here. Never spent on a shared trip without the owner's explicit opt-in.
- **Trip pool** (`trips.credit_balance`, default 0) — an _optional_ shared balance any member can fund for a specific trip.

**Spending waterfall** when member M performs a gated AI action on trip T:

1. **Trip pool first.** If T has a shared balance, it pays. → one member funding the trip covers everyone's spend. This is the friction win.
2. **Pool empty → 402 paywall; never silently drain M's personal wallet.** The paywall forks: **"Add credits to this trip"** (funds the pool, benefits all) or **"Use my personal credits for this action"** (explicit opt-in; remembered for the session, re-asked next visit).
3. **Solo trip (1 member) → personal wallet auto-pays**, no opt-in friction. The opt-in only exists when co-travelers could be spending someone else's money.

### Recharge & scope

- **Top-up default follows context:** buying from a trip's recharge sheet or the empty-pool paywall → funds _that trip's pool_; buying from the account/paywall with no trip context → _personal wallet_.
- Scope is **binary: personal, or one specific trip.** No "all trips" scope — it's a standing liability (any trip you're later added to could drain you) with no real use case.
- `create-checkout`, `payment-webhook`, `revenuecat-verify/-webhook`, and `redeem-coupon` gain an **optional `trip_id`**: present → grant to `trips.credit_balance`; absent → grant to `profiles.credits`.
- **No per-trip free seed** — the free 100 stays per-user (signup), which closes the "create N trips for N×100 free credits" abuse.
- **Attribution:** `credit_transactions.trip_id` records who funded each pool, so the UI shows "Ravi added 300, Aisha added 100."

### Deduction

- `_shared/credits.ts` `deductCredits` takes the resolved target (trip pool or personal wallet per the waterfall); the pre-call gate (`requireMinCredits`/402) checks that target. Every AI edge function already receives `tripId` in its payload.
- **Human-to-human chat costs nothing** — only Trippy-directed messages call the LLM and spend (see §6).
- **Big-spend guard:** any single action costing more than ~15 credits (full itinerary/route regeneration) shows a confirm before spending shared money.

### Migration — schema additive, but the LOGIC is a rewrite

- **Schema is additive:** `profiles.credits` stays as-is (all existing balances are already "personal"; no redistribution, no per-trip seeding). Add `trips.credit_balance` (default 0); **`credit_transactions.trip_id` already exists in prod** (schema half-anticipated pooling).
- ⚠️ **But this is NOT a drop-in.** Verified: `deduct_credits` currently does an unconditional `UPDATE profiles SET credits = credits - amount` and ignores its `p_trip_id` arg; `authenticateUser`/`requireMinCredits` in `_shared/credits.ts` read only `profiles.credits`. Pool-pays-first requires **rewriting the RPC + the pre-flight gate + every gated function's 402 path** — the live money path. Do it via one `resolve_credit_source(user, trip)` used by both gate and deduction (single source of truth), and test that a pooled spend never debits `profiles.credits`. Treat as a first-class phase (see implementation-plan Phase 2.5).

### Accepted consequences (document to users)

- **Only what you deliberately put in a trip pool is at risk** to the group — personal wallets are protected. Pool credits are non-refundable on leave (communal, like buying a round).
- **A heavy member can still drain a funded pool.** Acceptable in v1 because spend is visible in the feed, anyone can top up, and the big-spend guard blocks accidental large burns.

---

## 6. Shared Trippy chat & group intelligence

- **Multi-user messages:** render author avatar/name; Trippy replies attributed to Trippy. `trip_messages` already carries `user_id`.
- **Group context into the prompt:** the chat request (already sending trip + days + form + history) gains `members[]` (id, name) and `preferences[]` (from `trip_preferences`). System prompt: _"This is a group trip with N travelers: [names + preferences]. When members disagree, propose a compromise and name who wanted what."_
- **New action `create_poll`** — Trippy can turn a disagreement into a poll. All other actions unchanged; client `dispatchActions` extends by one case.

### Concurrency (decided: serialize Trippy turns per trip)

**Why it matters:** Trippy's `update_day`/`update_route` actions **delete + re-insert the whole entity**, so two overlapping AI turns don't merge — the later write silently clobbers the earlier one (whole-day loss, not a field conflict). Plain last-write-wins is therefore unsafe here.

**Decision:**

- **Serialize Trippy-directed turns per trip** — one AI turn processes at a time. A queued prompt is accepted (not rejected) and runs when the current turn finishes, **on the post-change state** (so Trippy sees the prior edit — fresh context for free).
- **Only AI turns take the lock.** Human `everyone`/`user` messages mutate nothing and **always send instantly** — the conversation never blocks; only state-changing AI turns queue.
- **Mechanism:** a per-trip lock acquired at turn start, released at end. ⚠️ **Crash-safety (R4):** a `trips.chat_lock` row with **~60s** auto-expiry is unsafe — streaming IG can exceed 60s, the lock expires mid-turn, and a queued turn starts on half-written state (the exact clobber this prevents). Use **either** (a) a **Postgres advisory lock** held for the edge function's lifetime, auto-released on connection close (no timer to misfire — preferred), **or** (b) a row whose heartbeat is written *by the edge function itself* while streaming, with expiry ≥ worst-case IG (~5 min). Never rely on the client to heartbeat. The `>15`-credit confirm happens _before_ the lock is taken; pool deductions serialize naturally.
- **UI — server-authoritative busy state (not client guesswork):** the busy signal must come from server state broadcast over realtime, since the client can't know another member's turn is running. Spec: the edge function, on acquiring the lock, writes a `trips.ai_busy` row/columns (`ai_busy_by uuid`, `ai_busy_since timestamptz`, cleared on release); `trips` is broadcast over realtime (or a dedicated `trip_ai_state` table added to the publication), so every client renders "🐧 Trippy is helping Ravi — you're next" from that row and the queued sender doesn't re-type. This row is written **only by the edge function** (service_role, bypasses RLS); clients read it via the co-member policy. Wire this into the Phase-2 migration, not as UI polish.
- **Future scale path (not v1):** if AI concurrency ever becomes a real bottleneck, migrate Trippy actions from whole-object replacement to **granular ops** (`add/remove/edit_activity(id)`) for true row-level merge. Over-engineered for v1's 2–4-person groups.

### Message addressing (US-6b)

The shared chat is dual-purpose: prompting the AI _and_ human group discussion. A message's **audience** disambiguates intent — **all messages are visible to every member regardless.**

- **Data model:** extend `trip_messages` with `audience text NOT NULL DEFAULT 'trippy'` (`'trippy' | 'everyone' | 'user'`) and `directed_user_id uuid NULL REFERENCES profiles(id)` (set only when `audience = 'user'`). The existing `role` CHECK (`'user'|'assistant'`) is unchanged — audience is orthogonal to author.
- **Behavior by audience:**
  - `trippy` — calls the chat edge function; Trippy responds and may return actions. **Spends credits** (per §5 waterfall).
  - `everyone` — human broadcast; **no LLM call, no credit spend.** Just inserted + realtime-broadcast to all members.
  - `user` (specific co-traveler) — same as `everyone` (no LLM, no spend) but rendered as directed ("→ Aisha"). Still visible to all; the target may get an in-app nudge.
- **Default audience is `trippy`** (the app's primary job). The composer shows the current target _before_ send so intent is never ambiguous (see design §3).
- **Trippy awareness:** `everyone`/`user` messages are included in the history passed to Trippy on the next `trippy`-directed turn (so Trippy has the group's discussion as context), but Trippy only _acts_ when directly addressed.

---

## 6b. Polls & group decisions (shared-only)

Polls are TripJam's opt-in mechanism for _explicit_ group decisions, layered on top of the default unilateral-edit model. Every poll — however invoked — is **anchored to an entity** and **collected in one hub**, so nothing gets buried.

### Invocation

| Path                      | How                                                                                                                                                                                                                                                                          | Cost                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Trippy-suggested**      | On a `trippy`-directed turn, when a real either/or surfaces (from the conversation or travelers' saved preferences), Trippy returns a `create_poll` action and the card appears, framed by its message. **Auto-created, cancellable** by creator/owner (no "shall I?" gate). | rides a normal chat turn — no extra charge |
| **Ask Trippy explicitly** | "put Day 4 to a vote" → Trippy parses options into `create_poll`.                                                                                                                                                                                                            | normal chat turn                           |
| **Manual**                | A **＋ menu in the chat composer** → "Poll" → compose sheet (question + 2–4 options). It's a structured **"Everyone"-audience** message.                                                                                                                                     | **free — no LLM call**                     |
| **Context (v1.1)**        | Long-press a day/activity → "Put to a vote", pre-filled + anchored to that entity.                                                                                                                                                                                           | free                                       |

Trippy path → `create_poll` action → client inserts the `polls` row. Manual path → client inserts directly (RLS: members insert for their trip). Same tables, same card, realtime to all.

### Anchors

`polls.entity_type` ∈ `route | day | activity | freeform` with `entity_id`. The anchor decides _where_ the poll surfaces (routes tab / itinerary / chat) and _what auto-applies_ on resolve. All anchors are collected in the **Decisions hub** (Board → Decisions) regardless.

### Routes as a first-class poll surface

Picking a route in a group is _the_ first real group decision, and RG already carries a per-route signal (`brainstorm_votes`).

- Add a **"Vote on the plan"** affordance on the Routes tab, and have **Trippy auto-suggest a route poll right after generating the 4 options** in a shared trip.
- A route poll's options _are_ the 4 plans (`entity_type='route'`, option ids = route ids). On resolve, the winning route is **selected and flows into the existing selection → pre-IG → IG pipeline** (any member can then trigger Build, or it auto-advances).
- **Voting stays optional** — anyone can still select a route unilaterally (it's re-selectable/undoable); the group can _choose_ to vote instead. No forced gate.
- Keep `brainstorm_votes` as the ambient per-route 👍/👎 signal that informs Trippy's preference understanding — distinct from the explicit "pick THE route" poll.

#### Pre-IG vs post-IG: two different worlds

Routes are normally a **pre-IG, throwaway step** — but the moment any member runs IG, one route is elaborated into a full (possibly hand-edited) itinerary. A route poll therefore behaves differently depending on trip state, and the client **auto-detects which state it's in and constructs the poll accordingly** — the voter never has to know it's a "different kind" of poll.

- **State A — pre-IG (no itinerary built).** The clean case above. Options are the 4 RG candidates, no status quo, winner → IG builds it. Non-destructive: nothing exists yet.
- **State B — post-IG (itinerary already built).** A newcomer wanting to "poll on routes" is really asking to **rebuild the trip** — destructive + credit-costing. The poll is **reframed** (see below) so the built plan is protected by default.

#### Post-IG reframe rules (applied automatically when an itinerary exists)

1. **Question flips** from _"Which plan should we build?"_ → _"Change the overall plan?"_
2. **A synthetic "Keep current plan" option is injected and pre-selected** as the status quo. Its label carries the current route + a `Current` chip, and an inline note that **existing human edits are preserved** ("As edited — Ravi's Day 4 + Aisha's 2 tweaks stay"). This is _not_ a stored `brainstorm_items` row — it's a client-side synthetic option (well-known id, e.g. `keep-current`) that resolves to "no-op."
3. **Every other option is tagged `↻ rebuilds`** so the weight is visible _before_ voting.
4. **Conclusion logic changes:** _keep-wins or tie → no-op._ Only a clear win for a Switch option does anything (→ rebuild-pending, below).

**Requires persisting the RG candidates.** The dormant 4 candidates must survive IG (they already persist as `brainstorm_items`) so a post-IG switch is a _known_ plan, not a blank regenerate. If they were ever dropped, a post-IG route poll could only offer "keep vs. regenerate fresh" — a blanker experience we're explicitly avoiding.

#### Escalation ladder — most changes never touch routes

A route re-vote is the **rare, heavy top rung**. Almost all collaboration happens on cheaper rungs, and the UI actively pushes people down the ladder ("Adjusting days? Just ask Trippy. Want a different overall route? Start a route vote"):

| Change | Path | Cost | Destructive? |
| --- | --- | --- | --- |
| "Move dinner", "make Day 4 relaxed", "add a ramen spot" | **Ask Trippy in chat** → edits that day | 1 small IG-edit | No — logged + undoable |
| Disagreement on _one_ day/activity ("Day 4: Kyoto or Osaka?") | **Day / activity poll** → winner applied by editing _that day_ | small | No |
| Different overall _shape_ (cities, order, structure) | **Route re-vote** → optional rebuild | full IG | No — restorable snapshot |

The critical consequence: **"Day 4: Kyoto or Osaka?" is a _day_ poll that edits one day** (`entity_type='day'`), never a route rebuild. Only a fundamentally different trip shape reaches for routes.

### Voting model

- **Open, changeable votes:** live tallies visible; a member can change their vote until the poll closes. Group planning is consensus-building, not a blind ballot — seeing "3 want Kyoto, I'll join" is a feature. (Blind voting was explicitly rejected.)
- **Modes** (`polls.mode`): **`single`** (default; auto for 2-option polls) and **`approval`** (multi-select "pick everything you'd be happy with" — the consensus-finder, ideal for routes/activity shortlists). **`ranking` is deferred** to v1.1.
- **Vote-notes:** an optional note per voter (one per person per poll, editable on re-vote), stored as a `comments` row anchored to the poll, visible to all.

### Resolution

- Because votes are changeable, "everyone voted" ≠ settled — a poll closes by **explicit action** (creator/owner closes) or an optional **`closes_at` deadline**, not auto-on-last-vote.
- On close, if the poll is anchored (`route`/`day`/`activity`), Trippy can **apply the winning option as a normal action** — and **feeds the vote-notes in as context** ("Kyoto won; notes say keep it relaxed + a Nara day trip"), so the group's messy consensus shapes _how_ the change lands. A `freeform` poll just records the decision until someone asks Trippy to act.
- Applying writes an `activity_log` row (`action='apply_poll'`).

#### Post-IG route switch: the rebuild-pending flow

When a **post-IG route poll** closes, applying isn't a light "apply winning option" — it means discarding a built plan and running a fresh IG. So resolution has its own path:

1. **Poll closes** (deadline or explicit close). Determine the winner.
2. **Keep-wins or tie** → poll marked _Decided: "Kept current plan."_ **No-op.** Done.
3. **A Switch wins** → poll enters a **`Decided · rebuild pending`** state. Nothing auto-fires. A **rebuild-pending pin** appears trip-wide (`🛠 Group chose P3 Foodie — Rebuild the plan →`), and the Decisions-hub row shows "won 2–1 · rebuild pending."
4. **Any member taps "Rebuild the plan"** → a **one-line confirm** (no diff): _"Rebuild the plan as P3 Foodie & Cities? This rebuilds all 7 days. Your current plan (with N edits) is **saved to history — restore anytime.** · ~X credits from the trip pool."_ → **Rebuild**.
5. On confirm: **snapshot the current itinerary** (into history / `undo_payload`), then run IG on the new route (streaming). Credits come from the trip pool.
6. New plan live. `activity_log` row (`action='apply_poll'` / route switch): _"Plan switched to P3 (group vote), rebuilt by Ravi."_ Old plan restorable from history.

**Design rules encoded here:**

- **Non-destructive:** the switch is a snapshot + rebuild, never an in-place overwrite. The **snapshot/undo is the safety net — so there is no parameter diff** (the diff was deemed heavy and unnecessary once restore-anytime exists).
- **No auto-fire:** a concluded switch-vote _parks_. Until someone taps Rebuild, the **current plan keeps working indefinitely** — the switch is opt-in even after the vote.
- **No owner-gating:** _any_ member can tap Rebuild. The tap is the group's consent to spend shared credits and to be present for the streaming build; it is not a privilege. (This overrides the earlier owner-gated idea — the owner has no special rights here.)
- **Manual-tap, not auto-apply,** specifically because IG is a visible streaming operation someone should witness, and it spends pooled credits — a human tap is the consent.
- **Concurrency:** two simultaneous Rebuild taps serialize on the same per-trip AI-turn lock as chat (§6); the second sees "Rebuild already in progress."

### Where polls live (anti-burial)

- **Board → Decisions tab** — the canonical list (open first, then resolved with outcomes).
- **Persistent open-poll pin** — a slim bar atop the relevant tab (`🗳 Day 4: Kyoto or Osaka? · 2/3 · Vote`) until the poll closes; it follows the member across tabs.
- **Rebuild-pending pin** — after a post-IG route poll closes on a Switch, the pin persists in a terra "action" style (`🛠 Group chose P3 Foodie — Rebuild the plan →`) until a member triggers the rebuild or dismisses it (see §6b resolution).
- Open polls also appear in the activity feed and the "while you were away" summary.
- The chat card is only an _entry point_ — a poll's home is the hub + pin, so an in-chat poll is never lost.

---

## 7. Realtime

- `ALTER PUBLICATION supabase_realtime ADD TABLE trip_messages, activity_log, days, activities, polls, poll_votes, comments;`
- Client subscribes to one channel per open trip, `postgres_changes` filtered by `trip_id`; RLS is enforced on realtime rows.
- Merge: append for chat/feed/polls; last-write-wins for `activities`/`days` (already the edit model).
- Optional: Realtime Presence for "who's viewing / typing."

---

## 8. Notifications

### In-app (committed, v1)

- Driven by `trip_read_state` vs `activity_log` (§4). Always shown on return when unseen changes exist. No infra.

### Email digest (committed, v1)

- **One per day, 9am, per trip, only if changes occurred.**
- A scheduled job (Supabase `pg_cron` → `send-digest` edge function, or a scheduled function) runs hourly; for each (member, trip) whose local time is ~9am, has `email_digest = true`, `last_digest_sent_at < today`, and has `activity_log` rows since the last digest, send one summary email and stamp `last_digest_sent_at`.
- **Timezone:** send at 9am in the member's local time — store `profiles.timezone` (fallback UTC). Hourly cron makes per-tz delivery cheap.
- **Provider:** Resend (`RESEND_API_KEY` secret) — simple, good free tier.
- Content: per-trip change list, each line using the `activity_log.summary` (so Trippy's rationale carries into the email). CTA back to the trip.
- **Poll events** (started / resolved) are just more change-lines in this daily digest — **no separate blast**, keeping the max-1/day rule. Immediacy for polls is handled in-app by the persistent open-poll pin. (Poll "started / closing / needs your vote" is the #1 use case for push when it lands.)

### Push (deferred)

- Optional immediate nudge later (FCM + Web Push). Not in v1 scope per the refined cadence.

---

## 9. Acceptance criteria (v1)

- [ ] Owner can generate a join link; opening it (post-auth) adds the user as an `'edit'` member via `accept_invite`.
- [ ] Members see all co-members; owner can remove members and revoke links; members can leave.
- [ ] Chatting with Trippy shows author attribution; co-travelers' messages and Trippy's streamed replies appear live without refresh.
- [ ] The composer shows the message's target (Trippy / Everyone / a specific co-traveler) before send; `everyone`/`user` messages are visible to all, trigger no LLM call, and spend no credits; only `trippy` messages invoke the AI.
- [ ] Each member can save preferences; a fresh generation visibly accounts for multiple travelers.
- [ ] Every plan change writes an `activity_log` row with actor + summary; the feed renders them with working undo (including cross-user undo, which notifies the original actor).
- [ ] Returning to a trip with unseen changes shows the "while you were away" summary; dismissing updates `last_seen_at`.
- [ ] Polls can be created Trippy-suggested (auto, cancellable) or manually (free, no LLM); every poll appears in the Decisions hub and as a persistent pin until closed; an in-chat poll is never lost.
- [ ] Voting is open + changeable with live tallies; single and approval modes work; polls close by explicit action or `closes_at`, not on last vote.
- [ ] A voter can attach an editable note (stored as a `comments` row); on close, an anchored poll applies its winning option and Trippy factors the notes into how it applies.
- [ ] Route polls: options are the 4 plans; Trippy auto-suggests one after RG in a shared trip; the winner feeds selection → IG; unilateral route selection still works.
- [ ] A route edited while a poll on it is open flags the poll and shows `edited by · when` on the card.
- [ ] Solo trips (1 member) show none of the collaboration chrome (members, audience selector, attribution, pooled-credit fork, poll UI).
- [ ] All AI actions on a shared trip draw from the trip pool first; an empty pool opens the fork paywall (add-to-trip vs use-personal); personal credits are never spent silently; solo trips auto-pay from the wallet.
- [ ] At most one 9am email digest per member per day, sent only when a trip changed (poll events included as lines); muteable per trip.
- [ ] RLS: a non-member cannot read a trip's members, messages, feed, preferences, polls, or vote-notes.

## 10. Out of scope (v1)

- Roles/tiers beyond equal editor; co-editing trip-level settings; per-day forks; **ranking-mode polls** (single + approval only); comments/reactions on individual activities (the `comments` table is used only for poll vote-notes in v1); context-anchored poll creation from long-press (v1.1); push notifications; refunds/hard spend-limits on pooled credits.
