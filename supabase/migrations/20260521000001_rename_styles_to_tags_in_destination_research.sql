-- Inspirations: cache key now uses notes-derived tags (bounded vocab) rather
-- than the removed `styles` form field. Idempotent — prod may already have `tags`
-- (e.g. from destination_research_cache migration creating the table with tags).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'destination_research'
      AND column_name = 'styles'
  ) THEN
    ALTER TABLE destination_research RENAME COLUMN styles TO tags;
  END IF;
END $$;
