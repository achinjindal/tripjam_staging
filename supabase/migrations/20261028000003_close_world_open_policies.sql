-- Close the last two world-open "service role" policies.
--
-- Both were created as `FOR ALL USING (true)` with NO `TO` clause, so the
-- policy applied to PUBLIC — every role, including `authenticated`. This is
-- the exact class 20260713000002 fixed on six other tables; these two were
-- missed, and rg_log was created NINE DAYS AFTER that migration, reasoning
-- from generation_log's since-fixed policy. The service role bypasses RLS
-- anyway, so the permissive policies only ever created holes.
--
-- Verified before writing this: no client code reads or writes
-- geocode_overrides (places-proxy reads it with the SERVICE key, bypassing
-- RLS), while rg_log IS written by the browser (src/App.jsx) and read by the
-- Admin console (src/Admin.jsx) — so rg_log needs replacement policies, not
-- just a revocation. Scoping it to service_role alone would have silently
-- broken RG timing telemetry and the admin RG panel.

-- ── geocode_overrides ────────────────────────────────────────────────────
-- A GLOBAL de-facto geocode cache, consulted FIRST in the resolution ladder
-- (places-proxy checkOverride). Two separate holes:
--   1. `FOR ALL USING (true)` let any authenticated user UPDATE or DELETE an
--      override, changing the coordinates every other user resolves.
--   2. "User insert own" let any authenticated user INSERT an override for a
--      place that has none — same poisoning outcome, one step removed. It is
--      also dead: nothing in the codebase inserts here (the table is curated
--      out-of-band via the dashboard, which uses the service role).
-- SELECT stays open to authenticated: reading cached coordinates is not a
-- vector, and leaving it avoids breaking any read path not found by grep.
DROP POLICY IF EXISTS "Service role full" ON geocode_overrides;
CREATE POLICY "Service role full" ON geocode_overrides
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "User insert own" ON geocode_overrides;

-- ── rg_log ───────────────────────────────────────────────────────────────
-- Route-generation timing. `FOR ALL USING (true)` let any authenticated user
-- read, rewrite or DELETE all RG telemetry for every user.
--
-- The table has no user_id column, so an INSERT cannot be scoped to "own
-- rows"; authenticated INSERT stays open because the browser writes these
-- rows itself (App.jsx, fire-and-forget after an RG stream). The ceiling on
-- that is junk timing rows in an internal metrics table — which was already
-- possible — whereas reading and deleting everyone's telemetry is not.
DROP POLICY IF EXISTS "Service role full access" ON rg_log;
CREATE POLICY "Service role full access" ON rg_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Client-side timing writes (src/App.jsx rg_log insert).
DROP POLICY IF EXISTS "Authenticated insert timing" ON rg_log;
CREATE POLICY "Authenticated insert timing" ON rg_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- Admin console reads (src/Admin.jsx loadTripDetail). auth.uid() is wrapped
-- in a sub-select so Postgres hoists it to an InitPlan and evaluates the
-- admin check ONCE per query instead of once per scanned row.
DROP POLICY IF EXISTS "Admins can read rg_log" ON rg_log;
CREATE POLICY "Admins can read rg_log" ON rg_log
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = (SELECT auth.uid()) AND is_admin = true
    )
  );
