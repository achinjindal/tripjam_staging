-- ============================================================================
-- Phase 0a · 02 — Add missing columns (verified absent on prod 2026-07-20)
-- Idempotent: every ADD uses IF NOT EXISTS so it is safe on staging (which may
-- already have some) and re-runnable.
-- ============================================================================

-- activity_log: human-readable summary + reversal payload (feed & undo, §4)
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS undo_payload jsonb;

-- trip_messages: message addressing (§6). audience is orthogonal to `role`
-- (which stays 'user'|'assistant'). directed_user_id = the @mentioned member.
ALTER TABLE trip_messages ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'trippy';
ALTER TABLE trip_messages ADD COLUMN IF NOT EXISTS directed_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_messages_audience_chk') THEN
    ALTER TABLE trip_messages
      ADD CONSTRAINT trip_messages_audience_chk CHECK (audience IN ('trippy','everyone','user'));
  END IF;
END $$;

-- trips: pooled credit balance (§5). credit_transactions.trip_id ALREADY EXISTS
-- in prod, so only the trips column is net-new here.
-- numeric(10,2) to match profiles.credits precision (pool & wallet same semantics)
ALTER TABLE trips ADD COLUMN IF NOT EXISTS credit_balance numeric(10,2) NOT NULL DEFAULT 0;
-- Belt-and-suspenders in case a fresh env lacks it (no-op on prod):
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS trip_id uuid REFERENCES trips(id) ON DELETE SET NULL;

-- brainstorm_items: route edit attribution (§4)
ALTER TABLE brainstorm_items ADD COLUMN IF NOT EXISTS last_modified_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE brainstorm_items ADD COLUMN IF NOT EXISTS last_modified_at timestamptz;
