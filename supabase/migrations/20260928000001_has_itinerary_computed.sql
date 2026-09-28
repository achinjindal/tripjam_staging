-- PostgREST computed column: trip-list screens need "does this trip have
-- an itinerary" without downloading the multi-hundred-KB ig_response blob
-- (Home's select(*) was pulling ~MBs over mobile just to paint cards).
CREATE OR REPLACE FUNCTION has_itinerary(t trips) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT t.ig_response IS NOT NULL $$;
