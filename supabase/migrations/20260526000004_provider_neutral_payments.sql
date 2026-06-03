-- Day 2 Part C addendum — Provider-neutral payment columns.
--
-- Stripe is invite-only in India; switching to Lemon Squeezy as Merchant of
-- Record. The schema works for any payment provider — only the column +
-- RPC parameter names change to reflect provider neutrality.

-- 1. Rename column (idempotent guards: only rename if old name exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_transactions' AND column_name = 'stripe_session_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_transactions' AND column_name = 'provider_session_id'
  ) THEN
    ALTER TABLE credit_transactions RENAME COLUMN stripe_session_id TO provider_session_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'credit_transactions_stripe_session_id_key')
     AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'credit_transactions_provider_session_id_key') THEN
    ALTER INDEX credit_transactions_stripe_session_id_key RENAME TO credit_transactions_provider_session_id_key;
  END IF;
END $$;

-- 2. Recreate grant_credits RPC with provider-neutral param name
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
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount: %', p_amount;
  END IF;

  -- Idempotency on provider session/order id
  IF p_provider_session_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM credit_transactions WHERE provider_session_id = p_provider_session_id
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
    user_id, amount, balance_after, reason, metadata, provider_session_id
  ) VALUES (
    p_user_id, p_amount, v_new_balance, p_reason, p_metadata, p_provider_session_id
  );

  RETURN v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION grant_credits(uuid, numeric, text, jsonb, text) TO service_role, authenticated;
