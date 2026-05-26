-- Prod schema-only migration for the Day 2/3 credits + payments launch.
--
-- Unlike the staging migration (20260526000003), this one INTENTIONALLY:
--   ✗ Does NOT reset profiles.credits (keeps existing 999999 balances)
--   ✗ Does NOT change behavior — old edge function code still works
--   ✓ Only changes types + adds columns + recreates RPCs (additive)
--
-- After this lands, prod is "primed" for launch. To go live with credits:
--   1. Decide launch starting balance (current default still 999999 effectively
--      — change DEFAULT below + run `UPDATE profiles SET credits = N` when ready).
--   2. Deploy new edge functions (Day 2 _shared/credits.ts changes, pre-flight,
--      create-checkout, payment-webhook).
--   3. Set Lemon Squeezy secrets on prod Supabase + register prod webhook in LS dashboard.
--   4. Flip CREDITS_UI_ENABLED to true on prod (currently auto-detects, prod = false).
--   5. Switch Lemon Squeezy from TEST mode to LIVE mode for real money.

-- ── 1. Change profiles.credits to NUMERIC(10,2) ──
--    NOTE: keeping DEFAULT at 999999 for now. Change to 300 (or chosen value)
--    on launch day along with the balance UPDATE.
ALTER TABLE profiles ALTER COLUMN credits TYPE NUMERIC(10,2) USING credits::numeric;

-- ── 2. Add stripe_customer_id (additive, idempotent) ──
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
CREATE INDEX IF NOT EXISTS profiles_stripe_customer_id_idx
  ON profiles(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ── 3. credit_transactions: change types + add provider_session_id ──
--    Prod already has this table with integer columns; alter in place.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credit_transactions') THEN
    ALTER TABLE credit_transactions ALTER COLUMN amount TYPE NUMERIC(10,2) USING amount::numeric;
    ALTER TABLE credit_transactions ALTER COLUMN balance_after TYPE NUMERIC(10,2) USING balance_after::numeric;
    ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS provider_session_id TEXT;
  ELSE
    -- Defensive: create from scratch if somehow missing
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
      provider_session_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX credit_transactions_user_id_idx ON credit_transactions(user_id, created_at DESC);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_provider_session_id_key
  ON credit_transactions(provider_session_id)
  WHERE provider_session_id IS NOT NULL;

-- ── 4. RLS on credit_transactions ──
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own credit_transactions" ON credit_transactions;
CREATE POLICY "users read own credit_transactions"
  ON credit_transactions FOR SELECT
  USING (auth.uid() = user_id);

-- ── 5. Recreate RPCs with NUMERIC + provider-neutral param ──
--    Old integer RPCs are dropped. Edge functions calling with integer amounts
--    will continue to work because Postgres coerces JSON numbers to NUMERIC.

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
  UPDATE profiles SET credits = credits - p_amount WHERE id = p_user_id RETURNING credits INTO v_new_balance;
  IF v_new_balance IS NULL THEN RAISE EXCEPTION 'User not found: %', p_user_id; END IF;
  INSERT INTO credit_transactions (user_id, amount, balance_after, reason, function_name, trip_id, llm_cost_usd, metadata)
  VALUES (p_user_id, -p_amount, v_new_balance, p_reason, p_function_name, p_trip_id, p_llm_cost_usd, p_metadata);
  RETURN v_new_balance;
END;
$$;

DROP FUNCTION IF EXISTS grant_credits(uuid, integer, text, jsonb);
DROP FUNCTION IF EXISTS grant_credits(uuid, numeric, text, jsonb);
DROP FUNCTION IF EXISTS grant_credits(uuid, numeric, text, jsonb, text);
CREATE FUNCTION grant_credits(
  p_user_id UUID,
  p_amount NUMERIC,
  p_reason TEXT,
  p_metadata JSONB DEFAULT NULL,
  p_provider_session_id TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance NUMERIC(10,2);
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Invalid amount: %', p_amount; END IF;
  -- Idempotency on provider session/order id
  IF p_provider_session_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM credit_transactions WHERE provider_session_id = p_provider_session_id) THEN
      SELECT credits INTO v_new_balance FROM profiles WHERE id = p_user_id;
      RETURN v_new_balance;
    END IF;
  END IF;
  UPDATE profiles SET credits = credits + p_amount WHERE id = p_user_id RETURNING credits INTO v_new_balance;
  IF v_new_balance IS NULL THEN RAISE EXCEPTION 'User not found: %', p_user_id; END IF;
  INSERT INTO credit_transactions (user_id, amount, balance_after, reason, metadata, provider_session_id)
  VALUES (p_user_id, p_amount, v_new_balance, p_reason, p_metadata, p_provider_session_id);
  RETURN v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_credits(uuid, numeric, text, text, uuid, numeric, jsonb) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION grant_credits(uuid, numeric, text, jsonb, text) TO service_role, authenticated;
