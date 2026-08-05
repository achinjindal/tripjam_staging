-- Phase 6 — Polls / group decisions.
-- Folds in the independent eng-review corrections (Part C of phase5-6-plan.md).
-- Additive only. `polls` + `poll_votes` + `comments` tables already exist and are
-- in the supabase_realtime publication; this migration adds the RLS, the live-
-- tally mechanism, and the close_poll RPC that the feature needs.

-- ---------------------------------------------------------------------------
-- 1. Live tallies via the parent-trigger pattern (correction #5).
--    poll_votes / comments carry no trip_id, so they can't be trip-filtered in
--    realtime. Instead a write to either touches polls.updated_at; the already-
--    subscribed (trip_id-filtered) `polls` channel then fires and the client
--    reconciles that poll's tally from the DB. Mirrors activities→days.updated_at.
-- ---------------------------------------------------------------------------
ALTER TABLE polls ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION touch_poll_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pid uuid;
BEGIN
  IF TG_TABLE_NAME = 'poll_votes' THEN
    pid := COALESCE(NEW.poll_id, OLD.poll_id);
  ELSE -- comments
    IF COALESCE(NEW.entity_type, OLD.entity_type) <> 'poll' THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    pid := COALESCE(NEW.entity_id, OLD.entity_id);
  END IF;
  UPDATE polls SET updated_at = now() WHERE id = pid;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_poll_votes_touch ON poll_votes;
CREATE TRIGGER trg_poll_votes_touch
  AFTER INSERT OR UPDATE OR DELETE ON poll_votes
  FOR EACH ROW EXECUTE FUNCTION touch_poll_updated_at();

DROP TRIGGER IF EXISTS trg_poll_comments_touch ON comments;
CREATE TRIGGER trg_poll_comments_touch
  AFTER INSERT OR UPDATE OR DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION touch_poll_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Tighten poll_votes RLS (correction #4). The current "self writes votes"
--    (FOR ALL, user_id=auth.uid() only) lets non-members vote and lets anyone
--    write votes to a resolved poll. Votes drive auto-apply, so lock this down:
--    insert requires membership + an OPEN poll; delete/update only your own rows
--    on an OPEN poll (resolved-poll immutability, correction #8).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "self writes votes" ON poll_votes;

DROP POLICY IF EXISTS "self insert votes" ON poll_votes;
CREATE POLICY "self insert votes" ON poll_votes
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM polls p
                WHERE p.id = poll_id
                  AND is_trip_member(p.trip_id, auth.uid())
                  AND p.status = 'open')
  );

DROP POLICY IF EXISTS "self delete votes" ON poll_votes;
CREATE POLICY "self delete votes" ON poll_votes
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM polls p WHERE p.id = poll_id AND p.status = 'open')
  );

DROP POLICY IF EXISTS "self update votes" ON poll_votes;
CREATE POLICY "self update votes" ON poll_votes
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM polls p WHERE p.id = poll_id AND p.status = 'open')
  )
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. comments RLS for vote-notes (correction #3). The existing
--    "Members can view comments" SELECT policy covers day/activity/trip entities
--    but NOT entity_type='poll', and there is no INSERT/UPDATE at all. ADD
--    poll-scoped policies alongside the existing one (never drop it) + a partial
--    unique index enforcing one note per voter per poll (D-P7).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "members read poll notes" ON comments;
CREATE POLICY "members read poll notes" ON comments
  FOR SELECT TO authenticated
  USING (
    entity_type = 'poll'
    AND EXISTS (SELECT 1 FROM polls p
                WHERE p.id = comments.entity_id
                  AND is_trip_member(p.trip_id, auth.uid()))
  );

DROP POLICY IF EXISTS "members insert poll notes" ON comments;
CREATE POLICY "members insert poll notes" ON comments
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND entity_type = 'poll'
    AND EXISTS (SELECT 1 FROM polls p
                WHERE p.id = comments.entity_id
                  AND is_trip_member(p.trip_id, auth.uid())
                  AND p.status = 'open')
  );

DROP POLICY IF EXISTS "self update poll notes" ON comments;
CREATE POLICY "self update poll notes" ON comments
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND entity_type = 'poll'
    AND EXISTS (SELECT 1 FROM polls p
                WHERE p.id = comments.entity_id AND p.status = 'open')
  )
  WITH CHECK (user_id = auth.uid() AND entity_type = 'poll');

-- A note is set via delete-then-insert (the partial unique index below can't be
-- an upsert arbiter), so voters need DELETE on their own poll notes.
DROP POLICY IF EXISTS "self delete poll notes" ON comments;
CREATE POLICY "self delete poll notes" ON comments
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND entity_type = 'poll'
    AND EXISTS (SELECT 1 FROM polls p
                WHERE p.id = comments.entity_id AND p.status = 'open')
  );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_poll_note_per_voter
  ON comments (entity_id, user_id)
  WHERE entity_type = 'poll';

-- ---------------------------------------------------------------------------
-- 4. close_poll RPC (corrections #6 + #7). D-P6 close-permission (creator or
--    trip owner) is NOT expressible in the "members update polls" RLS policy, so
--    enforce it here. Idempotent: only the caller who flips open→resolved gets
--    closed_now=true, so only that client triggers apply (race-safe, no locks).
--    Server computes the winner: the single option with the strictly-highest
--    vote count (>0). Ties and 0-vote polls resolve with winner=NULL and must
--    NOT auto-mutate anything (correction #8).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION close_poll(p_poll uuid)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trip    uuid;
  v_creator uuid;
  v_owner   uuid;
  v_status  text;
  v_winner  text;
  v_rows    int;
BEGIN
  SELECT p.trip_id, p.created_by, p.status, t.owner_id
    INTO v_trip, v_creator, v_status, v_owner
    FROM polls p JOIN trips t ON t.id = p.trip_id
   WHERE p.id = p_poll;

  IF v_trip IS NULL THEN
    RAISE EXCEPTION 'poll not found' USING errcode = 'P0002';
  END IF;

  IF auth.uid() <> v_creator AND auth.uid() <> v_owner THEN
    RAISE EXCEPTION 'only the poll creator or trip owner can close this poll'
      USING errcode = 'P0001';
  END IF;

  IF v_status <> 'open' THEN
    RETURN jsonb_build_object(
      'closed_now', false, 'status', v_status,
      'winner', (SELECT resolved_option_id FROM polls WHERE id = p_poll));
  END IF;

  WITH counts AS (
    SELECT option_id, count(*)::int AS c
      FROM poll_votes WHERE poll_id = p_poll GROUP BY option_id
  ), ranked AS (
    SELECT option_id, c,
           rank() OVER (ORDER BY c DESC) AS rk,
           count(*) OVER (PARTITION BY c) AS tie_at_c
      FROM counts
  )
  SELECT option_id INTO v_winner
    FROM ranked
   WHERE rk = 1 AND c > 0 AND tie_at_c = 1
   LIMIT 1;

  UPDATE polls
     SET status = 'resolved',
         resolved_option_id = v_winner,
         closes_at = COALESCE(closes_at, now()),
         updated_at = now()
   WHERE id = p_poll AND status = 'open';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN  -- lost the race; someone else already resolved it
    RETURN jsonb_build_object(
      'closed_now', false, 'status', (SELECT status FROM polls WHERE id = p_poll),
      'winner', (SELECT resolved_option_id FROM polls WHERE id = p_poll));
  END IF;

  RETURN jsonb_build_object(
    'closed_now', true, 'status', 'resolved',
    'winner', v_winner, 'entity_type', (SELECT entity_type FROM polls WHERE id = p_poll),
    'entity_id', (SELECT entity_id FROM polls WHERE id = p_poll));
END $$;

GRANT EXECUTE ON FUNCTION close_poll(uuid) TO authenticated;
