-- Route Generation (RG) timing log — mirrors generation_log (IG timing).
-- RG is a distinct operation from IG (it runs before route selection, and can
-- run multiple times via "show me more plans"), so it gets its own table rather
-- than sharing a generation_log row. One row per RG stream:
--   rg_started_at  → the fetch kicked off
--   first_route_at → the FIRST tier-1 route parsed from the stream
--   all_routes_at  → the stream completed (all routes in)
-- "time to first route" = first_route_at - rg_started_at
-- "time to all routes"  = all_routes_at  - rg_started_at

CREATE TABLE IF NOT EXISTS rg_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Plain uuid (no FK): RG can run in the pre-trip flow before the trip row is
  -- persisted, so a strict FK would reject those timing rows. Orphans are
  -- harmless for a timing log.
  trip_id UUID,
  num_routes INT,
  add_more BOOLEAN DEFAULT false,
  rg_started_at TIMESTAMPTZ,
  first_route_at TIMESTAMPTZ,
  all_routes_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE rg_log ENABLE ROW LEVEL SECURITY;
-- Same open policy as generation_log: timing rows are written by the client and
-- read by the admin console; low sensitivity, no per-user gating needed.
DROP POLICY IF EXISTS "Service role full access" ON rg_log;
CREATE POLICY "Service role full access" ON rg_log FOR ALL USING (true) WITH CHECK (true);
