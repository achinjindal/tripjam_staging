-- API usage counters for rate limiting
CREATE TABLE api_usage (
  id SERIAL PRIMARY KEY,
  api TEXT NOT NULL,              -- 'tripadvisor', 'google-photo'
  scope TEXT NOT NULL,            -- 'daily', 'monthly', or trip_id
  period TEXT NOT NULL,           -- '2026-04-20' for daily, '2026-04' for monthly
  count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (api, scope, period)
);

ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON api_usage FOR ALL USING (true) WITH CHECK (true);
