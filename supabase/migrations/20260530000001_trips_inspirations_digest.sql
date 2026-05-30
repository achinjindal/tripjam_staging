-- Per-trip Inspirations cache (2026-05-30)
--
-- Saves the Inspirations digest directly on the trip row so revisiting
-- a trip (on any device) shows Inspirations instantly without a round-trip
-- to generate-destination-research or the global destination_research cache.
--
-- Lifecycle:
--   - NULL until the user first views Inspirations for this trip.
--   - Written on every successful Inspirations load (including Load-more appends).
--   - Cleared when the user triggers a fresh RG with different destinations
--     (doSetupComplete with regenerate=true), so stale content doesn't persist.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS inspirations_digest JSONB;

COMMENT ON COLUMN trips.inspirations_digest IS
  'Cached Inspirations digest for this trip (inspirations[], place_insights[], sources[]). Written client-side after the first successful generate-destination-research call; avoids re-fetching on revisit.';
