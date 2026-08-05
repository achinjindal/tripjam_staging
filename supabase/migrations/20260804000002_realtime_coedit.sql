-- ============================================================================
-- Realtime co-editing support (Phase 2 live sync).
--
-- 1. days.updated_at — a touchable column so an activity edit can bump the
--    parent day row.
-- 2. Trigger: any activities INSERT/UPDATE/DELETE touches days.updated_at, so
--    the trip-scoped `days` realtime channel fires and subscribers refetch that
--    day's activities. (`activities` has no trip_id, so it can't be filtered by
--    trip in a channel — this is how live activity sync works. See
--    realtime-implementation-plan.md, Option A.)
-- 3. Publish trip_members so the owner sees a joiner live.
--
-- Note: the trigger fires on every activity write (incl. bulk IG inserts) — a
-- small extra UPDATE per activity. Acceptable for v1; optimise later if hot.
-- ============================================================================

ALTER TABLE days ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION public.touch_day_from_activity()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE days SET updated_at = now()
   WHERE id = COALESCE(NEW.day_id, OLD.day_id);
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS touch_day_from_activity_trg ON activities;
CREATE TRIGGER touch_day_from_activity_trg
  AFTER INSERT OR UPDATE OR DELETE ON activities
  FOR EACH ROW EXECUTE FUNCTION public.touch_day_from_activity();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trip_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE trip_members;
  END IF;
END $$;
