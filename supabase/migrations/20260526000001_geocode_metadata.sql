-- Feature 8 — Navigation accuracy permanent fix (2026-05-26)
--
-- Adds metadata columns on activities for tracking how each lat/lng was resolved,
-- plus a global geocode_overrides table for user-supplied corrections that take
-- precedence over Photon/Google for everyone.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS geocode_source TEXT,        -- 'photon' | 'google_places' | 'llm_hint' | 'user_corrected' | 'admin_verified'
  ADD COLUMN IF NOT EXISTS geocode_confidence TEXT;    -- 'high' | 'medium' | 'low'

-- Global corrections table: keyed on normalized place name + city.
-- User-supplied or admin-verified coordinates always win over any resolver result.
CREATE TABLE IF NOT EXISTS geocode_overrides (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  place_normalized text NOT NULL,                       -- lowercased + trimmed place name
  city text,                                            -- nullable; cities scope corrections to a locality
  lat NUMERIC(10,7) NOT NULL,
  lng NUMERIC(10,7) NOT NULL,
  source text NOT NULL CHECK (source IN ('user_correction', 'admin_verified')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(place_normalized, city)
);

CREATE INDEX IF NOT EXISTS geocode_overrides_lookup_idx
  ON geocode_overrides(place_normalized, city);

-- RLS: anyone authenticated can read (it's a global de facto cache);
-- only authenticated users can insert their own; admins can update/delete.
ALTER TABLE geocode_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read" ON geocode_overrides;
CREATE POLICY "Authenticated read" ON geocode_overrides FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "User insert own" ON geocode_overrides;
CREATE POLICY "User insert own" ON geocode_overrides FOR INSERT
  TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "Service role full" ON geocode_overrides;
CREATE POLICY "Service role full" ON geocode_overrides FOR ALL USING (true);
