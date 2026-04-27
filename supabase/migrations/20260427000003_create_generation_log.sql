CREATE TABLE generation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  ig_count INT,
  generation_started_at TIMESTAMPTZ,
  compact_ready_at TIMESTAMPTZ,
  detailed_ready_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE generation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON generation_log FOR ALL USING (true) WITH CHECK (true);
