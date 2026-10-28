# 09 — Collaboration & Sharing

Collaboration is **live in production**. A trip owner invites co-travellers by link or by username/email. Everyone on the trip is an equal editor of the itinerary, routes, Board and chat. The group shares a credit pool, an activity feed with undo, polls and per-traveller preferences, and changes sync live. Separately, any owner can publish a **read-only public link** (`/share/:token`).

Two flags gate the UI: `INVITE_ENABLED` (`src/members.js:10`, which gates members, invites, feed, polls, pool and preferences) and `REALTIME_ENABLED` (`src/realtime.js:21`). Both default to off in code, but `.env.production` sets `VITE_INVITE_ENABLED=true` and `VITE_REALTIME_ENABLED=true` (lines 9-10). The off default is a rollback lever, not the current state. Collab UI appears only on a **shared** trip: `isSharedTrip = INVITE_ENABLED && members.length > 1` (`src/App.jsx:8472`). A solo trip shows only the `＋ Invite` entry point.

The design intent is in `docs/collaboration/` (`documentation.md`, `v1-scope.md`). This doc follows the code; section 9 lists where the two differ.

---

## 1. Membership model

- **`trips.owner_id`** is the movable owner, and every owner right keys on it. It was added and backfilled from `created_by` in `supabase/migrations/20260721000006_membership_lifecycle.sql:13-14`. The trips UPDATE, DELETE and SELECT policies were moved from `created_by` to `owner_id` in `20261009000001_collab_authz_hardening.sql:137-150`. On insert, `set_trip_owner_default` forces `owner_id := created_by` and `credit_balance := 0` for any signed-in caller (`20261009000001:201-213`; trigger in `20260815000001_owner_id_on_create.sql:18`).
- **`trips.created_by`** is the historical creator. The `trips_protect_owner_columns` trigger silently pins it (`20261009000001:177`), so it can never change. That is needed because the regenerate path writes `created_by: session.user.id` in its payload (`src/App.jsx:11336`), and the Android APK cannot be patched. It confers no trip-level rights: no UPDATE, DELETE or SELECT on `trips`, and no part in any RPC. It still appears in some older child-table policies (section 9).
- **`trip_members`** holds `(trip_id, user_id, role)`, unique per pair. `role` is always `'edit'`. Invite links create `'edit'` rows (`20260721000007_invite_rpcs.sql:24-25`), and no other role is written anywhere, so every member is an equal editor. The trip list on Home is built from the caller's `trip_members` rows (`src/Home.jsx:130-135`).
- **The creator's own row** is inserted by the client right after the trip row. Drafts do this at `src/App.jsx:10688-10690`. A new trip saved from IG does it at `src/App.jsx:11404-11412` and aborts with "Failed to add you as trip member" if it fails. Trip IDs come from `crypto.randomUUID()` so the member row can be written without reading the trip back.
- **`is_trip_member(p_trip, p_uid)`** (`20260721000003_is_trip_member_and_rls.sql:11-17`) is a SECURITY DEFINER helper. Newer policies use it so a `trip_members` policy never subqueries `trip_members` (which recurses).
- **Capacity** is 8 members, enforced in `accept_invite` (`20260813000001_accept_invite_sweeps_targeted.sql:15,31-35`).
- **Names**: profiles RLS hides other users, so members come from the SECURITY DEFINER RPC `list_trip_members`, which returns usernames only (`20260730000002_member_usernames.sql:18`, called by `fetchMembers` at `src/members.js:18-33`).

---

## 2. Invites and joining

**Entry points.** The header button (`＋ Invite` when solo, an avatar stack when shared; `src/App.jsx:3129`) and the share sheet's "Invite to plan together" option (`src/App.jsx:17409-17414`) both open `MembersSheet` (`src/components/MembersSheet.jsx`, mounted at `src/App.jsx:20187`).

**Link invites.**

- "Copy invite link" calls `getInviteUrl` → `create_or_get_invite_link` (`MembersSheet.jsx:165-177`, `src/members.js:36-42`). Any member can call it (`20260721000007:11-30`). It reuses the newest unexpired `invite_links` token or mints one. Nothing sets `expires_at`, so a link lives until it is revoked.
- The owner sees "Revoke" (`MembersSheet.jsx:758-769`). It calls `revoke_invite_link`, which is owner-only and deletes **all** of the trip's links (`20260721000007:33-41`). Existing members stay.

**Targeted invites** (by username or email).

- `inviteByHandle` → `invite_user_by_handle` (`MembersSheet.jsx:96`; `20260730000001_targeted_invites.sql:60`) creates a pending `trip_invites` row.
- The invitee sees `PendingInvitesBanner` on Home and accepts or declines through `respond_invite` (`src/PendingInvitesBanner.jsx:82,112`).
- If no account matches an email, the sheet can email the join link (`invite_external`, `MembersSheet.jsx:633-640`).
- The owner or the original inviter can cancel a pending invite (`cancel_invite`, re-created NULL-safe in `20261009000001:323-345`).

**`/join/:token`.**

- `parseUrl` matches any `/join/<segment>` (`src/main.jsx:89-90`), so malformed links still reach the invalid-invite screen. The route renders whether or not the user is signed in (`src/main.jsx:268-289`). Only invite _creation_ is flag-gated.
- `JoinTrip` (`src/JoinTrip.jsx:48-60`) calls `get_invite_preview` (`20260721000007:44-68`). For a valid token it returns the trip name, destination, dates, member count and the link creator's username. For any other token it returns `{valid:false}`.
- **Signed in:** "Join trip →" calls `accept_invite` (`src/JoinTrip.jsx:63-84`). The RPC rejects expired tokens (`invalid_or_expired`), links whose creator has left (`inviter_left`) and full trips (`trip_full`). On success it inserts the member row with `ON CONFLICT DO NOTHING` and marks any pending targeted invite for that user as accepted (`20260813000001:17-48`). The UI shows "This trip is already full." or "This invite is no longer valid."
- **Signed out:** "Sign in to join" stashes the token in localStorage under `tripjam_pending_join_token` (`src/JoinTrip.jsx:10-25,87-90`). After sign-in, `takePendingJoin()` sends the user back to `/join/<token>` (`src/main.jsx:184-190`).
- Both accept paths set `tripjam_just_joined_<tripId>`. The next open of that trip shows the one-time `WelcomeSheet` (`src/App.jsx:8439-8447`, mounted at `src/App.jsx:20326`).

---

## 3. Managing members, leaving and deleting

The RPCs are thin wrappers in `src/members.js:70-94`. Their current definitions:

| RPC                              | Who        | Behaviour                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transfer_ownership(trip, user)` | owner      | The new owner must already be a member. Sets `owner_id` (`20260721000006:26-37`). This is the only way `owner_id` can change: the trigger blocks direct client writes (`20261009000001:185-189`).                                                                                                                                                                                  |
| `remove_member(trip, user)`      | owner      | Deletes the member's poll votes and vote-notes (`_cleanup_member_polls`), then their row. The owner cannot remove themselves (`use_leave_trip`) (`20260721000006:51-63`).                                                                                                                                                                                                          |
| `leave_trip(trip)`               | any member | `20261009000001:50-87`. A **non-owner** has their poll data cleaned and their row removed. This returns `'left'` and never deletes the trip, even if theirs is the last row. The **owner** gets `transfer_ownership_first` if anyone else is on the trip. Otherwise the trip is deleted (`'trip_deleted'`). A non-member gets `not_a_member`. The trip row is locked `FOR UPDATE`. |
| `delete_trip(trip)`              | owner      | Deletes the trip, and dependent rows cascade (`20261009000001:90-111`). Others get `not_owner`.                                                                                                                                                                                                                                                                                    |

**MembersSheet UI** (`src/components/MembersSheet.jsx:196-273`):

- Remove asks for confirmation ("Credits they added to the trip stay with the trip").
- An owner with co-travellers who taps Leave gets a "choose the new owner" picker. Picking someone runs `transferOwnership` then `leaveTrip` (`pickNewOwner`, `:260-273`).

**Home trip-list button** (`src/Home.jsx:68-122`, labels at `:559-566`). `isOwner = trip.owner_id === session.user.id`.

- **Owner** sees "Delete trip". The confirm names the co-travellers fetched with `fetchMembers`: "This deletes it for everyone: A, B will lose the itinerary, board, and chat too." The button reads **"Delete for everyone"** when others exist and "Delete trip" otherwise. It calls `rpc("delete_trip")`.
- **Co-member** sees "Leave trip" ("Everyone else keeps it, and the owner can invite you back"). It calls `leaveTrip`.

This replaced four client-side deletes that, run by a co-member, wiped the shared itinerary (`20261009000001:41-44`). The APK still runs the old path (section 9).

---

## 4. RLS summary (current, after the 2026-10 migrations)

`schema.sql` (repo root) is the baseline dump. Later migrations override it where cited. "Edit member" means a `trip_members` row with `role='edit'`, which today means every member.

| Table                                             | SELECT                                                                                                      | INSERT                                                                                                                                                                                    | UPDATE                                                                                                                   | DELETE                                                                                                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trips`                                           | members (`schema.sql:5621`) or `owner_id` (`20261009000001:149`). Anon has no direct access; see section 8. | `created_by = auth.uid()` (`schema.sql:5848`). The trigger then sets the owner and an empty pool.                                                                                         | owner (`20261009000001:144`) or any member (`20260730000003_member_coedit.sql:58-61`), both limited by the trigger below | owner only (`20261009000001:139`)                                                                                                                                      |
| `trip_members`                                    | own rows (`schema.sql:5862`) plus co-members via `is_trip_member` (`20260721000003:21-23`)                  | **only the owner adding themselves with `role='edit'`** (`20261009000001:116-123`). Every other join goes through `accept_invite` / `respond_invite`, so self-join is blocked.            | none                                                                                                                     | owner removing **others** (`20261009000001:128-134`). Leaving yourself must go through `leave_trip`.                                                                   |
| `days`                                            | members (`schema.sql:5558`)                                                                                 | edit members (`schema.sql:5491`, `5815`)                                                                                                                                                  | edit members or owner (`20261009000001:153-164`)                                                                         | edit members or owner (`20261028000001_days_delete_policy.sql:8-12`). Production had **no** days DELETE policy before this, so regenerates left the old days in place. |
| `activities`                                      | members, joined through `days` (`schema.sql:5519`)                                                          | edit members (`schema.sql:5481`, `5805`)                                                                                                                                                  | edit members (`schema.sql:5500`)                                                                                         | edit members (`schema.sql:5471`)                                                                                                                                       |
| `trip_todos` / `trip_bookmarks` / `trip_expenses` | creator (`created_by`) or any member, for all four verbs (`20260428000004_fix_rls_policies.sql:6-70`)       | same                                                                                                                                                                                      | same                                                                                                                     | same                                                                                                                                                                   |
| `trip_messages`                                   | members (`schema.sql:5586`)                                                                                 | members writing their own `user_id` (`schema.sql:5577`), or members writing a Trippy row (`role='assistant'`, `user_id IS NULL`) (`20260722000001_trip_messages_assistant_rls.sql:15-21`) | none                                                                                                                     | none                                                                                                                                                                   |
| `brainstorm_items` (routes)                       | creator or members (`schema.sql:5630`)                                                                      | creator or members (`20260730000003:28-33`)                                                                                                                                               | creator or members (`20260730000003:36-45`)                                                                              | creator or members (`20260730000003:48-53`)                                                                                                                            |

**`trips_protect_owner_columns`** (BEFORE UPDATE, `20261009000001:170-197`; trigger created at `20260730000003:83-85`) runs only for signed-in callers. Service-role writes such as payments and AI charges are exempt.

- `created_by` is always reset to its old value, silently.
- `credit_balance` cannot change: "pooled credits change only through a purchase or an AI charge". This applies to the owner too.
- `owner_id` cannot change from the `authenticated` or `anon` roles; only `transfer_ownership` can move it.
- `share_token` can be changed only by the owner: "co-travellers cannot change the share link".

**Other collab tables.**

- `activity_log`: members read it (`schema.sql:5529`). Authors insert their own rows as a member or as the `created_by` creator (`20260721000003:35-46`).
- `polls`: members read, create and update (`20260721000003:78-88`). `poll_votes` writes are limited to the voter's own rows (`20260805000002_polls_phase6.sql:54-73`). Poll notes live in `comments` (`20260805000002:89-124`). Only the poll's creator or the trip owner can call `close_poll`, and anon cannot (`20261009000001:347-374`).
- `trip_invites`: readable by the invitee and by members. All writes go through RPCs (`20260730000001:43-50`).
- `_cleanup_member_polls` and `incr_rate_limit` are no longer callable by clients (`20261009000001:418-422`).

---

## 5. Pooled credits

- The pool is `trips.credit_balance`. Members fund it from `TripCreditsSheet` (`src/CreditsOverlay.jsx:697`, mounted at `src/App.jsx:20359`) through `create-checkout` / `revenuecat-verify`, which accept an optional `trip_id`.
- **`resolve_credit_source(user, trip, prefer_personal)`** (`20261009000001:216-264`) decides who pays:
  - no trip, or a trip that is not saved yet → `personal`;
  - an existing trip the caller neither owns nor belongs to → **`denied`**;
  - an explicit opt-in → `personal`;
  - one member or fewer → `personal`;
  - otherwise → `pool`.
- **`resolveAndGate`** (`supabase/functions/_shared/credits.ts:287-357`) is the mandatory pre-flight in every gated function (for example `chat/index.ts:165`, `generate-itinerary/index.ts:421`).
  - `denied` → **403 `not_a_member`** (`:323-334`), so no AI call runs or bills against someone else's trip.
  - A pool below `poolMin` → **402 `empty_trip_pool`** (`outOfPool`, `:263-278`). The client opens the fork paywall and leaves the personal balance alone (`handleGatedResponse` returns the string `"empty_trip_pool"`, `src/credits.js:137-150`).
  - Otherwise it returns `source`, which must be threaded into `deductCredits`.
- **`deduct_credits`** debits the pool only when the caller is a member or the owner, and falls back to the personal wallet otherwise (`20261009000001:285-291`).
- **Leaving or removal** keeps funded credits with the trip. **Deleting the trip loses whatever is left in the pool.** This was a product decision (`20261009000001:43-44`), and there is no refund.

Credit mechanics are covered in [10 — Credits & payments](10-credits-and-payments.md).

---

## 6. Shared chat, feed, polls, preferences and realtime

**Shared chat.** Every member's messages and every Trippy reply live in `trip_messages` and stream to the others. On a shared trip the composer can address Trippy, Everyone or one person. A human-addressed message skips the AI and costs nothing (`sendHumanMessage`, `src/App.jsx:13623`; branch at `src/App.jsx:13659`). Persistence, change cards and the server side are in [08 — Chat](08-chat.md).

**Activity log and feed.**

- `logActivity` (`src/activity.js:40-66`) writes one `activity_log` row per mutation, with an optional `undo_payload`. It is fire-and-forget, swallows every error, and runs on solo trips too.
- DB triggers add info rows for member joins and pool top-ups (`20260806000001_phase3_feed.sql:41-81`).
- `ActivityFeed` (`src/components/ActivityFeed.jsx`, opened from the 🔔 bell, mounted at `src/App.jsx:20376`) lists rows newest first, with inline Undo.
- `handleUndo` (`src/App.jsx:12370-12400`) calls `undoActivity` (`src/feed.js:203-268`). If the entity was edited since, it warns and offers "Undo anyway" (`hasLaterEdit`, `src/feed.js:182-193`). It then logs an `undo` row.
- **Undo hides once its day is gone.** `isUndoable(row, liveDayIds)` (`src/feed.js:89-95`) returns false for `update_day`, `update_activity` and `remove_activity` rows whose `undoDayId` (`:98-110`) is not among the live days. A regenerate replaces every day id, so there is nothing to restore into. `liveDayIds` is built at `src/App.jsx:8189` and passed in at `src/App.jsx:20382`. The check is UI-only: `undoActivity` itself calls `isUndoable(row)` with no day set.

**While you were away and Welcome.**

- `WhileAwaySheet` (mounted at `src/App.jsx:20386`) opens once per trip-open when other members made changes before you opened it and after your `trip_read_state.last_seen_at` (`src/App.jsx:8503-8552`; `markSeen`, `src/feed.js:47-57`).
- `WelcomeSheet` is the one-time briefing after you join. It absorbs the away digest, so the two sheets never chain (`src/App.jsx:8541-8547`).

**Polls.**

- `src/polls.js` and `src/components/Polls.jsx` (`PollComposeSheet`, mounted at `src/App.jsx:20367`).
- Polls attach to a day, an activity or nothing. They are single-choice or approval, with vote-notes. They cost nothing; only applying an anchored winner goes through Trippy.
- A vote touches `polls.updated_at` by trigger, so tallies update live.

**Preferences.** Each traveller's style lives in `trip_preferences` (`PreferencesSheet`). Trippy reads all of them on shared trips.

**Realtime** (`src/realtime.js`):

- There is one channel per open trip. It filters `trip_id=eq.<id>` on `days`, `trip_messages`, `activity_log`, `polls`, `brainstorm_items`, `trip_members`, `trip_preferences`, `trip_todos`, `trip_expenses` and `trip_bookmarks` (`:24-36`).
- `activities` has no `trip_id`. Instead, a trigger touches `days.updated_at` on every activity write (`20260804000002_realtime_coedit.sql:19-30`), so the `days` handler picks the change up.
- The handlers in `src/App.jsx:8202-8388` **reconcile from the database** with a debounce rather than patching from the payload. Chat messages and feed rows are appended, deduped by id. Board events bump `boardTick`.
- On a solo trip, every handler except `trip_members` returns early, so the owner still sees the first joiner arrive live.
- `onSubscribed` runs a backfill on connect and reconnect (`:8303-8313`), because `postgres_changes` does not replay missed events. The backfill does **not** refetch `trip_messages` (section 9).
- Only the three Board tables are `REPLICA IDENTITY FULL` (`20260807000001_tier2_board_realtime.sql:31-33`). For every other table, a **DELETE does not reach a filtered subscriber**.

---

## 7. Regenerating a shared trip

Any edit member can regenerate. The days and activities are saved through **`replace_trip_days(p_trip, p_days)`** (`supabase/migrations/20261028000002_replace_trip_days.sql:32-126`):

- It is SECURITY INVOKER, so the RLS policies apply.
- It requires an edit-member row (`:62-66`).
- It takes a per-trip advisory lock, so two members regenerating at once cannot interleave (`:70`).
- It deletes every day (activities cascade), checks the delete really happened, then inserts the new days and activities. All of this is **one transaction**: either the whole new plan lands, or the old plan is untouched.

The RPC has two callers:

- **IG save** (`handleGenerate`, `src/App.jsx:11475-11519`): it saves the days first and updates the trip row only afterwards. Co-travellers see the new plan through the day INSERT events.
- **Regenerate routes / Edit Details** (`doSetupComplete`, `src/App.jsx:10621-10626`): it calls the RPC with `p_days: []` to clear the itinerary.

**Known gap:** the clear-only call produces only `days` DELETE events. `days` is not `REPLICA IDENTITY FULL`, so filtered realtime never delivers them. Co-travellers keep seeing the old itinerary until something else touches `days` or they reload.

Replacing an itinerary is still destructive. There is no plan history, and the old day ids die, which is why feed undos for them hide (section 6).

---

## 8. Public read-only share link (`/share/:token`)

A read-only, anonymous view of the itinerary. It is separate from membership: viewers do not join the trip.

**Token.**

- `trips.share_token` is a nullable uuid (`20260406000003_add_share_token_to_trips.sql`). It is generated lazily the first time someone shares (`UPDATE trips SET share_token = crypto.randomUUID()`).
- With `INVITE_ENABLED` on, the header Share button opens the share sheet (`src/App.jsx:14472-14478`). The sheet starts at `src/App.jsx:17358` and offers four options:
  - "Invite to plan together", which opens MembersSheet;
  - "Share as image", which renders an html2canvas card;
  - "Copy as text";
  - **"Share a view-only link"** (`:17558-17585`).
- **"Revoke share link"** (`:17620-17640`) sets `share_token = null`. Sharing again mints a new token.
- The trigger lets only the **owner** change `share_token`. For a co-member, creating or revoking the link fails without any message (section 9).

**Routing.** `parseUrl` matches `/^\/share\/([a-f0-9-]{36})$/` (`src/main.jsx:83-84`). `<TripPublicView>` renders before any session logic (`src/main.jsx:252`).

**Read path.**

- `TripPublicView` calls `supabase.rpc("get_shared_trip", { p_token })` with the anon key (`src/TripPublicView.jsx:182`).
- The RPC is a SECURITY DEFINER function granted to `anon` and `authenticated` (`20260713000001_share_token_rpc.sql:14-63`). It matches the token exactly and returns only five trip fields (`name`, `destination`, `start_date`, `end_date`, `summary`) and the days with their activities' `icon`, `time`, `title`, `note`, `duration` and `photo_url`. An unknown or revoked token returns `{trip:null}`.
- Board data, chat, routes and members are never exposed.
- The anon SELECT policies that once allowed every shared trip to be listed were dropped in that migration (`:10-12`).

---

## 9. Known gaps and spec-vs-code differences

**Gaps.**

- **The Android APK runs its bundled old client until a Play update.**
  - Its Home delete still runs the four client-side deletes (`activities` → `days` → `trip_members` → `trips`). The `trip_members` and `trips` deletes are now refused. But edit members may delete `activities` and, since `20261028000001`, `days`. So **a co-member on an old APK who taps Delete wipes the shared itinerary for everyone**. The trip then reappears on their own list after a reload.
  - Its IG save is the old non-atomic path: a separate day delete followed by per-row inserts.
  - The only levers are `app_config.min_client_build` (`src/UpdateGate.jsx`) or a Play update (RUNBOOKS.md, "Client version gate").
- **Chat reconnect catch-up:** the realtime backfill does not refetch `trip_messages`, so messages missed while offline appear only after a reload. This is `test.fail` in `e2e/collab-chat-deep.spec.ts:374-377`.
- **Shared undo state:** a chat change card's "Undone" state is local to the person who undid it. Other members don't see it, and the undoer loses it on reload. These are `test.fail` in `e2e/collab-chat-deep.spec.ts:298-301` and `:313-316`.
- **Regenerate clear-only:** a clear-only call is invisible to co-travellers (section 7).
- **Owners without a member row:** about 40 staging trips have an owner with no `trip_members` row, left over from the old self-delete hole (`20261009000001:32-35`). These owners can't see the trip on Home (the list is built from `trip_members`). They can't regenerate either, because `replace_trip_days` requires an edit-member row even though the days policies allow the owner.
- **Share link for co-members:** the share sheet shows "Share a view-only link" and "Revoke share link" to co-members. The trigger rejects both, and the UI shows no message.
- **MembersSheet sole-member copy:** the sheet warns "leaving deletes the trip" for any sole member. For a non-owner, `leave_trip` now only removes their row.

**Where the code differs from `docs/collaboration/`.**

- **"Last member leaves → trip deleted"** (`documentation.md:201`, `v1-scope.md`): only the **owner** can delete, through `leave_trip` when alone or through `delete_trip`. A non-owner never deletes the trip.
- **"Owner generates an invite link"** (`documentation.md:154`): any member can create or reuse a link. Only revoking is owner-only. Links never expire unless revoked.
- **"Keep self-insert-only INSERT" on `trip_members`** (`documentation.md:75`): self-insert is now limited to the owner. Spec-era code that let any user join any trip was the self-join hole.
- **`created_by` "stays immutable"**: it does stay immutable, enforced by the trigger. But it still grants access in policies the hardening didn't touch: `brainstorm_items` (all verbs), `trip_todos`/`trip_bookmarks`/`trip_expenses` (all verbs) and the `activity_log` insert fallback. A creator who was removed or transferred ownership can therefore still read and write those rows if they know the trip id.
- **"Rebuild … saved to history, restore anytime"** (`documentation.md:402`, Phase 7, deferred): there is no history, and regenerating replaces the plan.

---

## Key files

- `src/members.js`: membership and invite RPC wrappers, `INVITE_ENABLED`.
- `src/components/MembersSheet.jsx`: invite link and revoke, targeted invites, remove, leave, transfer.
- `src/JoinTrip.jsx`, `src/PendingInvitesBanner.jsx`: link and targeted accept flows, pending-token stash.
- `src/main.jsx`: `/join/:token` and `/share/:token` routing, resuming a pending join.
- `src/Home.jsx`: owner "Delete trip" (`delete_trip`) vs co-member "Leave trip" (`leave_trip`).
- `src/realtime.js`: per-trip channel. Reconcile handlers are in `src/App.jsx` (search `subscribeTrip`).
- `src/activity.js`, `src/feed.js`, `src/components/ActivityFeed.jsx`, `src/components/WhileAwaySheet.jsx`, `src/components/WelcomeSheet.jsx`: feed, undo, away and welcome.
- `src/polls.js`, `src/components/Polls.jsx`: polls.
- `src/CreditsOverlay.jsx` (`TripCreditsSheet`), `supabase/functions/_shared/credits.ts` (`resolveAndGate`, `outOfPool`): pooled credits.
- `src/TripPublicView.jsx`: anonymous read-only view.
- `supabase/migrations/20260721000003_is_trip_member_and_rls.sql`, `20260721000005`–`0008`, `20260730000001`–`0003`: helper, invites, lifecycle, pool, co-edit.
- `supabase/migrations/20261009000001_collab_authz_hardening.sql`: owner-keyed rights, self-join block, `leave_trip`/`delete_trip`, owner-columns trigger, pool membership checks.
- `supabase/migrations/20261028000001_days_delete_policy.sql`, `20261028000002_replace_trip_days.sql`: days DELETE policy and atomic itinerary replace.
- `supabase/migrations/20260713000001_share_token_rpc.sql`: `get_shared_trip`.
- `schema.sql`: baseline RLS for `trips`, `days`, `activities`, `trip_messages`, `brainstorm_items`.
- E2E: `e2e/collab-*.spec.ts` (invite, p0p1, chat, chat-deep, feed, polls, board-sync, launch-gaps, ux-fixes).
