# Collaborative Trip Planning — Feature Plan

Status: **Planning** · Author: product+eng · Grounded against the code as of 2026-07 (see `docs/user-journeys/09-collaboration-and-sharing.md` for the pre-feature state).

> ⚠️ **This is the product-strategy doc. For canonical table names, data model, and the build
> sequence, defer to [`collaboration/documentation.md`](collaboration/documentation.md),
> [`collaboration/implementation-plan.md`](collaboration/implementation-plan.md), and
> [`collaboration/v1-scope.md`](collaboration/v1-scope.md).** In particular, names in the
> "Data model changes" table below are SUPERSEDED: `traveler_preferences` → **`trip_preferences`**,
> and the generic `notifications` table is not used in v1 (notifications are driven by
> `trip_read_state` + `activity_log`; `notification_prefs` handles the email digest). Do not build
> off the older names here.

## Locked decisions

| Question                             | Decision                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How do co-travelers change the plan? | **Unilateral + transparent + undo.** Anyone can edit directly; every change is attributed, visible, and reversible. No per-edit approval gates. Opt-in **polls** for genuine group decisions.                                                                                                       |
| Centerpiece of collaboration?        | **Shared Trippy chat.** The group shares one Trippy conversation; Trippy sees everyone's input and mediates. AI-native, reuses the existing unified-chat + `actions[]` engine.                                                                                                                      |
| Permission levels (v1)?              | **Everyone's an equal editor.** Matches today's `'edit'`-only membership. Roles/tiers deferred.                                                                                                                                                                                                     |
| How do people learn what changed?    | **In-app on-return summary + one daily email digest.** In-app shows a "what changed while you were away" summary whenever a member returns to a trip with unseen changes; email is a single 9am daily digest per trip, only when something changed. Push deferred (optional immediate nudge later). |
| Who pays for AI usage?               | **Pooled per-trip credits.** Every trip has one shared credit balance; all AI actions on the trip draw from it; any member can recharge it. Replaces per-user deduction for shared trips.                                                                                                           |

> Detailed specs: **[Functional & technical documentation](collaboration/documentation.md)** · **[Design spec](collaboration/design.md)**.

## Success metrics

How we'll know collaboration is working (tag events with `app_env`, filter to shared trips where relevant):

| Metric | Definition | Why it matters |
| --- | --- | --- |
| **Weekly retention** | % of active users who return the following week (overall + a shared-trip cohort cut) | The north star — collaboration should lift stickiness, not just add surface area. Compare shared-trip members vs. solo users. |
| **% of paying users** | share of users who hold/purchase credits | Collaboration should pull more people into paying (pooled credits let one payer unlock a group). Watch that shared trips don't just free-ride. |
| **% of trips with multiple travelers** | trips with `memberCount > 1` ÷ all trips | Adoption of the feature at all — is anyone inviting co-travelers? |
| **% of trips where multiple travelers engage** | of multi-traveler trips, share where ≥2 members took a real action (message, edit, vote, fund) within the trip | The quality metric — invited ≠ engaged. Guards against "invited but nobody showed up." |

Instrument these in Phase 1 (membership) and Phase 2 (engagement events) so the numbers exist from launch, not retrofitted.

## Product principles

1. **Trust & transparency over gates.** The real pain in group-trip planning is coordination paralysis, not vandalism. We make every change visible, attributed, and one-tap undoable rather than gating edits.
2. **Trippy _is_ the collaboration surface.** Instead of bolting Google-Docs editing onto the app, the group collaborates _through the AI_. Trippy already narrates its own changes ("Replaced Day 3 lunch with Trishna in Colaba — one of Mumbai's best seafood spots") — that sentence becomes free, high-quality collaborator context.
3. **Every mutation writes to one change log.** Chat actions, manual edits, hotel swaps — all fan out through `activity_log`, which drives the feed and notifications.

---

## What already exists (build on, don't rebuild)

> ⚠️ **Schema-drift caveat (verified 2026-07-20):** the tables below exist in the live prod **and** staging DBs but are **absent from `supabase/migrations/`** — the repo cannot reproduce them. Worse, `polls`/`trip_preferences`/`trip_read_state`/`notification_prefs` exist in **staging but not prod**. Before building, run the Phase 0a schema-reconciliation step (capture drift into `CREATE TABLE IF NOT EXISTS` migrations; align prod↔staging). See [`collaboration/implementation-plan.md` → Schema ground truth](collaboration/implementation-plan.md). "Schema present" ≠ "tracked."

**Dormant tables (present in the DB, untracked in migrations, zero UI):**

- `trip_members` (trip_id, user_id, role default `'edit'`, joined_at) — only self-inserts today; DELETE policy added 2026-07-13.
- `invite_links` (trip_id, created_by, role, token, expires_at) — a ready-made invite mechanism, never used.
- `activity_log` (trip_id, user_id, action, entity_type, entity_id, created_at) — a change-feed table, never written to.
- `comments` (polymorphic entity_type/entity_id) + `reactions` (comment_id, user_id, emoji) — never used.
- `forks` / `fork_members` (per-day alternate plans) — out of scope for v1.

**Reusable engines:**

- Unified chat edge function returns `actions[]` (`update_route`, `update_day`, `add_todo`, `add_expense`, `add_bookmark`, `set_budget`, `navigate`, `suggest`, `dismiss_route`, `generate_more_plans`). Applied client-side via `dispatchActions`.
- `trip_messages` already has `user_id`; role is CHECK-constrained to `'user'|'assistant'`.
- Chat UI already has vestigial multi-user affordances (`getMemberName()`, author-tag rendering when `m.user_id !== session.user.id`).
- RG/brainstorm phase already has `brainstorm_votes` — a voting primitive to model polls on.

**Gaps that are net-new infra:**

- **No realtime.** `supabase_realtime` publication exists but has no app tables. Live chat/sync require adding tables to it + client subscriptions.
- **No push** (no FCM, no `@capacitor/push-notifications`, no web-push/VAPID).
- **No email service** (no Resend/SendGrid/etc.).

---

## Core flows (v1)

### 1. Invite & join

- Trip owner opens **Members** sheet → "Invite co-travelers" → generates an `invite_links` row (token + optional expiry) → shares a `/join/:token` link (native share sheet, same pattern as the public share link).
- Invitee opens link: if logged in, sees a "Join _Tokyo trip_?" confirm → membership row inserted; if not, routes through Auth then continues.
- **Security:** acceptance = self-insert (`user_id = auth.uid()`) gated by a valid, unexpired invite token. Validate + insert via a `SECURITY DEFINER` RPC (`accept_invite(token)`), so we never loosen `trip_members` INSERT to "anyone."
- Members sheet lists everyone (avatar + name), lets the owner **remove** a member and **revoke** an invite link.

### 2. Shared Trippy chat (the centerpiece)

- `trip_messages` becomes genuinely multi-user: author avatars/names on each bubble, "Ravi is typing…" optional presence.
- **Group context to Trippy:** the chat request already sends trip + days + history; add the **member list + each traveler's stated preferences**, and system-prompt guidance: _"This is a group trip with N travelers: [names + preferences]. When members disagree, propose a compromise and say who wanted what."_
- **Concurrency:** two people prompting at once must not corrupt state. Serialize per-trip (queue requests) or last-write-wins with the feed as the reconciliation record. Streaming responses broadcast to all members via realtime.
- New chat action: `create_poll` (see flow 6).

### 3. Live plan sync (realtime)

- Add `trip_messages`, `activity_log`, `days`, `activities` to `supabase_realtime`.
- Clients subscribe to `postgres_changes` filtered by `trip_id`; merge into local state (append for chat/feed; last-write-wins for activities, which is already the edit model).
- Removes the "changes only appear on reload" limitation documented in journey doc 09.

### 4. Activity feed + "what changed since you were away"

- Every mutating action writes an `activity_log` row. For chat-driven changes, store **Trippy's own summary sentence** as the human-readable context.
- **Feed UI:** reverse-chron per-trip list — _"Ravi swapped Day 3 lunch · 2h ago — via Trippy: 'one of Mumbai's best seafood spots'"_ with an inline **Undo**.
- **On open:** a "3 changes since you were here" summary banner.

### 5. Notifications (feed + push + email)

- **Fan-out:** when a member makes a change, enqueue notifications to _other_ members, respecting per-user/per-trip mute + channel prefs.
- **Debounce/digest:** never per-keystroke — batch ("3 changes to your Japan trip in the last hour").
- **Channels:** in-app feed (always) → push → email digest. See Infra below.

### 6. Polls — the opt-in "voting" escape hatch

- Trippy-suggested (auto, cancellable) or manual (free, no LLM); **entity-anchored** (route/day/activity/freeform) and collected in one **Decisions hub** + a persistent open-poll pin so nothing gets buried.
- **Open, changeable voting** (no blind ballot); **single + approval** modes (ranking deferred); closes by explicit action/deadline. Optional **vote-notes** that Trippy factors in when applying the winner.
- **Routes** are a first-class poll surface ("Vote on the plan" → winner feeds IG). Full spec in [documentation §6b](collaboration/documentation.md) + [design §7](collaboration/design.md).

### 7. Per-traveler preferences (the truly-collaborative layer)

- Each co-traveler tells Trippy what they want (beaches / museums / budget / pace / must-dos). Stored per (trip, user).
- Trippy synthesizes: _"Build an itinerary that satisfies everyone"_ → a plan that visibly accounts for each person. This is the differentiated, AI-native collaboration no competitor does well.

---

## Data model changes

| Table                        | Change                                                                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invite_links`               | Activate. Add `accept_invite(token)` SECURITY DEFINER RPC.                                                                                                                               |
| `trip_members`               | Keep self-insert-only RLS; membership added via the RPC. Surface all members (needs a read policy that lets members see co-members — today you can only read your _own_ membership row). |
| `activity_log`               | Activate. Written on every mutating action (app-side, or DB triggers). Add member-read RLS + realtime.                                                                                   |
| `notifications` (new)        | Per-user notification records (trip_id, actor_id, kind, payload, read_at).                                                                                                               |
| `notification_prefs` (new)   | Per (user, trip): mute, channel toggles.                                                                                                                                                 |
| `device_tokens` (new)        | Push targets: (user_id, platform, token/subscription, created_at).                                                                                                                       |
| `traveler_preferences` (new) | Per (trip, user): free-text + structured prefs fed to Trippy.                                                                                                                            |
| `polls` / `poll_votes` (new) | Optional group decisions (or reuse `brainstorm_votes`).                                                                                                                                  |
| `trip_messages`              | Confirm multi-user read/insert RLS; render author.                                                                                                                                       |

## RLS implications

- **Co-member visibility:** add a policy so any member can read the trip's `trip_members` (needed for avatars/attribution) — today it's self-only.
- **Itinerary editing already works for members:** `days`/`activities` INSERT/UPDATE/DELETE are gated on `role = 'edit'` members, which every co-traveler is in v1. No change needed for the core edit flow.
- **Trip-level metadata stays owner-only** (name, dates, `share_token`) — fine for v1; co-editing trip settings is out of scope.
- **Invites:** never loosen INSERT to arbitrary rows — gate through the RPC.

## Realtime plumbing

- `ALTER PUBLICATION supabase_realtime ADD TABLE trip_messages, activity_log, days, activities;`
- Client: one channel per open trip, `postgres_changes` filtered by `trip_id`, with RLS enforced (Supabase applies row-level filters to realtime).
- Presence (who's viewing / typing): optional nice-to-have via Realtime Presence.

## Notifications infrastructure (the expanded scope)

**Push:**

- Android: `@capacitor/push-notifications` + a Firebase project (FCM HTTP v1). Store the device token in `device_tokens` on login.
- Web/PWA: Web Push API + VAPID keys; add a `push` event handler to the Workbox service worker (vite-plugin-pwa `injectManifest` mode, or a custom SW).
- `send-push` edge function: given member IDs, look up tokens, call FCM + web-push.

**Email:**

- Provider: **Resend** recommended (simple DX, generous free tier). Add `RESEND_API_KEY` secret.
- `send-notification-email` edge function: batched digest template ("Here's what changed in your Tokyo trip").

**Orchestration:**

- A `notify` edge function (or DB trigger → queue) fans out: writes `notifications` rows, then dispatches push/email per each member's `notification_prefs`, with a debounce window to batch bursts.

## Trippy group intelligence (prompt/engine changes)

- Extend the chat request payload: `members[]` (id, name), `preferences[]` (per member), and author-tagged recent history.
- System-prompt additions: group framing, disagreement→compromise behavior, attribution ("Aisha asked for…").
- New action `create_poll`; keep everything else identical so the client `dispatchActions` path barely changes.
- **Credit attribution** — see open questions.

---

## Phasing

- **Phase 0 — Foundations:** realtime publication + client subscription scaffolding; `activity_log` writes on all mutations; co-member read RLS. _(Unblocks everything; invisible to users.)_
- **Phase 1 — Membership & invites:** `invite_links` + `accept_invite` RPC, `/join/:token` route, Members sheet (list/remove/revoke). Everyone equal editor.
- **Phase 2 — Shared Trippy chat:** multi-user `trip_messages`, author attribution, group context + preferences into the prompt, live message sync, concurrency handling.
- **Phase 3 — Activity feed:** feed UI + "since you were away" summary, inline undo, Trippy-summary context.
- **Phase 4 — Notifications:** in-app first, then push (FCM + web-push), then email digests + `notification_prefs`. _(Largest infra chunk.)_
- **Phase 5 — Collaborative depth:** per-traveler preferences synthesis + polls.

Each phase is shippable on its own; 0→3 delivers the core "plan together" promise, 4 drives re-engagement, 5 is the differentiator.

---

## The three original questions, answered

1. **Unilateral or voting?** Unilateral edits by default — transparent and reversible — with **opt-in polls** as the escape hatch for genuine group decisions. Gates on every edit would kill usage.
2. **Are travelers notified of changes + context?** Yes: an attributed activity feed plus push/email, and — uniquely — **Trippy's own natural-language rationale** is the context, captured for free from chat-driven edits.
3. **Truly collaborative flows?** The **shared Trippy conversation** is the headline one (the group reasons _with_ the AI together); backed by **per-traveler preference synthesis** ("satisfy everyone") and **polls**.

---

## Open questions / risks (need decisions before build)

1. **Credits — RESOLVED: pooled per-trip.** Every trip owns one shared credit balance; all AI actions on the trip deduct from it; any member can recharge it. Still needs pressure-testing (see documentation §Credits): migration of existing per-user balances, seeding new trips, non-refundability on leave, and the free-loader dynamic (one member burns the pool). Recommend running `/stress-test` on this before Phase 2.
2. **Chat concurrency — RESOLVED: serialize Trippy turns per trip.** Whole-object `update_day`/`update_route` actions make last-write-wins a silent clobber, so AI turns serialize (lock + heartbeat/auto-expiry); human messages never block; queued prompts run on fresh state. Granular actions are the future scale path. See documentation §6.
3. **Cross-user undo:** can Aisha undo Ravi's change? (Recommendation: yes — it's in the shared log — but notify the original actor.)
4. **Realtime scale/cost:** Supabase concurrent-connection limits at scale.
5. **Invite security:** token expiry defaults, revocation, single-use vs. reusable links, max members per trip.
6. **Abuse:** a malicious invitee — mitigated by undo + full activity log + owner remove-member, but worth an explicit stance.
7. **Push cross-platform lift:** FCM + web-push + SW handler is genuinely the heaviest slice; consider shipping Phases 0–3 with **in-app feed only** and treating push/email as a fast-follow if the timeline tightens.

---

## Suggested next step

This is a large, multi-phase build. Recommend formalizing into a **PRD index** (one per-phase PRD) via the `idea-to-prd` flow, and stress-testing the **credits/monetization** question (#1 above) before committing — it changes both the economics and parts of the architecture.
