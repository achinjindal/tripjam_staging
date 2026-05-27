-- Inspirations feature (F1): cached web-search-backed research digest per
-- (destinations, tags, monthBucket). Powers the Magazine "Inspirations"
-- section + per-activity "ⓘ N sources" pill.
--
-- Consolidates the historical 20260513 + 20260521 migrations from the
-- inspiration branch into a single forward-only migration (the original
-- `styles` column was renamed to `tags` mid-branch — no point creating
-- it just to rename it on a fresh apply).

CREATE TABLE IF NOT EXISTS destination_research (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key text NOT NULL UNIQUE,
  destinations jsonb NOT NULL,
  tags jsonb NOT NULL,
  month_bucket text NOT NULL,
  digest jsonb NOT NULL,
  web_search_count integer DEFAULT 0,
  generated_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_destination_research_key ON destination_research(cache_key);
CREATE INDEX IF NOT EXISTS idx_destination_research_expires ON destination_research(expires_at);

ALTER TABLE destination_research ENABLE ROW LEVEL SECURITY;

-- Idempotent policy creation — re-running this migration won't fail.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'Service role full access'
      AND polrelid = 'public.destination_research'::regclass
  ) THEN
    CREATE POLICY "Service role full access" ON destination_research
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'Anyone authenticated can read research'
      AND polrelid = 'public.destination_research'::regclass
  ) THEN
    CREATE POLICY "Anyone authenticated can read research" ON destination_research
      FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Track per-request web_search invocations alongside token usage on llm_usage.
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS web_search_count integer DEFAULT 0;
