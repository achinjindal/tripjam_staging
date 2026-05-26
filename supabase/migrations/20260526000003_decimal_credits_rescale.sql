-- Day 2 Part A — Decimal credits + Stripe wiring
--
-- Combines:
--   1. Reset all inflated balances (999999) to launch starting value of 300.
--   2. Change profiles.credits type from INTEGER to NUMERIC(10,2).
--   3. Create credit_transactions table (staging) OR alter it (prod) with NUMERIC + stripe_session_id.
--   4. Add profiles.stripe_customer_id.
--   5. Recreate deduct_credits + grant_credits RPCs with NUMERIC amounts.
--
-- Idempotent and safe to apply on either environment. Defaults are
-- prescribed for Day 2 (300 credits = $5 pack equivalent).

-- ── 1. Reset inflated balances + change default to 300 ──
UPDATE profiles SET credits = 300 WHERE credits = 999999;
ALTER TABLE profiles ALTER COLUMN credits SET DEFAULT 300;

-- ── 2. Change credits column to NUMERIC(10,2) ──
ALTER TABLE profiles ALTER COLUMN credits TYPE NUMERIC(10,2) USING credits::numeric;

-- ── 3. Add stripe_customer_id ──
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
CREATE INDEX IF NOT EXISTS profiles_stripe_customer_id_idx
  ON profiles(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ── 4. credit_transactions (create or alter) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credit_transactions') THEN
    CREATE TABLE credit_transactions (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      amount NUMERIC(10,2) NOT NULL,
      balance_after NUMERIC(10,2) NOT NULL,
      reason TEXT NOT NULL,
      function_name TEXT,
      trip_id UUID,
      llm_cost_usd NUMERIC(10,6),
      metadata JSONB,
      stripe_session_id TEXT UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX credit_transactions_user_id_idx ON credit_transactions(user_id, created_at DESC);
  ELSE
    ALTER TABLE credit_transactions ALTER COLUMN amount TYPE NUMERIC(10,2) USING amount::numeric;
    ALTER TABLE credit_transactions ALTER COLUMN balance_after TYPE NUMERIC(10,2) USING balance_after::numeric;
    ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
    -- Add UNIQUE constraint only if not already present
    DO $inner$ BEGIN
      ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_stripe_session_id_key UNIQUE (stripe_session_id);
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
    END $inner$;
  END IF;
END $$;

-- RLS for credit_transactions: user can read their own; only service role writes
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own credit_transactions" ON credit_transactions;
CREATE POLICY "users read own credit_transactions"
  ON credit_transactions FOR SELECT
  USING (auth.uid() = user_id);

-- ── 5. RPCs — drop & recreate with NUMERIC amounts ──

-- deduct_credits: atomically subtracts from profiles.credits + logs transaction.
-- Returns the new balance. Throws if insufficient credits.
DROP FUNCTION IF EXISTS deduct_credits(uuid, integer, text, text, uuid, numeric, jsonb);
DROP FUNCTION IF EXISTS deduct_credits(uuid, numeric, text, text, uuid, numeric, jsonb);
CREATE FUNCTION deduct_credits(
  p_user_id UUID,
  p_amount NUMERIC,
  p_reason TEXT,
  p_function_name TEXT DEFAULT NULL,
  p_trip_id UUID DEFAULT NULL,
  p_llm_cost_usd NUMERIC DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance NUMERIC(10,2);
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount: %', p_amount;
  END IF;

  UPDATE profiles
  SET credits = credits - p_amount
  WHERE id = p_user_id
  RETURNING credits INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  -- Allow balance to go slightly negative (in-flight charges). Pre-flight
  -- check in edge functions enforces credits >= 1.0 before LLM call.
  INSERT INTO credit_transactions (
    user_id, amount, balance_after, reason, function_name, trip_id, llm_cost_usd, metadata
  ) VALUES (
    p_user_id, -p_amount, v_new_balance, p_reason, p_function_name, p_trip_id, p_llm_cost_usd, p_metadata
  );

  RETURN v_new_balance;
END;
$$;

-- grant_credits: adds to profiles.credits + logs transaction (idempotent on
-- stripe_session_id when provided — re-runs return existing balance without
-- granting again).
DROP FUNCTION IF EXISTS grant_credits(uuid, integer, text, jsonb);
DROP FUNCTION IF EXISTS grant_credits(uuid, numeric, text, jsonb);
DROP FUNCTION IF EXISTS grant_credits(uuid, numeric, text, jsonb, text);
CREATE FUNCTION grant_credits(
  p_user_id UUID,
  p_amount NUMERIC,
  p_reason TEXT,
  p_metadata JSONB DEFAULT NULL,
  p_stripe_session_id TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance NUMERIC(10,2);
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount: %', p_amount;
  END IF;

  -- Idempotency: if a transaction with this stripe_session_id already exists,
  -- return the user's current balance without re-granting.
  IF p_stripe_session_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM credit_transactions WHERE stripe_session_id = p_stripe_session_id
    ) THEN
      SELECT credits INTO v_new_balance FROM profiles WHERE id = p_user_id;
      RETURN v_new_balance;
    END IF;
  END IF;

  UPDATE profiles
  SET credits = credits + p_amount
  WHERE id = p_user_id
  RETURNING credits INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  INSERT INTO credit_transactions (
    user_id, amount, balance_after, reason, metadata, stripe_session_id
  ) VALUES (
    p_user_id, p_amount, v_new_balance, p_reason, p_metadata, p_stripe_session_id
  );

  RETURN v_new_balance;
END;
$$;

-- Grant execute to authenticated + service role (RPC is called from edge functions w/ service role)
GRANT EXECUTE ON FUNCTION deduct_credits(uuid, numeric, text, text, uuid, numeric, jsonb) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION grant_credits(uuid, numeric, text, jsonb, text) TO service_role, authenticated;
