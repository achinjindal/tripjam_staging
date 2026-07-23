# Phase 0a — schema reconciliation (DRAFT migrations)

> ⚠️ **DRAFT. NOT APPLIED. Do NOT copy into `supabase/migrations/` yet.**
> These files stage the Phase 0a reconciliation from `implementation-plan.md`. They are kept
> out of `supabase/migrations/` on purpose so a stray `db push` can't apply half-finished work.
> Finalize + get explicit approval, then move into `supabase/migrations/` with real timestamps
> and apply **prod-direct** per the deploy rules.

## Ground truth (verified 2026-07-20)

- **Exist in prod + staging but untracked in migrations:** `trip_members`, `invite_links`,
  `activity_log`, `comments`, `reactions`, `forks`, `fork_members`.
- **Exist in staging, MISSING in prod:** `polls`, `poll_votes`(assumed), `trip_preferences`,
  `trip_read_state`, `notification_prefs`.
- **Columns present:** `invite_links`(token,expires_at,role,created_by), `trip_members`(role,joined_at),
  `credit_transactions.trip_id`.
- **Columns missing (to add):** `activity_log.{summary,undo_payload}`,
  `trip_messages.{audience,directed_user_id}`, `trips.credit_balance`,
  `brainstorm_items.{last_modified_by,last_modified_at}`.

## Decisions (resolved 2026-07-20)

- **Staging out of scope.** Work prod-direct until launch; do not reconcile staging now. `03_…`
  creates the four missing tables in **prod**. Staging reconciliation is deferred to pre-launch.
- **Max-members cap = 8** (in `06_accept_invite.sql`).
- **`01` capture is deferred, not blocking.** The 7 drifted tables already exist in prod, so the
  functional migrations below apply prod-direct without it. `01` is launch-time hygiene (lets a fresh
  env rebuild those tables) and needs a prod `pg_dump` — do it before re-establishing staging.

## Files

**`02`–`07` were PROMOTED into `supabase/migrations/` on 2026-07-21** (timestamps
`20260721000001`–`000006`) and are applied prod-direct via `npm run db:push:prod`. They no longer
live here. Only the deferred capture stub remains.

| Promoted migration (`supabase/migrations/`) | Was | Status                                                       |
| ------------------------------------------- | --- | ------------------------------------------------------------ |
| `20260721000001_add_missing_columns.sql`    | 02  | ✅                                                           |
| `20260721000002_create_collab_tables.sql`   | 03  | ✅                                                           |
| `20260721000003_is_trip_member_and_rls.sql` | 04  | ✅                                                           |
| `20260721000004_realtime_publication.sql`   | 05  | ✅                                                           |
| `20260721000005_accept_invite.sql`          | 06  | ✅                                                           |
| `20260721000006_membership_lifecycle.sql`   | 07  | ✅ (owner-RLS repoint still deferred — RPCs work without it) |

| Still here                            | Status                  | Needs          |
| ------------------------------------- | ----------------------- | -------------- |
| `01_capture_drifted_tables.DRAFT.sql` | ⏸ deferred (pre-launch) | prod `pg_dump` |

## Pre-flight checks (run on prod BEFORE applying — one query each)

From the 2nd EM review. Each de-risks a specific migration that could fail or misbehave prod-only
(no staging net):

```sql
-- (a) 06: the defensive unique index aborts if duplicate memberships exist
SELECT trip_id, user_id, count(*) FROM trip_members GROUP BY 1,2 HAVING count(*) > 1;

-- (b) 04: is RLS already enabled on activity_log, and what policies exist?
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'activity_log';
SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'activity_log';

-- (c) 05: are days/activities/comments already in the realtime publication?
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- (d) 04 owner-fallback sanity: any trips whose creator has NO trip_members row?
SELECT count(*) FROM trips t
 WHERE NOT EXISTS (SELECT 1 FROM trip_members m WHERE m.trip_id = t.id AND m.user_id = t.created_by);
```

Expected: (a) zero rows; (b) tells you if enabling RLS is a cutover; (c) skip any already present;
(d) >0 confirms the owner-fallback in `04` is needed (legacy trips).

**Results (verified 2026-07-21) — all clear:**

- (a) **0 duplicate memberships** → `06` `ON CONFLICT` safe.
- (b) `activity_log` **RLS already enabled** + existing SELECT policy "Members can view activity log";
  **no INSERT policy** exists. → `04` no longer adds a duplicate read policy; it only adds the
  (missing, load-bearing) author-INSERT + service-role policy. `ENABLE` is a no-op.
- (c) **0 tables in `supabase_realtime`** → `05` adds all 7; nothing to skip.
- (d) **0 legacy trips** without a creator membership row → `04` owner-fallback kept as harmless insurance.
- bonus: `trip_members` already has UNIQUE `trip_members_trip_id_user_id_key` on (trip_id,user_id)
  → `06` defensive index removed as redundant.

## Applying (prod-direct)

`02`–`04` are Phase-0/foundation; `06`–`07` are Phase-1 (invites + membership lifecycle). To apply
each set: finalize → move into `supabase/migrations/` with real chronological timestamps →
`npm run db:push:prod`. **Requires explicit approval before the push** (every deploy is live).

Two deferrals need the prod `pg_dump` and are NOT blocking dev start:

- `04`'s `comments`/`reactions` RLS — left out until the dump reveals their existing policies (neither
  is used until Phase 6).
- `07`'s owner-only RLS repoint (`created_by`→`owner_id`) — the lifecycle RPCs work without it (they
  check `owner_id` internally as `SECURITY DEFINER`); the repoint just makes the declarative policies
  honour transferred ownership.
