-- Activity feed milestones: the feed previously only knew about edits made
-- after Phase 3 shipped — new joiners saw an empty history ("You joined" and
-- nothing else). Adds:
--   1. A trigger logging 'trip_created' on trips INSERT (covers every create
--      path in one place; SECURITY DEFINER like log_member_join).
--   2. A one-time backfill of trip_created / routes_generated /
--      itinerary_generated rows for EXISTING trips, timestamped historically
--      so the feed reads as a true chronology.
-- RG/IG milestones for new generations are logged client-side (with counts).

CREATE OR REPLACE FUNCTION log_trip_created()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO activity_log (trip_id, user_id, action, entity_type, entity_id, summary)
  VALUES (NEW.id, NEW.created_by, 'trip_created', 'trip', NEW.id, 'created the trip');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_trip_created ON trips;
CREATE TRIGGER trg_log_trip_created
  AFTER INSERT ON trips
  FOR EACH ROW EXECUTE FUNCTION log_trip_created();

-- ── Backfill (idempotent: skips trips that already have the row) ────────────

INSERT INTO activity_log (trip_id, user_id, action, entity_type, entity_id, summary, created_at)
SELECT t.id, t.created_by, 'trip_created', 'trip', t.id, 'created the trip', t.created_at
  FROM trips t
 WHERE NOT EXISTS (
   SELECT 1 FROM activity_log a
    WHERE a.trip_id = t.id AND a.action = 'trip_created');

INSERT INTO activity_log (trip_id, user_id, action, entity_type, entity_id, summary, created_at)
SELECT r.trip_id, t.created_by, 'routes_generated', 'trip', r.trip_id,
       'generated ' || COALESCE(r.num_routes, 4) || ' route options',
       COALESCE(r.created_at, t.created_at)
  FROM rg_log r
  JOIN trips t ON t.id = r.trip_id
 WHERE r.add_more IS NOT TRUE
   AND NOT EXISTS (
   SELECT 1 FROM activity_log a
    WHERE a.trip_id = r.trip_id AND a.action = 'routes_generated');

INSERT INTO activity_log (trip_id, user_id, action, entity_type, entity_id, summary, created_at)
SELECT t.id, t.created_by, 'itinerary_generated', 'trip', t.id,
       'generated the day-by-day itinerary',
       COALESCE(t.generation_completed_at, t.detailed_ready_at, t.created_at)
  FROM trips t
 WHERE t.ig_response IS NOT NULL
   AND NOT EXISTS (
   SELECT 1 FROM activity_log a
    WHERE a.trip_id = t.id AND a.action = 'itinerary_generated');
