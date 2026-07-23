-- ============================================================================
-- staging_sync.sql — ONE-OFF reconciliation to bring STAGING in line with PROD
-- for the collaboration feature.  Project: wlrzvwjdrjpfqcwgmzch (staging).
--
-- WHY THIS FILE EXISTS
--   The 7 collab migrations (20260721000001 .. 20260721000007) were applied to
--   PROD only. Staging is behind — probing via the anon REST API (2026-07-21)
--   confirmed staging is MISSING all collab columns, all 5 collab tables, and
--   all 8 collab RPCs (calibrated against known-fake object names + correctly
--   named RPC params, so the "missing" signal is trustworthy).
--
-- WHAT THIS IS
--   The verbatim concatenation, in order 000001 -> 000007, of the seven collab
--   migration bodies. Every statement is idempotent by construction
--   (ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS
--   ... CREATE, CREATE OR REPLACE FUNCTION, guarded ALTER PUBLICATION, guarded
--   ADD CONSTRAINT). It is therefore safe to run over staging's current drift and
--   safe to re-run.
--
-- HOW TO APPLY  (pick ONE; you need a human with DB access — the anon key cannot
-- run DDL)
--   OPTION A — Supabase migration runner:
--       npm run db:push:staging
--     Applies ALL pending migrations for staging (needs the staging DB password
--     at the prompt). Applies the canonical migration files, not this concat.
--     Caveat: also applies any OTHER unrelated pending migrations on staging.
--
--   OPTION B — Supabase SQL Editor  (RECOMMENDED, no password):
--     Open the staging project's SQL Editor and paste + run this entire file.
--     Applies ONLY the collab objects — nothing unrelated — and gives you a
--     controlled, reviewable one-shot. Preferred for this reconciliation.
--
-- POST-APPLY VERIFICATION
--   Re-run the anon REST probes (or the SQL below) and confirm:
--     - activity_log.summary / .undo_payload resolve (no 42703)
--     - trip_messages.audience / .directed_user_id resolve
--     - trips.credit_balance / .owner_id resolve
--     - brainstorm_items.last_modified_by / .last_modified_at resolve
--     - tables trip_preferences, trip_read_state, notification_prefs, polls,
--       poll_votes exist (no PGRST205)
--     - RPCs is_trip_member, accept_invite, transfer_ownership, remove_member,
--       leave_trip, create_or_get_invite_link, revoke_invite_link,
--       get_invite_preview resolve (no PGRST202 with correct params)
--
-- SHAPE-DIVERGENCE CAVEAT (READ BEFORE APPLYING)
--   IF NOT EXISTS / CREATE OR REPLACE will NOT reshape an object that already
--   exists. The 2026-07-21 probe found NONE of the 5 collab tables present on
--   staging, so there is currently no pre-existing experimental copy to collide
--   with. But if staging drifts before you apply, first confirm each of the 5
--   tables is still absent; if any is present with a different shape (missing
--   expected columns), DROP + recreate it (it is QA-only / empty) so it matches
--   the canonical shape in migration 000002 before/after running this file.
--
--   Migration 000006 also notes an RLS repoint of existing `trips`/invite
--   owner-only policies from created_by -> owner_id that is NOT in these files
--   (it needs the prod pg_dump of those policy names). The RPCs are
--   SECURITY DEFINER and check owner_id internally, so they are correct without
--   the repoint, but owner-gated RLS on `trips` will still key off created_by
--   until that repoint is done. Track separately.
--
-- STATUS: staging is NOT yet synced. This file is the prep artifact only.
-- ============================================================================



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- BEGIN 20260721000001_add_missing_columns.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- Phase 0a · 02 — Add missing columns (verified absent on prod 2026-07-20)
-- Idempotent: every ADD uses IF NOT EXISTS so it is safe on staging (which may
-- already have some) and re-runnable.
-- ============================================================================

-- activity_log: human-readable summary + reversal payload (feed & undo, §4)
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS undo_payload jsonb;

-- trip_messages: message addressing (§6). audience is orthogonal to `role`
-- (which stays 'user'|'assistant'). directed_user_id = the @mentioned member.
ALTER TABLE trip_messages ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'trippy';
ALTER TABLE trip_messages ADD COLUMN IF NOT EXISTS directed_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_messages_audience_chk') THEN
    ALTER TABLE trip_messages
      ADD CONSTRAINT trip_messages_audience_chk CHECK (audience IN ('trippy','everyone','user'));
  END IF;
END $$;

-- trips: pooled credit balance (§5). credit_transactions.trip_id ALREADY EXISTS
-- in prod, so only the trips column is net-new here.
-- numeric(10,2) to match profiles.credits precision (pool & wallet same semantics)
ALTER TABLE trips ADD COLUMN IF NOT EXISTS credit_balance numeric(10,2) NOT NULL DEFAULT 0;
-- Belt-and-suspenders in case a fresh env lacks it (no-op on prod):
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS trip_id uuid REFERENCES trips(id) ON DELETE SET NULL;

-- brainstorm_items: route edit attribution (§4)
ALTER TABLE brainstorm_items ADD COLUMN IF NOT EXISTS last_modified_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE brainstorm_items ADD COLUMN IF NOT EXISTS last_modified_at timestamptz;

-- <<< END 20260721000001_add_missing_columns.sql

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- BEGIN 20260721000002_create_collab_tables.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- Phase 0a · 03 — Create tables absent in prod (present in staging, unverified)
-- Canonical shapes from documentation.md §2. Target: PROD (creates them).
--
-- SCOPE (user decision 2026-07-20): staging is out of scope — we work prod-direct
-- until launch. These four tables exist in staging with an unverified shape, but
-- we are not reconciling staging now. Applied to prod, `IF NOT EXISTS` creates
-- them fresh at the canonical shape. Before launch, when staging is re-
-- established, drop+recreate the staging copies to match (deferred).
-- ============================================================================

-- Per-traveler preferences fed to Trippy (Phase 5)
CREATE TABLE IF NOT EXISTS trip_preferences (
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  prefs_text text,
  prefs_struct jsonb,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);

-- Read-tracking for "what changed while you were away" (Phase 3)
CREATE TABLE IF NOT EXISTS trip_read_state (
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  last_seen_at timestamptz DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);

-- Daily email digest bookkeeping (Phase 4)
CREATE TABLE IF NOT EXISTS notification_prefs (
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  email_digest boolean NOT NULL DEFAULT true,
  last_digest_sent_at timestamptz,
  PRIMARY KEY (trip_id, user_id)
);

-- Polls (Phase 6). entity_type includes 'route' for the v1.1 routes surface.
CREATE TABLE IF NOT EXISTS polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  created_by uuid REFERENCES profiles(id),   -- NULL/system id when Trippy-created
  question text NOT NULL,
  options jsonb NOT NULL,                     -- [{id,label}]; route polls: id = brainstorm route id
  mode text NOT NULL DEFAULT 'single',        -- single | approval | ranking (ranking deferred)
  entity_type text,                           -- route | day | activity | freeform
  entity_id uuid,
  status text NOT NULL DEFAULT 'open',        -- open | resolved | cancelled
  resolved_option_id text,
  closes_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- One row per (voter, chosen option). single = 1 row/voter (app-enforced),
-- approval = several, ranking uses `rank`.
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id uuid REFERENCES polls(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  option_id text NOT NULL,
  rank int,
  PRIMARY KEY (poll_id, user_id, option_id)
);

-- <<< END 20260721000002_create_collab_tables.sql

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- BEGIN 20260721000003_is_trip_member_and_rls.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- Phase 0b · 04 — is_trip_member() helper + non-recursive RLS
-- Fixes the R3 footgun: never write a SELECT policy ON trip_members that
-- subqueries trip_members (recursion / empty-result / per-row realtime cost).
-- Use this SECURITY DEFINER helper (bypasses RLS for the membership check).
-- Policies use DROP … IF EXISTS + CREATE for idempotent re-runs.
-- NOTE: RLS for the pre-existing `comments`/`reactions` tables is deferred until
-- the pg_dump reveals their current policies (see 01 stub) — do not guess here.
-- ============================================================================

CREATE OR REPLACE FUNCTION is_trip_member(p_trip uuid, p_uid uuid)
  RETURNS boolean
  LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM trip_members WHERE trip_id = p_trip AND user_id = p_uid
    );
  $$;

-- --- trip_members: co-member visibility (avatars/attribution) ----------------
DROP POLICY IF EXISTS "members read co-members" ON trip_members;
CREATE POLICY "members read co-members" ON trip_members
  FOR SELECT TO authenticated
  USING (is_trip_member(trip_id, auth.uid()));
-- (INSERT stays restricted — membership is added only via the accept_invite
--  SECURITY DEFINER RPC. DELETE policy already exists from 2026-07-13.)

-- --- activity_log: author inserts own rows ------------------------------------
-- Pre-flight (2026-07-21): RLS is ALREADY enabled on activity_log and a working
-- SELECT policy exists ("Members can view activity log", role public). So the
-- ENABLE below is a no-op and we do NOT add a duplicate read policy. What's
-- MISSING is any INSERT policy — without it nothing can write activity_log — so
-- adding the author-insert policy is the load-bearing change.
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;  -- no-op (already enabled)
DROP POLICY IF EXISTS "author writes activity" ON activity_log;
CREATE POLICY "author writes activity" ON activity_log
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      is_trip_member(trip_id, auth.uid())
      -- owner fallback: LEGACY solo trips created before trip_members was wired
      -- up may lack a self-membership row; without this, their activity_log
      -- inserts would be denied and "solo trips log too" would silently break.
      OR EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_id AND t.created_by = auth.uid())
    )
  );

-- --- trip_preferences: member read, self write -------------------------------
ALTER TABLE trip_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read prefs" ON trip_preferences;
CREATE POLICY "members read prefs" ON trip_preferences
  FOR SELECT TO authenticated USING (is_trip_member(trip_id, auth.uid()));
DROP POLICY IF EXISTS "self writes prefs" ON trip_preferences;
CREATE POLICY "self writes prefs" ON trip_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND is_trip_member(trip_id, auth.uid()));

-- --- trip_read_state: self only ----------------------------------------------
ALTER TABLE trip_read_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "self read_state" ON trip_read_state;
CREATE POLICY "self read_state" ON trip_read_state
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- --- notification_prefs: self only -------------------------------------------
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "self notif_prefs" ON notification_prefs;
CREATE POLICY "self notif_prefs" ON notification_prefs
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- --- polls: members read; members create/update ------------------------------
ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read polls" ON polls;
CREATE POLICY "members read polls" ON polls
  FOR SELECT TO authenticated USING (is_trip_member(trip_id, auth.uid()));
DROP POLICY IF EXISTS "members create polls" ON polls;
CREATE POLICY "members create polls" ON polls
  FOR INSERT TO authenticated
  WITH CHECK (is_trip_member(trip_id, auth.uid()));
DROP POLICY IF EXISTS "members update polls" ON polls;
CREATE POLICY "members update polls" ON polls
  FOR UPDATE TO authenticated
  USING (is_trip_member(trip_id, auth.uid()))
  WITH CHECK (is_trip_member(trip_id, auth.uid()));

-- --- poll_votes: members read; self write ------------------------------------
ALTER TABLE poll_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read votes" ON poll_votes;
CREATE POLICY "members read votes" ON poll_votes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM polls p
                 WHERE p.id = poll_votes.poll_id
                   AND is_trip_member(p.trip_id, auth.uid())));
DROP POLICY IF EXISTS "self writes votes" ON poll_votes;
CREATE POLICY "self writes votes" ON poll_votes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- --- service-role full access (matches existing convention; service_role also
--     bypasses RLS, so this is belt-and-suspenders for edge functions) ---------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'activity_log','trip_preferences','trip_read_state','notification_prefs','polls','poll_votes'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "Service role full access" ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- <<< END 20260721000003_is_trip_member_and_rls.sql

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- BEGIN 20260721000004_realtime_publication.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- Phase 0b · 05 — Realtime publication
-- Add app tables to supabase_realtime so clients get live postgres_changes.
-- RLS is still enforced on realtime rows, so the is_trip_member() policies (04)
-- gate what each subscriber receives.
-- `ADD TABLE` errors if a table is already a member, so guard each one.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'trip_messages','activity_log','days','activities','polls','poll_votes','comments'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- <<< END 20260721000004_realtime_publication.sql

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- BEGIN 20260721000005_accept_invite.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- Phase 1 · 06 — accept_invite() RPC
-- SECURITY DEFINER so acceptance is a guarded self-insert — we never loosen
-- trip_members INSERT to arbitrary rows. Param is `text` (opaque token from
-- /join/:token), not uuid. Enforces token validity, inviter-still-member, and a
-- max-members cap (8).
-- ============================================================================

-- The ON CONFLICT below targets (trip_id, user_id). Pre-flight (2026-07-21)
-- confirmed prod already has UNIQUE constraint `trip_members_trip_id_user_id_key`
-- on those columns (and 0 duplicate rows), so no defensive index is needed.

CREATE OR REPLACE FUNCTION accept_invite(p_token text)
  RETURNS uuid                                   -- returns trip_id
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trip uuid;
  v_role text;
  v_creator uuid;
  v_count int;
  v_max int := 8;                                -- max members per trip (confirmed 2026-07-20)
BEGIN
  SELECT trip_id, role, created_by
    INTO v_trip, v_role, v_creator
    FROM invite_links
   WHERE token = p_token
     AND (expires_at IS NULL OR expires_at > now());
  IF v_trip IS NULL THEN
    RAISE EXCEPTION 'invalid_or_expired' USING errcode = 'P0001';
  END IF;

  -- inviter must still be a member of the trip.
  -- ⚠️ DECISION: this means a reusable link dies if the owner leaves (owner invites
  -- 3, leaves, the other 2 links break). Intended for v1 (invites are trust-scoped
  -- to an active member). If undesired, relax to "any current member exists".
  IF NOT EXISTS (SELECT 1 FROM trip_members WHERE trip_id = v_trip AND user_id = v_creator) THEN
    RAISE EXCEPTION 'inviter_left' USING errcode = 'P0001';
  END IF;

  -- capacity guard
  SELECT count(*) INTO v_count FROM trip_members WHERE trip_id = v_trip;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'trip_full' USING errcode = 'P0001';
  END IF;

  INSERT INTO trip_members (trip_id, user_id, role)
    VALUES (v_trip, auth.uid(), COALESCE(v_role, 'edit'))
    ON CONFLICT (trip_id, user_id) DO NOTHING;

  RETURN v_trip;
END $$;

-- Callable by authenticated users (the SECURITY DEFINER body does the gating).
GRANT EXECUTE ON FUNCTION accept_invite(text) TO authenticated;

-- <<< END 20260721000005_accept_invite.sql

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- BEGIN 20260721000006_membership_lifecycle.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- Phase 1 · 07 — Membership lifecycle (transferable ownership, leave, remove)
-- Decisions 2026-07-21 (documentation.md §3 "Membership lifecycle").
--   • Owner can leave, but must transfer ownership first.
--   • Last member leaves → trip deleted.
--   • Remove/leave deletes that member's poll votes (+ vote-notes); everything
--     else (messages, edits, funded credits, polls they created) stays.
--   • Access revoked instantly (trip_members row gone → is_trip_member false).
-- ============================================================================

-- --- Transferable ownership -------------------------------------------------
-- created_by stays immutable (historical); owner_id is the movable owner.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES profiles(id);
UPDATE trips SET owner_id = created_by WHERE owner_id IS NULL;
-- Enforce not-null only if every row backfilled (some legacy trips may have a
-- null created_by — check first; uncomment once clean):
-- ALTER TABLE trips ALTER COLUMN owner_id SET NOT NULL;

-- ⚠️ RLS REPOINT (needs the pg_dump): the existing owner-only policies on `trips`
-- (and invite create/revoke) key off `created_by`. Repoint them to `owner_id` so
-- ownership actually transfers. Their exact names/definitions are unknown until
-- the prod dump — do that repoint alongside `01`. The RPCs below are
-- SECURITY DEFINER and check owner_id internally, so they are correct regardless.

-- --- Ownership transfer ------------------------------------------------------
CREATE OR REPLACE FUNCTION transfer_ownership(p_trip uuid, p_new_owner uuid)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM trips WHERE id = p_trip AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING errcode = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM trip_members WHERE trip_id = p_trip AND user_id = p_new_owner) THEN
    RAISE EXCEPTION 'new_owner_not_member' USING errcode = 'P0001';
  END IF;
  UPDATE trips SET owner_id = p_new_owner WHERE id = p_trip;
END $$;
GRANT EXECUTE ON FUNCTION transfer_ownership(uuid, uuid) TO authenticated;

-- --- Shared cleanup: delete a member's poll votes + vote-notes for one trip ---
CREATE OR REPLACE FUNCTION _cleanup_member_polls(p_trip uuid, p_user uuid)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM poll_votes
   WHERE user_id = p_user
     AND poll_id IN (SELECT id FROM polls WHERE trip_id = p_trip);
  DELETE FROM comments
   WHERE entity_type = 'poll' AND user_id = p_user
     AND entity_id IN (SELECT id FROM polls WHERE trip_id = p_trip);
$$;

-- --- Owner removes a member --------------------------------------------------
CREATE OR REPLACE FUNCTION remove_member(p_trip uuid, p_user uuid)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM trips WHERE id = p_trip AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING errcode = 'P0001';
  END IF;
  IF p_user = auth.uid() THEN
    RAISE EXCEPTION 'use_leave_trip' USING errcode = 'P0001';  -- owner uses leave_trip
  END IF;
  PERFORM _cleanup_member_polls(p_trip, p_user);
  DELETE FROM trip_members WHERE trip_id = p_trip AND user_id = p_user;
END $$;
GRANT EXECUTE ON FUNCTION remove_member(uuid, uuid) TO authenticated;

-- --- Member (or owner) leaves ------------------------------------------------
CREATE OR REPLACE FUNCTION leave_trip(p_trip uuid)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_is_owner boolean; v_members int;
BEGIN
  SELECT (owner_id = auth.uid()) INTO v_is_owner FROM trips WHERE id = p_trip;
  IF v_is_owner IS NULL THEN RAISE EXCEPTION 'not_a_trip' USING errcode = 'P0001'; END IF;
  SELECT count(*) INTO v_members FROM trip_members WHERE trip_id = p_trip;

  IF v_is_owner AND v_members > 1 THEN
    -- must hand off first; UI opens the "choose new owner" picker
    RAISE EXCEPTION 'transfer_ownership_first' USING errcode = 'P0001';
  END IF;

  IF v_members <= 1 THEN
    -- last member leaving → delete the trip (dependent rows cascade via FKs;
    -- VERIFY every collab table FK to trips(id) is ON DELETE CASCADE in the dump)
    DELETE FROM trips WHERE id = p_trip;
    RETURN 'trip_deleted';
  END IF;

  PERFORM _cleanup_member_polls(p_trip, auth.uid());
  DELETE FROM trip_members WHERE trip_id = p_trip AND user_id = auth.uid();
  RETURN 'left';
END $$;
GRANT EXECUTE ON FUNCTION leave_trip(uuid) TO authenticated;

-- <<< END 20260721000006_membership_lifecycle.sql

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- BEGIN 20260721000007_invite_rpcs.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- Phase 1 · invite-link RPCs
-- SECURITY DEFINER so the client never touches invite_links directly (no need to
-- loosen its RLS). Creating a link is allowed for any trip MEMBER (friendlier for
-- adoption; accept_invite already trust-checks the inviter is still a member).
-- Revoke is OWNER-only. get_invite_preview lets a not-yet-member see minimal trip
-- info on the join screen.
-- ============================================================================

-- Create (or reuse an existing unexpired) invite link for a trip. Returns token.
CREATE OR REPLACE FUNCTION create_or_get_invite_link(p_trip uuid)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token text;
BEGIN
  IF NOT is_trip_member(p_trip, auth.uid()) THEN
    RAISE EXCEPTION 'not_a_member' USING errcode = 'P0001';
  END IF;
  SELECT token INTO v_token
    FROM invite_links
   WHERE trip_id = p_trip AND (expires_at IS NULL OR expires_at > now())
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_token IS NULL THEN
    INSERT INTO invite_links (trip_id, created_by, role)
      VALUES (p_trip, auth.uid(), 'edit')
      RETURNING token INTO v_token;
  END IF;
  RETURN v_token;
END $$;
GRANT EXECUTE ON FUNCTION create_or_get_invite_link(uuid) TO authenticated;

-- Revoke all invite links for a trip (owner only).
CREATE OR REPLACE FUNCTION revoke_invite_link(p_trip uuid)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM trips WHERE id = p_trip AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING errcode = 'P0001';
  END IF;
  DELETE FROM invite_links WHERE trip_id = p_trip;
END $$;
GRANT EXECUTE ON FUNCTION revoke_invite_link(uuid) TO authenticated;

-- Minimal preview for the join screen — safe for a not-yet-member to call.
CREATE OR REPLACE FUNCTION get_invite_preview(p_token text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_trip uuid; v_creator uuid;
BEGIN
  SELECT trip_id, created_by INTO v_trip, v_creator
    FROM invite_links
   WHERE token = p_token AND (expires_at IS NULL OR expires_at > now());
  IF v_trip IS NULL THEN
    RETURN json_build_object('valid', false);
  END IF;
  RETURN (
    SELECT json_build_object(
      'valid', true,
      'trip_id', t.id,
      'trip_name', t.name,
      'destination', t.destination,
      'start_date', t.start_date,
      'end_date', t.end_date,
      'member_count', (SELECT count(*) FROM trip_members m WHERE m.trip_id = t.id),
      'inviter', (SELECT p.username FROM profiles p WHERE p.id = v_creator)
    )
    FROM trips t WHERE t.id = v_trip
  );
END $$;
GRANT EXECUTE ON FUNCTION get_invite_preview(text) TO authenticated;

-- <<< END 20260721000007_invite_rpcs.sql
