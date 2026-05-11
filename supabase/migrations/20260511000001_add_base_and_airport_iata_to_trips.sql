-- Persist user's home location and the IATA codes of the trip's arrival/departure airports.
-- base_location was form-only until now; arrival/departure_city kept their freeform contract,
-- and IATA codes are stored separately so display can degrade gracefully when null.

ALTER TABLE trips ADD COLUMN IF NOT EXISTS base_location text;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS arrival_airport_iata text;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS departure_airport_iata text;
