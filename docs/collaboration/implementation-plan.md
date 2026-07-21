# Collaboration — Implementation Plan

Engineering-level build plan for the collaboration feature. Product phasing lives in
[`../collaboration-plan.md`](../collaboration-plan.md); the functional/technical spec in
[`documentation.md`](documentation.md); UI in [`design.md`](design.md). This doc is the
**how we ship it** layer: per-phase PRs, migrations, functions, files, RLS, realtime, tests, and ship-gates.

## Guiding constraints

- **Deploy order per phase (always):** DB migrations → edge functions → frontend. Never reorder.
- **Each phase is independently shippable** and leaves `main` releasable. No phase half-lands a schema.
- **Solo trips are the rollout gate.** Per the solo-vs-shared principle, a 1-member trip is the app exactly as today — no collab chrome. All collaboration UI is gated on `memberCount > 1`, so **the code can ship dark** and only lights up when a trip actually has co-travelers. The single human toggle is the **Invite affordance** (Phase 1): keep it behind a flag and no shared trips can be created, so all downstream collab code stays dormant in production.
- **Prod-direct.** We work directly in prod (staging shares the DB with local). Migrations are applied with `npm run db:push:prod`; functions with `npm run deploy:functions:prod`. Nothing pushes without explicit approval.
- **Additive *schema*, but credits is a logic rewrite — not additive.** Table/column changes are additive (no destructive rewrites of live data). But pooled credits is **not** a drop-in: `deduct_credits` currently does an unconditional `UPDATE profiles SET credits = credits - amount` and ignores `p_trip_id`, and `authenticateUser`/`requireMinCredits` read only `profiles.credits`. The pool-pays-first waterfall requires rewriting that RPC + the pre-flight gate + every gated function's 402 path. Treat it as a first-class phase touching the live money path, not a side-quest. (Schema is half-done: `credit_transactions.trip_id` already exists; only `trips.credit_balance` is net-new.)
- **Table names are authoritative from [`documentation.md` §2](documentation.md).** `trip_preferences`, `trip_read_state`, `notification_prefs`, `polls`, `poll_votes`; vote-notes reuse `comments`; route attribution on `brainstorm_items`.

---

## Schema ground truth (verified 2026-07-20 against live prod + staging)

**The collaboration tables already exist in the databases but are missing from `supabase/migrations/` — this is schema drift, not "dormant tables to activate."** Verified by probing PostgREST on both projects. Correct this understanding before writing any migration.

| Table | Prod (`viyvdqww…`) | Staging/local (`wlrzvwj…`) | Tracked in migrations |
| --- | --- | --- | --- |
| `trip_members`, `invite_links`, `activity_log`, `comments`, `reactions`, `forks`, `fork_members` | exists | exists | **NO — untracked drift** |
| `polls`, `trip_preferences`, `trip_read_state`, `notification_prefs` | **MISSING** | exists | **NO — prod↔staging drift** |
| `poll_votes`, `device_tokens` | MISSING | (verify) | NO |
| `trip_messages`, `brainstorm_votes` | exists | exists | **YES (clean)** |

**Column reality (columns the plan wants to add):**
- **Already present:** `invite_links` is fully shaped (`token, expires_at, role, created_by`) → Phase 1 needs only the RPC + RLS + UI, not a table build. `trip_members(role, joined_at)` present. **`credit_transactions.trip_id` already present** (half the pooled-credits schema).
- **Must add:** `activity_log.{summary, undo_payload}`, `trip_messages.{audience, directed_user_id}`, `trips.credit_balance`, `brainstorm_items.{last_modified_by, last_modified_at}`.

**Two consequences that reshape Phase 0/1:**
1. **Capture drift, don't "activate."** When it's time to write the capture migration (`01`, deferred — see scope decision), it must be `CREATE TABLE IF NOT EXISTS` matching the *actual live shape* of the 7 untracked tables (dump `\d <table>` on prod first), so history reproduces prod. Do **not** write fresh `CREATE TABLE` from the spec — it will diverge from what's live.
2. **Prod is the only target now** (staging out of scope — see decision below). The tables absent in prod (`polls`/`trip_preferences`/`trip_read_state`/`notification_prefs`) are created in prod from the canonical spec (`03`), not reconciled against staging. Staging alignment is deferred to pre-launch. Consequence to keep in mind: **E2E/preview run on staging, so their green does not certify the prod-only Phase-5/6 tables** — those get manual prod QA until staging is re-established.

> **Action:** the very first task is a schema-reconciliation migration set that (a) captures the 7 drifted tables [`01`, deferred to pre-launch — needs prod `pg_dump`], (b) adds the missing columns [`02`], (c) creates the absent-in-prod tables [`03`]. Drafts live in [`migrations-draft/`](migrations-draft/).
>
> **Scope decision (2026-07-20): staging is out of scope — work prod-direct until launch.** We no longer reconcile prod↔staging now; the functional migrations (`02`–`06`) target prod only. Because the 7 drifted tables already exist in prod, the capture migration (`01`) is **not blocking** — it's launch-time hygiene (lets a fresh env rebuild those tables) and is deferred until staging is re-established. Trade-off accepted: E2E/preview (staging) may diverge from prod in the interim.

## Dependency graph

```
Phase 0  Foundations  ── 0a schema-reconciliation (drift capture DEFERRED) → 0b realtime + activity_log cols + is_trip_member RLS
   │  unblocks everything, invisible to users
   └──► Phase 1  Membership & invites  ── gates all "shared" state (invite_links already shaped)
            │   ⟶ MVP SEAM: enable shared HUMAN chat here (everyone-audience, LLM-free) to soak
            │      membership+realtime+attribution before the scary parts. Gate Trippy-audience
            │      sends OFF on shared trips until 2.5 ships (else dogfood bills the wrong wallet).
            │
            └──► Phase 2.5  Pooled credits  ── MUST precede shared AI spend (money-path rewrite)
                     │
                     └──► Phase 2  Shared Trippy chat + crash-safe AI-turn lock + group prompt
                              │
                              ├──► Phase 5  Preferences synthesis  ── SHARES Phase-2 prompt-payload work; do next
                              │
                              └──► Phase 3  Activity feed + "while you were away" + undo(conflict-checked)
                                       │                                               ← v1 core complete
                                       └──► Phase 6  Polls core (day/activity/freeform + hub + pin)
                                              needs 2 (create_poll action) + 3 (apply_poll → feed)

   post-v1 fast-follows:
   ├──► Phase 4  Notifications (email digest → push)
   └──► Phase 7  Routes-as-poll + post-IG rebuild  ── v1.1
```

**v1 critical path:** 0 → 1 → 2.5 → 2 → **5** → 3 → **6**. Rationale: 2.5 strictly before 2 (shared AI spend rewrites the money path); **5 (preferences) right after 2** — it's one table + a prompt-payload add to the chat function you're *already editing* in 2, so it rides that work; **6 (polls) last** — it structurally needs Phase 2's `create_poll` action and Phase 3's `apply_poll` feed primitive. **Deferred:** Phase 4 (email/push — heaviest infra) and Phase 7 (routes rebuild — high effort, rare use).

---

## Phase 0 — Foundations (invisible)

**Goal:** realtime plumbing + universal change logging + co-member visibility. No user-facing change.

**DB migration — 0a, schema prep (prod-direct)** — drafted in [`migrations-draft/`](migrations-draft/):
- **`02_add_missing_columns`** — the 6 verified-missing columns (idempotent `ADD COLUMN IF NOT EXISTS`). Ready.
- **`03_create_absent_in_prod_tables`** — creates `polls, poll_votes, trip_preferences, trip_read_state, notification_prefs` in **prod** from the canonical spec (§2). Ready.
- **`01_capture_drifted_tables`** — DEFERRED to pre-launch (the 7 drifted tables already exist in prod, so not blocking; needs the prod `pg_dump` to capture exact shape). See scope decision above.
- Run the **prod pre-flight checks** (README) before applying — one query each de-risks a specific migration.
- Staging reconciliation is out of scope now (prod-direct until launch).

**DB migration — 0b, foundations** — drafted:
- **`04_is_trip_member_and_rls`** — the `SECURITY DEFINER is_trip_member()` helper (R3 fix: never subquery `trip_members` from a policy *on* it) + non-recursive co-member RLS on all collab tables, incl. `activity_log` (with the legacy-owner fallback) and service-role policies. (`activity_log.summary`/`undo_payload` come from `02`.)
- **`05_realtime_publication`** — guarded `ALTER PUBLICATION supabase_realtime ADD TABLE` for `trip_messages, activity_log, days, activities, polls, poll_votes, comments`.

**Frontend:**
- Realtime subscription scaffolding: one channel per open trip (`postgres_changes`, `filter: trip_id=eq.<id>`), wired in `App.jsx` trip-load. Merge rules: **append** for chat/feed, **last-write-wins** for `days`/`activities` (already the edit model). Behind a `REALTIME_ENABLED` guard so it's a no-op until Phase 2 needs it.
- Central `logActivity({action, entity_type, entity_id, summary, undo_payload})` helper. Wire into every existing mutation path (day/activity edits, todos, expenses, bookmarks, budget). Fire-and-forget, mirrors `llm_usage` logging pattern. **Solo trips log too** (cheap, and seeds the feed the moment a trip becomes shared).

**Tests:** unit-ish Playwright that a mutation writes an `activity_log` row; realtime subscribe/receive smoke (against prod — staging out of scope).

**Ship gate:** `npm run check` green; no visible change; activity rows appearing for normal edits.

---

## Phase 1 — Membership & invites

**Goal:** create/accept invites, Members sheet, solo→shared transition. Everyone an equal editor.

**DB migration** (`_phase1_invites.sql`):
- **`invite_links` is already fully shaped in prod** (`token, expires_at, role, created_by` verified) — no table build, just add `accept_invite(p_token text)` **SECURITY DEFINER** RPC. Param is **`text`** (tokens are opaque strings / `/join/:token`), not `uuid` — the spec had a type mismatch. RPC validates unexpired token, checks the inviter is still a member, **enforces a max-members cap**, then self-inserts `trip_members(user_id=auth.uid(), role='edit')`, idempotent. Never loosen `trip_members` INSERT to arbitrary rows.
- `trip_members`: confirm DELETE policy (owner removes members; member removes self — added 2026-07-13). Co-member read added in Phase 0b via `is_trip_member()`.
- Invite create/revoke policies (owner-only).
- **Transferable ownership:** add `trips.owner_id uuid` (backfill from `created_by`; keep `created_by` immutable). **Repoint every owner-only RLS policy** (trip metadata, invite create/revoke) from `created_by` → `owner_id`. See documentation.md §3 "Membership lifecycle."
- **Lifecycle RPCs** (`SECURITY DEFINER`, atomic + RLS-safe): `transfer_ownership(trip, new_owner)`, `remove_member(trip, user)` (deletes target's `poll_votes` + poll vote-notes for the trip), `leave_trip(trip)` (owner+others → `transfer_ownership_first`; owner+sole → delete trip; else self-cleanup). Drafted in `migrations-draft/07`.

**Frontend:**
- `main.jsx parseUrl()`: new `join` page for `/join/:token`; pre-auth routes through Auth then continues to accept.
- **Members sheet** component (`collab-members-design.html` → real): list (avatar+name+role), owner remove, invite-link copy (native share), revoke. Mounted from the header affordance.
- **Entry-point affordance** (the progressive one from the mockup): `＋ Invite` when solo, **avatar stack + count** when shared. Gate the whole thing behind an `INVITE_ENABLED` flag for staged rollout.
- Join screen + expired/revoked state (mockup frames 3–4).
- `getMemberName()` / member list into App state for attribution downstream.

- **⚠️ Trippy-block gate (money safety):** until Phase 2.5 ships, **block/hide `trippy`-audience sends on any `memberCount > 1` trip.** Without this, the 2nd member's Trippy message spends the *sender's personal wallet* through the shared trip (today's `deduct_credits` ignores trip scope) — the exact bug 2.5 fixes. Shared HUMAN chat (`everyone`/`user` audience, LLM-free) is fine to enable now — that's the MVP seam.

**RLS:** co-member read already added in Phase 0. `days`/`activities` editing already gated on `role='edit'` members — no change.

**Tests:** invite create → join (2nd user) → membership visible; expired token rejected; anon cannot self-insert; remove/revoke; **Trippy-send blocked on a shared trip pre-2.5**.

**Ship gate:** two QA accounts can share a trip + exchange live human messages; Trippy-audience blocked on shared trips; solo trips show zero collab chrome.

---

## Phase 2 — Shared Trippy chat + group prompt ✅ BUILT (on `collab-dev`, dark behind flags)

**Goal:** one shared Trippy conversation, multi-user, live, group-aware.

> **EM review reshaped this phase.** The planned crash-safe "AI-turn lock" was dropped — it was infeasible over the pooler (a stream-spanning advisory lock can't be held in transaction-mode PgBouncer) **and** guarded the wrong write (the clobber is a *client* write in `dispatchActions`, after the function returns). The real fix is a **non-destructive per-row write**; serialization was unnecessary. See `documentation.md` §Concurrency (revised).

**Built:**
- **Step 1 — data-loss fix (commit `91841da`):** `update_route` now updates only the one changed `brainstorm_items` row (`.update().eq("id")`) instead of `delete().eq("trip_id")` + insert-all. Concurrent edits to different routes can't clobber; a bug fix even solo.
- **Step 2 — attribution (`058e857`):** Trippy rows persist with `user_id: null` (not the sender's); `getMemberName` reads the live `members` state. Migration `20260722000001_trip_messages_assistant_rls.sql` adds an INSERT policy letting a member write an `assistant`/null-user row for their trip (the existing `user_id = auth.uid()` policy would reject it). `audience` + `directed_user_id` already existed (migration `20260721000001`).
- **Step 3 — realtime echo-safe (`058e857`):** every insert supplies a client `crypto.randomUUID()` id the optimistic bubble shares; the realtime handler appends an incoming row only when its id is unseen → own echoes dedup, co-travelers' messages append once. `VITE_REALTIME_ENABLED` on for staging.
- **Step 4 — message addressing (`058e857`):** shared-trip composer gets a who-answers (Trippy/Everyone) + `@mention` selector; only `trippy`-audience calls the LLM/spends credits; `everyone`/`user` messages insert directly (free, no function round-trip) via `sendHumanMessage`. Composer capped at 2000 chars.
- **Step 5 — group-aware Trippy (`28b2ad1`):** `callUnifiedChat` sends the member roster (usernames only) + per-message authorship + the sender's name on shared trips; `chat/index.ts` injects a GROUP TRIP block into the **dynamic (uncached)** context and prefixes human turns with the speaker's name. `create_poll` is an explicit `dispatchActions` no-op (Phase 6 seam), not yet in the action vocabulary.

**Deferred (EM-sanctioned):** the `ai_busy` "Trippy is helping X" banner — UX-only, not a safety mechanism (see §Concurrency).

**Verified on staging** (`scripts/phase2-shared-chat-test.mjs`): non-member & impersonation inserts blocked; shared chat with `members[]` returns a group-aware reply that attributes by name; free `everyone` messages allowed; solo chat byte-identical. **Pending:** apply migration `20260722000001` to staging/prod (assistant-row insert fails RLS until then), and a browser-level two-context clobber/realtime regression test (the clobber path is `dispatchActions` JS, unreachable from Node).

**Depends on:** Phase 2.5 credits (shared spend) — landed.

---

## Phase 2.5 — Pooled credits (personal wallet + opt-in trip pool)

**Goal:** shared trips draw from a pooled balance; personal wallet protected. **Must land strictly before shared Trippy chat is flag-enabled** (the moment a 2nd member sends a `trippy` message, today's code spends the *sender's* personal wallet). Own ship gate — not folded into Phase 2.

**DB migration** (`_phase2_5_credits.sql`):
- `trips.credit_balance int` (net-new; nullable → a trip pool exists only when funded).
- `credit_transactions.trip_id` — **already exists in prod**, no-op (schema half-anticipated pooling).
- **Rewrite `deduct_credits` + gate as one source of truth (R2):** add `resolve_credit_source(p_user, p_trip)` that returns which balance pays; call it from *both* the pre-flight gate (`requireMinCredits`/`authenticateUser` in `_shared/credits.ts`) and the deduction RPC. Shared trip → trip pool first; on empty → **fork paywall** (never silently touch personal wallet). Personal wallet auto-pays only on solo trips. **Test:** a pooled spend never debits `profiles.credits`.
- Recharge scope choice at purchase (personal / this-trip pool) — `billing.js` + `create-checkout` + `revenuecat-verify` carry a `scope` + `trip_id`.

**Frontend:**
- Credits pill states (pooled `👥 240` vs personal); Trip Credits sheet (funded-by, packs, protected personal wallet); **empty-pool fork paywall** (the one genuinely new screen). All in `collab-feed-credits-design.html`.
- `handleGatedResponse` extended: 402 on a shared trip → fork paywall, not the personal paywall.

**Guard:** big-spend confirm (>~15 credits — full IG/route regen) before spending shared money — reused by the Phase-5 rebuild confirm.

**Tests:** pool spend; empty-pool fork keeps personal wallet untouched unless chosen; top-up scope routing; leave-trip leaves pool with trip.

**Ship gate:** a shared trip spends only pooled/opted-in credits; personal balance never silently drained.

---

## Phase 3 — Activity feed + "while you were away" + undo

**Goal:** every change visible, attributed, reversible; on-return summary.

**DB migration:** none new — `trip_read_state` (unseen diff) is created in `migrations-draft/03`, and `activity_log.summary`/`undo_payload` are added in `02`. Just ensure all Phase-2 chat actions write summaries (Trippy's own sentence).

**Frontend:**
- **Activity feed** sheet (reverse-chron, who/what/when/why + inline Undo, even for others' edits) — `collab-feed-credits-design.html`.
- **Entry points:** 🔔 bell + unseen badge in header (shared-only) beside the avatar stack; **"while you were away"** sheet auto-shown on return when `activity_log > last_seen_at`. Both routes into the same feed (mockup Frame 0 + Frame 2).
- Undo: apply `undo_payload`; notify original actor (cross-user undo allowed, per open-question #3). **Conflict check (R5):** blind snapshot-revert is unsafe — if the entity was edited again after the change being undone, reverting silently wipes the newer edit. On undo, verify the current entity still matches the post-change state; if it diverged, warn *"this was built on since — undo may revert newer edits"* instead of blind-applying. (v1 minimum: document as best-effort; the docs currently over-promise undo as safe.)

**Tests:** change by A shows in B's feed with attribution + rationale; undo restores; "while away" counts unseen only; own changes never trigger it.

**Ship gate:** the full transparency loop works across two users.

---

## Phase 4 — Notifications (post-v1 fast-follow)

**Scope decision:** **v1 ships with in-app only** — the "while you were away" on-return summary is already delivered in Phase 3 (`trip_read_state` vs `activity_log`, zero infra). Everything below (email digest, push) is an explicit **fast-follow after v1**, not on the core critical path. Rationale: email needs Resend + `pg_cron` + `profiles.timezone` + DST handling; push needs FCM + web-push + a service-worker handler — the single heaviest infra slice for a solo dev, and non-essential to the "plan together" promise.

**Goal (fast-follow):** re-engagement via digest, then push. Ship email before push.

**DB migration** (`_phase4_notify.sql`):
- `notification_prefs(trip_id, user_id, email_digest, last_digest_sent_at)` is already created in `migrations-draft/03` (canonical shape). Phase 4 adds only the net-new infra: `device_tokens(user_id, platform, token, created_at)` and `profiles.timezone` (for 9am-local digest). If push needs per-channel mute, extend `notification_prefs` then.

**Edge functions:**
- `send-digest` (pg_cron hourly → per-member ~9am-local, only if changes since last digest; Resend). One email/day/trip max; poll events are just change-lines (no separate blast).
- `send-push` (deferred sub-step): FCM (Android via `@capacitor/push-notifications`) + web-push/VAPID (SW `push` handler). `notify` fan-out respecting prefs + debounce.

**Frontend:** notification prefs UI; SW push handler (PWA); Capacitor push registration on login.

**Sequencing note:** push (FCM + web-push + SW) is the heaviest slice — per open-question #7, Phases 0–3 can ship with **in-app feed only** and push/email treated as a fast-follow if timeline tightens.

**Ship gate (per sub-step):** in-app on-return works (already Phase 3); daily digest sends once at 9am-local only on change; push deep-links to trip.

---

## Phase 5 — Per-traveler preferences synthesis (small — do right after Phase 2)

**Goal:** the cheap, high-value differentiator, split out from polls per the scope review. Just one table + prompt payload. **Sequenced immediately after Phase 2** because it rides the same chat prompt-payload work.

**DB migration:** `trip_preferences(trip_id, user_id, prefs_text, prefs_struct jsonb, updated_at, PK(trip_id,user_id))` — created in **prod** by `migrations-draft/03` (canonical shape per documentation.md §2).

**Frontend/engine:** preferences sheet (mockup: `collab-members-design.html` Frame 4); feed `preferences[]` into the chat + IG payload (chat function already receives trip context, so this is additive) with system-prompt "satisfy everyone" framing.

**Ship gate:** a generated plan visibly accounts for each traveler's stated style.

## Phase 6 — Polls core (day / activity / freeform) — **v1**

**Goal:** the opt-in group-decision system, **minus** the expensive routes-rebuild surface (deferred to v1.1).

**DB migration** (`_phase6_polls.sql`):
- `polls` + `poll_votes` — **created in prod by `migrations-draft/03`** (canonical shape per documentation.md §2; `entity_type` includes `route` for the v1.1 surface but v1 only uses day/activity/freeform). RLS from `migrations-draft/04`.
- Vote-notes: activate `comments` (`entity_type='poll'`) + member RLS via `is_trip_member()`.
- `ALTER PUBLICATION supabase_realtime ADD TABLE polls, poll_votes, comments;`

**Edge / engine:** `chat/` `create_poll` action wired; Trippy suggests polls on detected disagreement. Resolution: anchored winner applied as a normal action with **vote-notes as context**; `apply_poll` activity row.

**Frontend (from `collab-decisions-design.html`):** Decisions hub (Board → Decisions); poll cards (single + approval), open/changeable tallies, vote-notes; **persistent cross-tab open-poll pin** (Frame 7 — the primary discovery surface); manual ＋ compose (free) + Trippy-suggested in-chat cards.

**Tests:** create/vote/change-vote/close each mode; vote-notes carried into apply; pin visible across tabs; a day-poll edits one day (not a rebuild).

**Ship gate:** day/activity/freeform polls behave as mocked; nothing gets buried (hub + pin).

## Phase 7 — Routes-as-poll + post-IG rebuild — **v1.1 (deferred)**

**Scope decision:** deferred out of v1 per the review. Its own escalation ladder argues route re-votes are the *rare top rung*, yet it's the highest-effort surface (synthetic `keep-current`, `↻ rebuilds` tagging, rebuild-pending pin, snapshot-to-history, streaming re-IG on the AI-turn lock, restore-anytime, pooled-credit spend). High effort × low frequency → last.

**Prerequisite to verify:** RG candidates must persist post-IG (`brainstorm_items` retained) — the reframe depends on it. De-risked by deferral.

**DB migration** (`_phase7_routes.sql`): `brainstorm_items`: add `last_modified_by`, `last_modified_at` (**confirmed missing on prod**); extend `polls.entity_type` to include `route`.

**Frontend/engine (fully specced in `documentation.md` §6b + `collab-decisions-design.html` Frames 4–7):**
- Pre-IG: options = 4 RG candidates → winner → IG.
- Post-IG reframe (auto): "Change the overall plan?", injected pre-selected **Keep current** (synthetic `keep-current` id → no-op), `↻ rebuilds` tags, keep/tie = no-op.
- Rebuild-pending flow: switch wins → terra pin → any member taps Rebuild → one-line confirm (no diff; "saved to history · ~X credits") → snapshot current itinerary → stream IG → `apply_poll` log → old plan restorable. No auto-fire, no owner-gating; serialize on the AI-turn lock; pooled-credit big-spend confirm reused.

**Tests:** pre-IG vs post-IG poll shapes; rebuild-pending → rebuild snapshots + restores; keep/tie = no-op.

**Ship gate:** the routes design behaves as mocked, non-destructively.

---

## Rollout & flags

| Flag | Controls | Default until GA |
| --- | --- | --- |
| `INVITE_ENABLED` | The `＋ Invite` entry point (Phase 1) | off in prod → gates all shared-trip creation |
| `REALTIME_ENABLED` | Client realtime subscription (Phase 0 scaffold, Phase 2 live) | off until Phase 2 |
| Per-phase | Downstream UI is `memberCount > 1`-gated intrinsically | n/a |

Because everything is solo-vs-shared gated, flipping `INVITE_ENABLED` on for a cohort is the whole rollout lever — no shared trips means no collab code executes.

## Pre-build checklist (resolve before the phase that needs it)

- **Before applying `02`/`03`/`04`/`06`/`07` to prod:** run the 4 **prod pre-flight checks** in `migrations-draft/README.md` (duplicate `trip_members`; `activity_log` RLS state; publication membership; legacy trips missing membership). One query each; each de-risks a specific migration. *(Drift-capture `01` + the owner-only RLS repoint in `07` are deferred until the `pg_dump` — not blocking dev start.)*
- **Before Phase 2.5:** confirm the `deduct_credits` + gate rewrite plan (single `resolve_credit_source` path); verify seed/leave semantics in SQL. `credit_transactions.trip_id` already exists; only `trips.credit_balance` is net-new.
- **Before Phase 4 (post-v1):** Resend account + `RESEND_API_KEY`; `profiles.timezone` + DST handling for the digest; Firebase FCM v1 + VAPID for push. Heaviest infra — deferred, schedule when v1 is stable.
- **Before Phase 7 (v1.1):** confirm RG candidates persist post-IG — the reframe depends on it.
- **Cross-cutting:** invite security defaults (expiry, reusable vs single-use, **max-members cap** enforced in `accept_invite`); explicit stance on malicious invitee (mitigated by undo + log + remove).

## Suggested build order (shippable increments)

0. **P0b** (foundations, dark) → **P1** (invites, flag-gated; `invite_links` already shaped). *(P0a drift-capture is deferred to pre-launch — not blocking, tables already in prod.)*
1. **MVP seam — shippable + dogfoggable:** with P1, enable **shared *human* chat** (`everyone`-audience, LLM-free — no lock, no credit rewrite) and **hard-gate Trippy-audience off on shared trips.** Two accounts can now co-plan live (membership + realtime + attribution soak) without touching the money path.
2. **P2.5 then P2** (pooled credits strictly before Trippy-audience is unblocked) — the "plan together" core.
3. **P5** (preferences) — immediately after P2; rides its prompt-payload work.
4. **P3** (feed/undo) — completes the transparency loop; safe to widen the `INVITE_ENABLED` cohort. **v1 core done.**
5. **P6** (polls core: day/activity/freeform) — last; needs P2 (`create_poll`) + P3 (`apply_poll` feed).
6. **Post-v1 fast-follows:** **P4** (in-app already shipped in P3; add email digest, then push) and **P7** (routes-as-poll + rebuild, v1.1).
