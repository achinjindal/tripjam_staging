-- Claim-first dedupe for inbound booking emails: the inbound-email edge
-- function INSERTs a row with type = 'inbound:<message_id>' BEFORE doing any
-- processing. This partial unique index makes webhook retries collide on that
-- insert instead of double-processing (duplicate receipts / feed rows /
-- booking writes). Plain 'receipt' and other type values are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS email_log_inbound_dedupe
  ON email_log (type)
  WHERE type LIKE 'inbound:%';
