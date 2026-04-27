-- Track compact and detailed generation times separately
ALTER TABLE trips ADD COLUMN compact_ready_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN detailed_ready_at TIMESTAMPTZ;
