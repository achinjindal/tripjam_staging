ALTER TABLE trips ADD COLUMN IF NOT EXISTS ig_request jsonb;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS ig_response jsonb;
