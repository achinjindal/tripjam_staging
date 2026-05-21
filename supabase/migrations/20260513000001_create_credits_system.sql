-- Credit balance on profiles. Default 50 credits (~$1.75 of LLM at 1 credit = $0.035).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credits integer NOT NULL DEFAULT 50;

-- Per-user transaction log. Positive amounts = grants/purchases, negative = spends.
CREATE TABLE IF NOT EXISTS credit_transactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  balance_after integer NOT NULL,
  reason text NOT NULL,
  function_name text,
  trip_id uuid REFERENCES trips(id) ON DELETE SET NULL,
  llm_cost_usd numeric(10, 6),
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_transactions_user_id_idx
  ON credit_transactions(user_id, created_at DESC);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own transactions" ON credit_transactions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Service role full access" ON credit_transactions
  FOR ALL USING (true);

CREATE POLICY "Admins read all transactions" ON credit_transactions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Atomic deduct: subtracts credits, writes a transaction row, returns new balance.
-- amount_cents is in credits (integer). Allow balance to go slightly negative if a
-- request was already accepted (pre-check passed) but ended up costing more —
-- prefer minor over-spend over failing mid-generation.
CREATE OR REPLACE FUNCTION deduct_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_function_name text DEFAULT NULL,
  p_trip_id uuid DEFAULT NULL,
  p_llm_cost_usd numeric DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance integer;
BEGIN
  UPDATE profiles
     SET credits = credits - p_amount
   WHERE id = p_user_id
  RETURNING credits INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'profile not found for user %', p_user_id;
  END IF;

  INSERT INTO credit_transactions
    (user_id, amount, balance_after, reason, function_name, trip_id, llm_cost_usd, metadata)
  VALUES
    (p_user_id, -p_amount, v_new_balance, p_reason, p_function_name, p_trip_id, p_llm_cost_usd, p_metadata);

  RETURN v_new_balance;
END;
$$;

-- Grant credits (purchases, top-ups, admin grants).
CREATE OR REPLACE FUNCTION grant_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_metadata jsonb DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance integer;
BEGIN
  UPDATE profiles
     SET credits = credits + p_amount
   WHERE id = p_user_id
  RETURNING credits INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'profile not found for user %', p_user_id;
  END IF;

  INSERT INTO credit_transactions
    (user_id, amount, balance_after, reason, metadata)
  VALUES
    (p_user_id, p_amount, v_new_balance, p_reason, p_metadata);

  RETURN v_new_balance;
END;
$$;
