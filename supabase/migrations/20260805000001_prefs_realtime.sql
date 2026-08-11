-- ============================================================================
-- Phase 5 — per-traveller preferences ("Your travel style").
-- The trip_preferences table + RLS ("members read prefs" / "self writes prefs")
-- already exist (20260721000002 / 20260721000003). This only adds it to the
-- realtime publication so a member's saved style propagates live to co-travellers.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trip_preferences'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE trip_preferences;
  END IF;
END $$;
