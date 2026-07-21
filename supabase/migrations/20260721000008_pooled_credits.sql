-- ============================================================================
-- Phase 2.5 · pooled per-trip credits — money-path RPCs (ships DARK)
-- ============================================================================
-- Model: SOLO trip (trip_members <= 1) → personal wallet, BYTE-IDENTICAL to
-- today. SHARED trip (> 1) → pool-first: charge trips.credit_balance; if the
-- pool can't cover it, the gate forks (never silently drains personal).
--
-- Safety: additive + reversible. deduct_credits/grant_credits are DROP+CREATE'd
-- to add trailing params; all callers invoke by NAMED args so the new defaults
-- keep un-updated (deployed) functions working during the migrate→deploy window.
-- `p_source='auto'` resolves internally, so a solo/null-trip call is unchanged.
-- ============================================================================

-- ── resolve_credit_source: the single source of truth (gate + deduction) ──
-- Returns which wallet pays and its current balance, in one round-trip.
--   personal → profiles.credits   |   pool → trips.credit_balance
-- Solo trip, null trip, or an explicit personal opt-in → always 'personal'.
CREATE OR REPLACE FUNCTION resolve_credit_source(
  p_user uuid,
  p_trip uuid DEFAULT NULL,
  p_prefer_personal boolean DEFAULT false
)
RETURNS TABLE(source text, balance numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  v_members int;
  v_personal numeric;
  v_pool numeric;
BEGIN
  SELECT credits INTO v_personal FROM profiles WHERE id = p_user;
  v_personal := COALESCE(v_personal, 0);

  IF p_trip IS NULL OR p_prefer_personal THEN
    RETURN QUERY SELECT 'personal'::text, v_personal;
    RETURN;
  END IF;

  SELECT count(*) INTO v_members FROM trip_members WHERE trip_id = p_trip;
  IF v_members <= 1 THEN
    -- Solo trip: personal wallet, exactly as today (the pool is ignored).
    RETURN QUERY SELECT 'personal'::text, v_personal;
    RETURN;
  END IF;

  -- Shared trip → the trip pool pays (gate compares balance >= min; if short,
  -- it forks with code 'empty_trip_pool'). Pool may be 0 (unfunded).
  SELECT credit_balance INTO v_pool FROM trips WHERE id = p_trip;
  RETURN QUERY SELECT 'pool'::text, COALESCE(v_pool, 0);
END $$;

-- service_role ONLY: these SECURITY DEFINER money functions must never be
-- callable by anon/authenticated (they take p_user_id and don't check auth.uid,
-- so a direct call could mint/deduct arbitrary credits). Supabase's default
-- privileges grant EXECUTE to anon+authenticated on new public functions, so we
-- REVOKE from them BY NAME (REVOKE FROM PUBLIC alone does NOT remove those
-- explicit grants). (This also closes the pre-existing hole
-- where the launch migration granted deduct_credits/grant_credits to
-- `authenticated` — the edge functions only ever call these via service_role.)
REVOKE ALL ON FUNCTION resolve_credit_source(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION resolve_credit_source(uuid, uuid, boolean)
  TO service_role;

-- ── deduct_credits: add p_source; charge the resolved wallet ──
-- Old signature (7 args) is replaced by an 8-arg version. p_source:
--   'personal' → profiles.credits (today's path, untouched)
--   'pool'     → trips.credit_balance (shared-trip spend)
--   'auto'     → resolve internally (backward-compat for un-updated callers;
--                solo/null trip resolves to 'personal' = identical to today)
-- Negative balances are allowed (matches today's personal overdraw); the UI
-- clamps display to >= 0. balance_after = the charged wallet's new balance;
-- metadata.source records which wallet paid.
DROP FUNCTION IF EXISTS deduct_credits(uuid, numeric, text, text, uuid, numeric, jsonb);
CREATE FUNCTION deduct_credits(
  p_user_id UUID,
  p_amount NUMERIC,
  p_reason TEXT,
  p_function_name TEXT DEFAULT NULL,
  p_trip_id UUID DEFAULT NULL,
  p_llm_cost_usd NUMERIC DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL,
  p_source TEXT DEFAULT 'auto'
)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_balance NUMERIC(10,2);
  v_source TEXT := p_source;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount: %', p_amount;
  END IF;

  IF v_source = 'auto' THEN
    SELECT source INTO v_source
      FROM resolve_credit_source(p_user_id, p_trip_id, false);
  END IF;

  IF v_source = 'pool' AND p_trip_id IS NOT NULL THEN
    UPDATE trips SET credit_balance = credit_balance - p_amount
      WHERE id = p_trip_id
      RETURNING credit_balance INTO v_new_balance;
    IF v_new_balance IS NULL THEN
      RAISE EXCEPTION 'Trip not found: %', p_trip_id;
    END IF;
  ELSE
    v_source := 'personal';
    UPDATE profiles SET credits = credits - p_amount
      WHERE id = p_user_id
      RETURNING credits INTO v_new_balance;
    IF v_new_balance IS NULL THEN
      RAISE EXCEPTION 'User not found: %', p_user_id;
    END IF;
  END IF;

  INSERT INTO credit_transactions (
    user_id, amount, balance_after, reason, function_name,
    trip_id, llm_cost_usd, metadata
  )
  VALUES (
    p_user_id, -p_amount, v_new_balance, p_reason, p_function_name,
    p_trip_id, p_llm_cost_usd,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('source', v_source)
  );
  RETURN v_new_balance;
END $$;

REVOKE ALL ON FUNCTION
  deduct_credits(uuid, numeric, text, text, uuid, numeric, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  deduct_credits(uuid, numeric, text, text, uuid, numeric, jsonb, text)
  TO service_role;

-- ── grant_credits: add p_trip_id → fund the trip pool instead of the wallet ──
-- Keeps the IDENTICAL provider_session_id idempotency block (webhook replays
-- never double-fund). p_trip_id NULL → personal wallet (today's path).
DROP FUNCTION IF EXISTS grant_credits(uuid, numeric, text, jsonb, text);
CREATE FUNCTION grant_credits(
  p_user_id UUID,
  p_amount NUMERIC,
  p_reason TEXT,
  p_metadata JSONB DEFAULT NULL,
  p_provider_session_id TEXT DEFAULT NULL,
  p_trip_id UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_balance NUMERIC(10,2);
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount: %', p_amount;
  END IF;

  -- Idempotency: if this provider session already granted, return current
  -- balance of the target wallet without re-granting.
  IF p_provider_session_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM credit_transactions
                  WHERE provider_session_id = p_provider_session_id) THEN
    IF p_trip_id IS NOT NULL THEN
      SELECT credit_balance INTO v_new_balance FROM trips WHERE id = p_trip_id;
    ELSE
      SELECT credits INTO v_new_balance FROM profiles WHERE id = p_user_id;
    END IF;
    RETURN v_new_balance;
  END IF;

  IF p_trip_id IS NOT NULL THEN
    UPDATE trips SET credit_balance = credit_balance + p_amount
      WHERE id = p_trip_id
      RETURNING credit_balance INTO v_new_balance;
    IF v_new_balance IS NULL THEN
      RAISE EXCEPTION 'Trip not found: %', p_trip_id;
    END IF;
  ELSE
    UPDATE profiles SET credits = credits + p_amount
      WHERE id = p_user_id
      RETURNING credits INTO v_new_balance;
    IF v_new_balance IS NULL THEN
      RAISE EXCEPTION 'User not found: %', p_user_id;
    END IF;
  END IF;

  INSERT INTO credit_transactions (
    user_id, amount, balance_after, reason, trip_id, metadata, provider_session_id
  )
  VALUES (
    p_user_id, p_amount, v_new_balance, p_reason, p_trip_id,
    COALESCE(p_metadata, '{}'::jsonb)
      || jsonb_build_object('source',
           CASE WHEN p_trip_id IS NOT NULL THEN 'pool' ELSE 'personal' END),
    p_provider_session_id
  );
  RETURN v_new_balance;
END $$;

REVOKE ALL ON FUNCTION
  grant_credits(uuid, numeric, text, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  grant_credits(uuid, numeric, text, jsonb, text, uuid)
  TO service_role;
