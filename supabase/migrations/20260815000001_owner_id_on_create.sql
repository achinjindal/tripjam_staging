-- owner_id was only ever set by the 20260721000006 one-time backfill; the
-- client's trip-create insert never wrote it, so every trip built since has
-- owner_id NULL — and the invite/lifecycle RPCs (create_or_get_invite_link,
-- transfer_ownership, remove_member, revoke_invite_link) check
-- owner_id = auth.uid() STRICTLY, silently locking those owners out of
-- inviting. Belt (trigger) + suspenders (client now sends owner_id on insert)
-- + re-run of the idempotent backfill.

CREATE OR REPLACE FUNCTION set_trip_owner_default()
  RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.owner_id := COALESCE(NEW.owner_id, NEW.created_by);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_trip_owner_default ON trips;
CREATE TRIGGER trg_trip_owner_default
  BEFORE INSERT ON trips
  FOR EACH ROW EXECUTE FUNCTION set_trip_owner_default();

-- Idempotent repair for trips created between launch and this fix
UPDATE trips SET owner_id = created_by WHERE owner_id IS NULL;
