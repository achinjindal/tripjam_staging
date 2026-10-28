-- Credit redenomination: 1 new credit = 2 old credits.
--
-- WHY. creditLlmBudgetUsd moves 0.007 -> 0.0035 in llm-rates.json, so a credit
-- now covers half as much LLM spend. The price per credit is unchanged, which
-- means we keep the efficiency gain from the October optimisations instead of
-- passing it on as a silent 2x discount. The factor is not arbitrary: a full
-- trip cost ~$0.150 in late September and ~$0.0765 now (1.96x), so at $0.0035
-- a trip bills ~21.9 credits against ~21.4 before — a returning user sees no
-- change at all.
--
-- WHAT THIS MIGRATION DOES. Doubles every existing balance so nobody loses
-- purchasing power at the cutover. A user holding 250 credits holds 500
-- afterwards and can buy exactly what they could before.
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--   * The signup DEFAULT stays at 100. New accounts therefore get half the
--     free runway (~9 trips -> ~4.6), which is the intended conversion
--     change. Existing users are made whole; the offer changes going forward.
--   * No credit_transactions rows are written. This is a unit change, not a
--     grant: no money moved and no cost was incurred. Writing ~N rows of
--     amount>0 with no provider_session_id would also show up in
--     scripts/gross-profit.cjs as "credits granted free" and corrupt the P&L.
--     The aggregate is recorded in app_config instead.
--
-- ORDERING. Apply this BEFORE deploying the functions that carry the new
-- 0.0035 constant. Between the two steps users briefly hold double value,
-- which is the harmless direction; the reverse would silently halve what
-- everyone owns.

BEGIN;

DO $$
DECLARE
  v_done     boolean;
  v_users    bigint;
  v_credits  numeric;
  v_pools    bigint;
  v_pool_bal numeric;
BEGIN
  -- Re-run guard. Migrations run once per environment, but a `migration
  -- repair` or a --include-all re-push could replay this, and replaying it
  -- QUADRUPLES every balance. A money-affecting migration gets a belt as well
  -- as braces.
  SELECT COALESCE((value->>'applied')::boolean, false) INTO v_done
    FROM app_config WHERE key = 'credit_redenomination_2x';

  IF v_done THEN
    RAISE NOTICE 'credit redenomination already applied — skipping (balances untouched)';
    RETURN;
  END IF;

  -- Negative balances double too. An overdrawn user owes the same real value
  -- before and after, because each credit is now worth half as much.
  UPDATE profiles SET credits = credits * 2;
  GET DIAGNOSTICS v_users = ROW_COUNT;
  SELECT COALESCE(SUM(credits), 0) INTO v_credits FROM profiles;

  UPDATE trips SET credit_balance = credit_balance * 2 WHERE credit_balance <> 0;
  GET DIAGNOSTICS v_pools = ROW_COUNT;
  SELECT COALESCE(SUM(credit_balance), 0) INTO v_pool_bal FROM trips;

  INSERT INTO app_config (key, value)
  VALUES (
    'credit_redenomination_2x',
    jsonb_build_object(
      'applied', true,
      'factor', 2,
      'budget_before_usd', 0.007,
      'budget_after_usd', 0.0035,
      'profiles_updated', v_users,
      'profile_credits_after', v_credits,
      'trip_pools_updated', v_pools,
      'pool_credits_after', v_pool_bal,
      'applied_at', now()
    )
  )
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = now();

  RAISE NOTICE 'redenomination: doubled % profile balances (now % credits) and % trip pools (now %)',
    v_users, v_credits, v_pools, v_pool_bal;
END $$;

COMMIT;
