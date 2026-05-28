-- Hardened geocode verify ladder (2026-05-28)
--
-- Extends the geocode_metadata migration with two columns that the new
-- verify-place action populates on activities:
--
--   geocode_corrected_from — the original LLM-generated name before Haiku
--     repaired it. NULL when no repair happened. Used by the UI to show
--     "updated from 'The Westin Sapporo'" and to support reset-to-auto.
--
--   geocode_verified_at — when verify-place last resolved this row. Used
--     by lazy verification to avoid re-querying every render after a failed
--     attempt (verified_at IS NOT NULL AND lat IS NULL = "tried and failed").

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS geocode_corrected_from TEXT,
  ADD COLUMN IF NOT EXISTS geocode_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN activities.geocode_corrected_from IS
  'Original LLM-generated name before Haiku repair (NULL if no repair).';
COMMENT ON COLUMN activities.geocode_verified_at IS
  'When verify-place last resolved this row. NULL = never verified.';
