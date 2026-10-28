-- Internal cost accounting: an atomic API counter, per-trip ledger indexes,
-- and a per-task rollup view. Internal/service-role only — there is
-- deliberately no user-facing ledger.

-- ── 1. incr_api_usage: ATOMIC counter, returns the post-increment total ─────
-- places-proxy's incrementUsage is read-then-PATCH, so concurrent bursts lose
-- increments (its own comment claims "atomic upsert via ON CONFLICT", which it
-- is not). That was tolerable for a quota guard that fails open; it is NOT
-- tolerable for a BILLING decision, which is what Brave free-tier accounting
-- needs. ON CONFLICT DO UPDATE is atomic under concurrency, and RETURNING
-- gives the caller the new total so it can price only the queries that fell
-- beyond the free allowance.
CREATE OR REPLACE FUNCTION incr_api_usage(
  p_api TEXT,
  p_scope TEXT,
  p_period TEXT,
  p_amount INT DEFAULT 1
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO api_usage (api, scope, period, count, updated_at)
  VALUES (p_api, p_scope, p_period, p_amount, now())
  ON CONFLICT (api, scope, period)
  DO UPDATE SET count = api_usage.count + p_amount, updated_at = now()
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION incr_api_usage(text, text, text, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION incr_api_usage(text, text, text, int) TO service_role;

-- ── 2. Indexes for per-trip cost queries ───────────────────────────────────
-- credit_transactions had only (user_id, created_at), and llm_usage had NO
-- index at all beyond its PK. So every per-trip cost question (the ledger
-- below, scripts/trip-cost.cjs, the Admin trip drawer) was a full table scan
-- plus a top-N sort.
CREATE INDEX IF NOT EXISTS credit_transactions_trip_idx
  ON credit_transactions(trip_id, created_at DESC)
  WHERE trip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_transactions_created_idx
  ON credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_trip_idx
  ON llm_usage(trip_id, created_at DESC)
  WHERE trip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS llm_usage_created_idx
  ON llm_usage(created_at DESC);

-- Wrap auth.uid() in a sub-select so the planner hoists it to an InitPlan and
-- evaluates the admin check ONCE per query. Unwrapped, this EXISTS ran for
-- every scanned row, which is the worst possible shape on an unindexed table.
DROP POLICY IF EXISTS "Admins can read llm_usage" ON llm_usage;
CREATE POLICY "Admins can read llm_usage" ON llm_usage
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = (SELECT auth.uid()) AND is_admin = true
    )
  );

-- ── 3. trip_task_cost: per-trip, per-task rollup ───────────────────────────
-- credit_transactions is the authoritative ledger: it is the only table
-- carrying our USD cost (llm_usage has tokens but NO cost column, which is why
-- Admin and trip-cost.cjs recompute from llm-rates.json). `task` is the
-- function_name where present, else the reason, so a sub-task keeps its own
-- line (generate-itinerary:timeout, :escalation, :brave-search) instead of
-- being folded into its parent.
--
-- CAVEAT, by design: deliberately unbilled paths (extract-preferences,
-- inbound-email) produce NO row here, so this shows what users were CHARGED,
-- which is not the same as what we SPENT. Use scripts/gross-profit.cjs for
-- true cost.
CREATE OR REPLACE VIEW trip_task_cost
WITH (security_invoker = true) AS
SELECT
  ct.trip_id,
  COALESCE(NULLIF(ct.function_name, ''), ct.reason) AS task,
  COUNT(*)                                          AS calls,
  SUM(-ct.amount)                                   AS credits_charged,
  SUM(COALESCE(ct.llm_cost_usd, 0))                 AS our_cost_usd,
  MIN(ct.created_at)                                AS first_at,
  MAX(ct.created_at)                                AS last_at
FROM credit_transactions ct
WHERE ct.amount < 0            -- debits only; grants are revenue, not cost
GROUP BY ct.trip_id, COALESCE(NULLIF(ct.function_name, ''), ct.reason);

REVOKE ALL ON trip_task_cost FROM PUBLIC, anon;
GRANT SELECT ON trip_task_cost TO service_role, authenticated;

COMMENT ON VIEW trip_task_cost IS
  'Internal per-trip per-task credit + USD rollup. Debits only. Excludes '
  'deliberately unbilled paths (extract-preferences, inbound-email) — see '
  'scripts/gross-profit.cjs for true spend.';
