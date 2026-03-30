ALTER TABLE trips ADD COLUMN IF NOT EXISTS generation_started_at timestamptz;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS generation_completed_at timestamptz;
