-- Travel legs (booked flights/trains ingested from forwarded emails or
-- uploads). Array of leg objects mirroring the hotels_data pattern:
-- {id, kind: flight|train, carrier, number, date, depart_time, arrive_time,
--  from, to, confirmation, class, status: booked|cancelled,
--  via: email|upload, created_at}
ALTER TABLE trips ADD COLUMN IF NOT EXISTS travel_data jsonb;
