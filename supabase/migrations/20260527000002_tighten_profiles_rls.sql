-- Day 7: tighten profiles RLS so credits / email / stripe_customer_id /
-- is_admin are NOT readable by other authenticated users.
--
-- Previously: "authenticated users can read any profile" USING (true)
--   → Any logged-in user could SELECT any row from profiles, leaking PII.
-- Now:
--   → Users read only their own row.
--   → Admins (is_admin=true) read all (via SECURITY DEFINER function to
--     avoid RLS recursion when checking the admin's own is_admin flag).
--
-- This change affects only Admin.jsx (which intentionally reads all
-- profiles); regular client paths only read own profile via .eq("id",
-- session.user.id) so they continue to work.

CREATE OR REPLACE FUNCTION public.is_admin_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_admin FROM profiles WHERE id = p_user_id), false);
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin_user(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin_user(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "authenticated users can read any profile" ON profiles;
DROP POLICY IF EXISTS "users read own profile or admin reads any" ON profiles;
CREATE POLICY "users read own profile or admin reads any"
  ON profiles FOR SELECT
  USING (
    auth.uid() = id
    OR public.is_admin_user(auth.uid())
  );
