ALTER TABLE activities ADD COLUMN IF NOT EXISTS transition_mins integer;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS transition_mode text;
