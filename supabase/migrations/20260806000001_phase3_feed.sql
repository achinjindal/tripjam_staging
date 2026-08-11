-- Phase 3 — activity feed / "while you were away" / undo.
-- Folds in the independent eng-review corrections (Part C of phase3-plan.md).
-- Additive + idempotent. `activity_log` (+ RLS + realtime publication) and
-- `trip_read_state` (+ self RLS) already exist; this migration (a) defensively
-- re-creates trip_read_state so prod (which has schema drift) gets it, and
-- (b) adds the two info-row loggers as DB triggers so member-join and pool
-- top-up feed rows are written server-side, atomically, from every code path
-- (no client dependency, no edge-function edits).

-- ---------------------------------------------------------------------------
-- 1. trip_read_state — defensive re-create (per-user read marker for the feed +
--    "while you were away"). Mirrors the existing policy names so it is a no-op
--    on staging and creates the table + RLS on prod. NOT added to the realtime
--    publication: it is per-user, the owner of the row is its only reader.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_read_state (
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_seen_at timestamptz DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);
ALTER TABLE trip_read_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self read_state" ON trip_read_state;
CREATE POLICY "self read_state" ON trip_read_state
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role full access" ON trip_read_state;
CREATE POLICY "Service role full access" ON trip_read_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2. member_join info rows. A trigger on trip_members INSERT logs an activity_log
--    row when a co-traveller joins — covering every join path (accept_invite link,
--    respond_invite targeted invite) in one place. The trip owner's own seed row
--    (inserted at trip creation, user_id = trips.created_by) is skipped so solo
--    trips never log "owner joined". SECURITY DEFINER so it can write activity_log.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_member_join()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_creator uuid;
BEGIN
  SELECT created_by INTO v_creator FROM trips WHERE id = NEW.trip_id;
  IF NEW.user_id IS DISTINCT FROM v_creator THEN
    INSERT INTO activity_log (trip_id, user_id, action, entity_type, entity_id, summary)
    VALUES (NEW.trip_id, NEW.user_id, 'member_join', 'member', NEW.user_id,
            'joined the trip');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_member_join ON trip_members;
CREATE TRIGGER trg_log_member_join
  AFTER INSERT ON trip_members
  FOR EACH ROW EXECUTE FUNCTION log_member_join();

-- ---------------------------------------------------------------------------
-- 3. credits_topup info rows. A trigger on credit_transactions INSERT logs a
--    muted feed row for a pool top-up (amount > 0 AND trip_id set). Covers every
--    grant path (coupon / Lemon Squeezy / RevenueCat) that funds a trip pool —
--    including webhook-only grants with no browser open — from one place. Personal
--    top-ups (trip_id NULL) and deductions (amount <= 0) are ignored.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_credits_topup()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.trip_id IS NOT NULL AND NEW.amount > 0 THEN
    INSERT INTO activity_log (trip_id, user_id, action, entity_type, entity_id, summary)
    VALUES (NEW.trip_id, NEW.user_id, 'credits_topup', 'trip', NEW.trip_id,
            'topped up the trip · +' || trim(to_char(NEW.amount, 'FM999999990')) || ' credits');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_credits_topup ON credit_transactions;
CREATE TRIGGER trg_log_credits_topup
  AFTER INSERT ON credit_transactions
  FOR EACH ROW EXECUTE FUNCTION log_credits_topup();
