-- Track how many times IG has been run for this trip (1 = fresh, 2+ = regenerated)
ALTER TABLE trips ADD COLUMN ig_count INT NOT NULL DEFAULT 0;

-- Recreate view (DROP + CREATE to handle column order changes from t.*)
DROP VIEW IF EXISTS trips_with_creator;
CREATE VIEW trips_with_creator AS
SELECT
  t.*,
  p.username                                                          AS created_by_username,
  p.face_icon                                                         AS created_by_face_icon,
  EXTRACT(EPOCH FROM (t.generation_completed_at - t.generation_started_at))::int AS ig_seconds,
  CASE WHEN t.ig_count > 1 THEN true ELSE false END                  AS is_regenerated
FROM trips t
LEFT JOIN profiles p ON p.id = t.created_by;
