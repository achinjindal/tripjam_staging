-- Cache for geocode, photo, and autocomplete results
CREATE TABLE place_cache (
  key TEXT PRIMARY KEY,
  action TEXT NOT NULL,          -- 'geocode', 'photo', 'hotel-photo', 'autocomplete'
  result JSONB NOT NULL,
  source TEXT,                   -- 'google', 'tripadvisor', 'wikipedia', 'photon'
  expires_at TIMESTAMPTZ,        -- NULL = permanent, set for TripAdvisor (30 days)
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_place_cache_expires ON place_cache (expires_at) WHERE expires_at IS NOT NULL;

-- Allow edge functions to read/write cache
ALTER TABLE place_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON place_cache FOR ALL USING (true) WITH CHECK (true);
