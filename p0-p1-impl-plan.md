# P0 + P1 gaps — implementation plan

Branch: `collab-tier2` (worktree `/Users/achinjindal/Documents/Code/tj-p56-wt`).
Source: collab-journey-gaps analysis (artifact d171e953). All work gates on
`INVITE_ENABLED`; solo trips stay byte-identical unless noted. One commit per
workstream, in the order below. Migrations applied to staging via SQL editor
(management API) AND checked in as migration files (matching how earlier collab
migrations were applied; `db push` has known history drift — do not use it).

External dependency: **RESEND_API_KEY** (+ `EMAIL_FROM`) — the send-email
function must no-op gracefully (`{disabled:true}`) when unset so everything
ships dark until the founder creates the Resend account.

---

## WS0 — Ghost-styles bug fix (do first, smallest)

Removed members' `trip_preferences` rows still feed RG/IG/chat as "Traveler".

- RG: BrainstormView `generate()` `travellerStyles` builder — add
  `.filter((p) => members.some((m) => m.user_id === p.user_id))`.
- IG: `handleGenerate` `igBody.travellerStyles` builder — same filter.
- Chat: `preferencesList` in `callUnifiedChat` — same filter
  (members in scope at all three sites).
- No server change (server trusts the client list).

## WS1 — Gap 1: email invite dead end (P0)

Current: `invite_user_by_handle` → `user_not_found` for any email without an
account; MembersSheet sets `setNotFound(h)` (VERIFY what that renders).

1. **Stopgap UX** (works without Resend): when the failed handle looks like an
   email (`/.+@.+\..+/`), the not-found hint becomes:
   "No TripJam account for that email yet." with two actions:
   - **Email them an invite** (only when email sending is enabled — probe via
     the send-email response, see WS2; hide button on `disabled:true`)
   - **Copy invite link** — calls the existing `createInviteLink(tripId)` and
     copies the /join URL (same code path as the link row).
   For a non-email handle, keep today's hint.
2. **Email path**: on "Email them an invite":
   `createInviteLink(tripId)` → POST `send-email`
   `{ type: "invite_external", tripId, toEmail, joinUrl, tripName, inviterName }`
   → toast "Invite emailed to <email>" / fallback toast with the copy-link
   action if `disabled`.
3. No schema change: external email invites ride the LINK flow (the email just
   delivers the link). `trip_invites` stays accounts-only.

## WS2 — Gap 3: Phase 4 minimal slice (P0)

**New edge function `supabase/functions/send-email/index.ts`:**

- Auth: `authenticateUser` from `_shared/credits.ts`; verify sender is a member
  of `tripId` (service-role query on trip_members; owner counts).
- `RESEND_API_KEY` unset → `200 {disabled:true}` (no error noise).
- Types + recipients:
  - `invite_external` — `toEmail` from payload (WS1). Rate limit: reuse
    `rateLimit(user.id, ...)` + hard cap 10 external invite emails per
    user per day via a service-role count on a lightweight log (see below).
  - `invite_member` — targeted invite to an EXISTING account:
    payload `{targetUserId}`; look up email via service-role
    `auth.admin.getUserById`; skip addresses ending `@tripjam.app` (legacy
    fake-email shim accounts).
  - `poll_opened` — payload `{pollTitle, tripUrl}`; recipients = all trip
    members except sender (emails via auth admin, same fake-email skip).
  - `itinerary_ready` — payload `{tripName, tripUrl}`; recipients = all trip
    members except sender.
- All sends logged (fire-and-forget) to a new `email_log` table
  `(id, type, trip_id, sender_id, recipient, created_at)` — powers the
  daily cap + debugging. Migration `20260811000001_email_log.sql`
  (service-role only; no client RLS access needed — RLS enabled, no policies).
- From: `EMAIL_FROM` env (default `TripJam <trips@tripjam.app>`).
- Templates: inline HTML strings, warm-palette minimal (logo text, one
  sentence, one button). No template engine.
- URLs come from the client (`window.location.origin` based) so previews link
  to previews and prod to prod.

**Trigger call sites (all fire-and-forget, wrapped in try/catch):**

- Targeted invite success in MembersSheet (`inviteByHandle` resolves) →
  `send-email {type:"invite_member", targetUserId}` (VERIFY the RPC returns the
  target user id — if only username, resolve via the pending-invites shape or
  extend the RPC return; prefer no RPC change: VERIFY `res` shape).
- Poll create success (PollComposeSheet onCreate / `createPoll` resolver —
  VERIFY exact call site) → `{type:"poll_opened", pollTitle}`.
- IG detailed completion (the code path that records `detailed_ready_at`,
  App.jsx ~9057/9231 — VERIFY the exact success point that runs once) →
  `{type:"itinerary_ready"}` — only when `isSharedTrip`.

Deploy `send-email` to staging; note in RUNBOOKS-style comment that prod needs
`supabase secrets set RESEND_API_KEY EMAIL_FROM`.

## WS3 — Gap 6: route consensus checkpoint (P1)

- Entry: `handleBuildFromBrainstorm(votedItems)` (App.jsx ~8384) — the single
  funnel from route selection to the pre-IG sheet (VERIFY both mobile/desktop
  CTAs go through it).
- On shared trips (`members.length > 1`):
  - Determine the chosen route (`votedItems` tier-1 with vote === 1 — VERIFY
    shape) and OTHER members' votes. VERIFY how votes persist:
    `castVote`/`brainstorm_votes` — columns + whether other members' votes are
    fetched into state (localVotes vs DB). If other-member votes aren't
    available client-side, fetch `brainstorm_votes` for the trip's tier-1 items
    at checkpoint time (one query).
  - If every other member has a vote on the chosen route → proceed silently.
  - Else show a confirm sheet (reuse `confirmSheet` from dialogs.jsx if it
    supports two actions — VERIFY; else a small inline sheet):
    title "«N» of «M» travellers haven't weighed in on this route",
    body names them; actions:
    - **Ask the group** → `createPoll` (approval mode, freeform anchor)
      "Build the itinerary from «routeLabel · title»?" with options
      Yes / Let's discuss → close sheet, toast "Poll posted to the group"
      (+ WS2 poll_opened email rides the normal poll path). Do NOT proceed
      to IG.
    - **Build anyway** → continue exactly as today.
- Solo trips: zero change (guard first).

## WS4 — Gap 9: expense splitting (P1)

**Migration `20260811000002_expense_split.sql`:**
```sql
ALTER TABLE trip_expenses
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS split_mode text NOT NULL DEFAULT 'none';
-- 'none' (solo/default, today's behavior) | 'even' (split across members)
```
(RLS already member-scoped via existing policies — VERIFY trip_expenses
policies cover members, not just owner, on this branch.)

**UI (BoardView Expenses widget, shared trips only):**
- Add-expense row gains a payer picker: member avatar chips, default = self;
  choosing a payer sets `paid_by` + `split_mode: 'even'` on insert.
- Existing expense rows: show payer initial chip when `paid_by` set.
- Balances panel under the category totals: for expenses with
  `split_mode='even'` and `paid_by`, each member's share =
  amount / current-member-count; net balance per member; settle-up lines via
  greedy netting ("Ravi → Achin ₹1,240"). Skip `is_planned` rows
  (planned ≠ spent — VERIFY the field semantics).
- Multi-currency: group balances per currency (no FX). Solo trips: widget
  unchanged (no picker, no panel).
- Realtime already covers trip_expenses (Tier 2) — balances update live.

## WS5 — Gap 5: passenger lane (P1)

1. **Quick tags** on PreferencesSheet: six pills
   🏖 Beaches · 🥾 Hikes · 🍜 Food · 🎨 Culture · 😌 Relaxed · 🌙 Nightlife.
   Toggle state seeds from `prefs_struct.tags`; Save writes
   `savePreferences(tripId, userId, text, {tags})` (4th arg exists).
   Consumption: everywhere styles feed LLMs (RG/IG/chat builders from WS0),
   compose `text + (tags.length ? " Tags: " + tags.join(", ") : "")` —
   and a tags-only save (empty text, some tags) COUNTS as a shared style
   (update the `prefs_text` filters to `prefs_text || prefs_struct.tags?.length`
   — VERIFY every site: counter, nudge, chip, stylesForLLM ×3).
2. **Reactions** — CONTINGENT: inspect the pre-existing `reactions` table
   schema on staging first (columns unknown; RLS explicitly deferred in
   20260721000003). If schema is usable (entity_type/entity_id/user_id/emoji
   -shaped): migration `20260811000003_reactions_rls.sql` (member SELECT via
   trip, self INSERT/DELETE), then 👍/😍/😬 chips on route cards (tier-1
   brainstorm items; entity_type 'route', entity_id item id) with counts,
   realtime optional (skip publication; refetch on boardTick not applicable —
   fetch on trip open + optimistic local update only).
   If schema doesn't fit → CUT reactions from this pass, note in commit.

## WS6 — Gap 4: join briefing (P1)

- JoinTrip accept path (`acceptInvite(token)` → redirect): set
  `localStorage tripjam_just_joined_<tripId> = "1"` before redirect (VERIFY
  how redirect happens — full page nav loses React state, localStorage is the
  bridge).
- App trip-open effect: if flag present (and INVITE_ENABLED + shared), clear it
  and show a one-time **WelcomeSheet** (new component, PreferencesSheet-style
  centered modal, zero LLM):
  - Title: "You're on the trip 🎉" · trip name + dates.
  - Deterministic summary lines from state: destination + N days; route
    chosen? ("Route picked: «title»" / "«N» route ideas on the table");
    itinerary built? ("Day-by-day plan is ready"); open polls count; member
    first-names.
  - CTAs: **Share your style** (opens PreferencesSheet; also write the style
    nudge's localStorage key so the separate nudge doesn't double-fire) ·
    **Look around** (dismiss).
- Guard: only fires when the flag exists — organic navigation unaffected.

## WS7 — Gap 2: share sheet merge (P1)

- VERIFY the Share button implementation (trip header; `share_token` copy
  flow) — likely a direct copy/native-share handler.
- When `INVITE_ENABLED` and the viewer can invite: Share button opens a small
  sheet with two rows:
  - **Invite to plan together** — "They join the trip and can edit" → opens
    MembersSheet (the existing invite surface).
  - **Share a view-only link** — "Anyone can look, nobody can change" →
    existing share_token copy/native-share behavior.
- `INVITE_ENABLED` off (prod today): Share behaves exactly as now (guard).

## WS8 — Gap 7: pool top-up request (P1)

- `ForkPaywallSheet` (CreditsOverlay.jsx ~468) gains a secondary action on
  shared trips: **Ask the group to top up**.
- Implementation: insert a plain human message into `trip_messages`
  (VERIFY the exact insert shape used by the free human group chat path —
  role/audience/user_id columns) with content
  "«name» is out of trip credits — top up in Members → Trip Credits to keep
  Trippy going." Free (no LLM), realtime delivers it to everyone.
- VERIFY ForkPaywallSheet has access to trip id + session (it's module-level —
  check its props/store) — may need the requesting context passed through
  `openForkPaywall` payload.
- Descoped consciously: owner "auto-cover from my wallet" setting (money
  consent needs its own design pass).

---

## Rollout / verification

1. Per-WS: prettier + lint + `typecheck` + build; commit per WS.
2. Migrations: apply `email_log`, `expense_split` (+ `reactions_rls` if kept)
   to STAGING via management-API SQL; files checked in for the record.
3. Deploy `send-email` to staging (works `disabled` until RESEND_API_KEY set).
4. Staging pass: invite non-user email (stopgap UX), expense split balances
   with 2 accounts, consensus sheet with divergent votes, welcome sheet on a
   fresh join, share sheet both rows, top-up request lands in chat.
5. Push `collab-tier2` (preview) after founder look.
6. NOT in scope: prod deploys, push notifications, digest, Phase 7 rebuild,
   owner auto-cover, reactions realtime.

## VERIFY list for the reviewer (unknowns I want checked, with line refs)

- MembersSheet `notFound` render + `inviteByHandle` result shape (target user
  id present?).
- Vote persistence: `castVote` → where? `brainstorm_votes` columns; are OTHER
  members' votes fetched anywhere client-side today?
- `handleBuildFromBrainstorm` as the single build funnel (mobile + desktop).
- `confirmSheet` API — supports custom two-action sheets?
- Poll creation call site for the WS2 hook + `createPoll` signature (modes,
  anchor types) for WS3's poll.
- IG completion single-fire point for `itinerary_ready`.
- `trip_expenses` RLS on this branch (member-scoped?) + `is_planned` semantics.
- `savePreferences` 4th arg (prefs_struct) actually persists.
- Every site that gates on `prefs_text` (counter, nudge, chip, 3× LLM
  builders) for the tags-only-style change.
- `reactions` table columns on staging (management-API query fine).
- JoinTrip redirect mechanism (React nav vs location.href).
- Free human group-chat message insert shape (trip_messages columns + how
  non-Trippy messages are posted today).
- ForkPaywallSheet props/store — can it know tripId?
- auth.admin.getUserById availability in edge runtime with service role key
  (vs querying auth.users via PostgREST — pick the one that works).

---

# REVIEW AMENDMENTS (independent eng review, 2026-08-11 — all adopted)

- **WS3 redesign:** votes were LOCAL-ONLY (`castVote` → setLocalVotes; brainstorm_votes
  table exists on staging but zero src references). Now: persist tier-1 votes
  (delete-own-rows-then-insert into brainstorm_votes on castVote, fire-and-forget);
  checkpoint moves to `openPreIgSheet` (the true shared funnel for both CTAs — BEFORE
  the pre-IG sheet, not after); fetch all members' votes on demand at checkpoint.
  Inline two-action sheet (confirmSheet can't distinguish dismiss from confirm).
  Consensus poll: mode 'single', options Yes / Let's discuss; refresh App polls after.
- **WS5:** reactions CUT (staging schema is comment_id-scoped, RLS-less). Quick tags
  only; tags-only saves count as a shared style at all 7 prefs_text gates
  (App 2019, 2662, 7072, 8636, 10116; PreferencesSheet 24, 31); savePreferences
  always receives the struct from the sheet.
- **WS1/2:** send-email built FIRST with a `{type:"config"}` probe (returns
  {enabled}); MembersSheet probes once on open. `getInviteUrl` (not createInviteLink).
  invite_member target resolved from list_trip_invites.invitee_user_id after reload.
  Recipient emails via service-role select on public.profiles.email (auth.users is
  NOT PostgREST-readable; profiles.email exists and is what invite_user_by_handle uses),
  skipping @tripjam.app shims. Server-side dedupe: itinerary_ready skipped if
  email_log has same trip+type in 24h. poll_opened hook lives in polls.js createPoll
  via new src/notify.js helper (token from supabase.auth.getSession) so the WS3
  consensus poll emails too.
- **WS4:** thread members+session into ExpensesView (had neither); add split_count
  (member count frozen at insert) so past splits don't drift.
- **WS6:** just-joined flag also set on PendingInvitesBanner accept path.
- **WS7:** two share surfaces exist — direct handler (App 11177) + showShare sheet
  (13601). Merge: direct button opens the sheet when INVITE_ENABLED; sheet gains
  "Invite to plan together" row.
- **WS8:** CreditsOverlay imports supabase; requester name passed through
  openForkPaywall payload; audience 'everyone'; note: invisible until reload
  without realtime flag.
