-- Day 7: per-user per-minute rate limit for LLM edge functions.
--
-- Cheap Postgres-counter approach (vs full Redis): one row per
-- (user_id, minute_bucket) auto-incrementing a count. A SECURITY DEFINER
-- function increments + returns the new count atomically. Edge functions
-- check the count; if > threshold, return 429.

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL,           -- e.g. 'llm' (one bucket per resource)
  minute_ts TIMESTAMPTZ NOT NULL, -- truncated to minute
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, bucket, minute_ts)
);

-- Index for cleanup queries (we keep ~10 minutes of history max)
CREATE INDEX IF NOT EXISTS rate_limit_counters_minute_ts_idx
  ON rate_limit_counters(minute_ts);

-- RLS: users can read their own counters (useful for debugging). Only
-- service_role writes.
ALTER TABLE rate_limit_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own rate_limit_counters" ON rate_limit_counters;
CREATE POLICY "users read own rate_limit_counters"
  ON rate_limit_counters FOR SELECT
  USING (auth.uid() = user_id);

-- Atomic increment + return. Truncates current time to the minute and
-- upserts the (user_id, bucket, minute_ts) row.
CREATE OR REPLACE FUNCTION incr_rate_limit(
  p_user_id UUID,
  p_bucket TEXT DEFAULT 'llm'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_minute TIMESTAMPTZ := date_trunc('minute', NOW());
  v_count INTEGER;
BEGIN
  INSERT INTO rate_limit_counters (user_id, bucket, minute_ts, count)
  VALUES (p_user_id, p_bucket, v_minute, 1)
  ON CONFLICT (user_id, bucket, minute_ts)
  DO UPDATE SET count = rate_limit_counters.count + 1
  RETURNING count INTO v_count;

  -- Best-effort cleanup of old buckets (anything > 10 min). Fire-and-forget;
  -- runs in the same txn but skips on error.
  BEGIN
    DELETE FROM rate_limit_counters WHERE minute_ts < v_minute - INTERVAL '10 minutes';
  EXCEPTION WHEN OTHERS THEN
    -- ignore
  END;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION incr_rate_limit(uuid, text) TO service_role;
