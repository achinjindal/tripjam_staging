ALTER TABLE trips ADD COLUMN IF NOT EXISTS arrival_mode text DEFAULT 'flight';
ALTER TABLE trips ADD COLUMN IF NOT EXISTS departure_mode text DEFAULT 'flight';
ALTER TABLE trips ADD COLUMN IF NOT EXISTS has_car boolean DEFAULT false;
