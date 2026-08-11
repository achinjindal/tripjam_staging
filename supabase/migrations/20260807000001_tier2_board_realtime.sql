-- Realtime Tier 2 — Board live-sync.
-- Publishes the board tables to supabase_realtime and sets REPLICA IDENTITY FULL
-- so trip_id-filtered DELETE events actually deliver (under the default identity
-- a DELETE's old row carries only the PK, so a trip_id=eq filter can't match it
-- and the delete is dropped — verified in the eng review). RLS is already
-- member-aware on all three, so no policy changes. Notes + budget (both on the
-- `trips` row, filtered by id not trip_id) are intentionally out of Tier 2.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trip_todos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE trip_todos;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trip_expenses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE trip_expenses;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trip_bookmarks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE trip_bookmarks;
  END IF;
END $$;

ALTER TABLE trip_todos REPLICA IDENTITY FULL;
ALTER TABLE trip_expenses REPLICA IDENTITY FULL;
ALTER TABLE trip_bookmarks REPLICA IDENTITY FULL;
