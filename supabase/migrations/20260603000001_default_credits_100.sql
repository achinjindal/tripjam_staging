-- Lower the default starting credit balance from 300 → 100.
-- Existing user balances are unchanged.
-- New signups will receive 100 credits on account creation.

ALTER TABLE profiles ALTER COLUMN credits SET DEFAULT 100;
