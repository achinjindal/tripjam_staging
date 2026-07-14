-- Scope the "Service role full access" policies.
--
-- These were created with no TO clause, so `FOR ALL USING (true)` applied to
-- every role — any authenticated (or in some cases anon) client could read
-- and write llm_usage, api_usage, generation_log, credit_transactions,
-- place_cache and destination_research. The service role bypasses RLS anyway,
-- so the permissive policies only created holes.
--
-- Recreate them scoped TO service_role (explicit no-ops), and add the
-- narrowly-scoped policies that clients actually rely on.

-- ── llm_usage ──────────────────────────────────────────────────────────
-- Written by edge functions (service key); read by Admin console
-- ("Admins can read llm_usage" policy already exists).
DROP POLICY IF EXISTS "Service role full access" ON llm_usage;
CREATE POLICY "Service role full access" ON llm_usage
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── api_usage ──────────────────────────────────────────────────────────
-- Written by edge functions; Admin console reads it directly.
DROP POLICY IF EXISTS "Service role full access" ON api_usage;
CREATE POLICY "Service role full access" ON api_usage
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admins can read api_usage" ON api_usage;
CREATE POLICY "Admins can read api_usage" ON api_usage
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- ── generation_log ─────────────────────────────────────────────────────
-- The IG flow writes timing rows from the client (App.jsx insert/update with
-- RETURNING), so authenticated users need full row access for their own trips.
DROP POLICY IF EXISTS "Service role full access" ON generation_log;
CREATE POLICY "Service role full access" ON generation_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Members manage generation_log for their trips" ON generation_log;
CREATE POLICY "Members manage generation_log for their trips" ON generation_log
  FOR ALL TO authenticated
  USING (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
    OR trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Admins can read generation_log" ON generation_log;
CREATE POLICY "Admins can read generation_log" ON generation_log
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- ── credit_transactions ────────────────────────────────────────────────
-- "Users read own transactions" and "Admins read all transactions" already
-- exist; only the payment/coupon edge functions (service key) write rows.
DROP POLICY IF EXISTS "Service role full access" ON credit_transactions;
CREATE POLICY "Service role full access" ON credit_transactions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── place_cache ────────────────────────────────────────────────────────
-- Only the places-proxy edge function touches this table.
DROP POLICY IF EXISTS "Service role full access" ON place_cache;
CREATE POLICY "Service role full access" ON place_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── destination_research ───────────────────────────────────────────────
-- "Anyone authenticated can read research" already exists; only the
-- generate-destination-research edge function writes.
DROP POLICY IF EXISTS "Service role full access" ON destination_research;
CREATE POLICY "Service role full access" ON destination_research
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── trip_members: DELETE was never allowed ─────────────────────────────
-- Home.jsx's delete-trip flow removes member rows, and users should be able
-- to leave a trip. Previously this silently deleted nothing (covered only by
-- the FK cascade when the trip row went away).
DROP POLICY IF EXISTS "Creators and members can delete memberships" ON trip_members;
CREATE POLICY "Creators and members can delete memberships" ON trip_members
  FOR DELETE TO authenticated USING (
    user_id = auth.uid()
    OR trip_id IN (SELECT id FROM trips WHERE created_by = auth.uid())
  );
