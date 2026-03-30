ALTER TABLE trips ADD COLUMN IF NOT EXISTS arrival_city text;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS departure_city text;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS hotels_data jsonb;
