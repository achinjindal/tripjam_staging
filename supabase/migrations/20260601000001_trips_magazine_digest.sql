-- Per-trip Magazine cache (2026-06-01)
--
-- Saves city deep-dive content (writeup, moreSights with photo_url, etc.)
-- on the trip row so revisiting a trip shows Magazine instantly without
-- re-calling city-deep-dive or re-fetching Wikipedia photos.
--
-- Lifecycle:
--   - NULL until the user first views Magazine for this trip.
--   - Merged per city on each successful city-deep-dive load.
--   - Cleared when the user triggers a fresh RG with different destinations.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS magazine_digest JSONB;

COMMENT ON COLUMN trips.magazine_digest IS
  'Cached Magazine city deep-dives keyed by city name (writeup, moreSights with photo_url, food, etc.). Written client-side after city-deep-dive + photo fetch; avoids re-fetch on revisit.';
