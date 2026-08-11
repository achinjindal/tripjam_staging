-- Phase 4 minimal slice: transactional email log.
-- Written only by the send-email edge function (service role). Powers the
-- per-user daily cap on external invites and the itinerary_ready 24h dedupe.
-- RLS enabled with NO policies: clients can neither read nor write.

CREATE TABLE IF NOT EXISTS email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  trip_id uuid,
  sender_id uuid,
  recipient text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_log_sender_type_time
  ON email_log (sender_id, type, created_at);
CREATE INDEX IF NOT EXISTS email_log_trip_type_time
  ON email_log (trip_id, type, created_at);

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;
