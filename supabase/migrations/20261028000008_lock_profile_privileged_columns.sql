-- Users could write their own credits and is_admin.
--
-- profiles carried Supabase's default table-wide INSERT/UPDATE grants to
-- anon/authenticated, and "Users can update own profile" only checks
-- auth.uid() = id. MEASURED on staging 2026-10-28: a signed-in user's
-- `PATCH /rest/v1/profiles?id=eq.<self> {"credits": 99999}` returned 200 and
-- stuck; prod had identical grants and policies. The same call could set
-- is_admin = true, which unlocks every profile (emails) and the
-- llm_usage / api_usage / rg_log / generation_log admin read policies.
--
-- The browser only ever writes id, username, email and display_name
-- (Auth.jsx signup upsert, ProfileSheet.jsx). Every balance change goes
-- through SECURITY DEFINER functions and the service role, which do not
-- depend on these grants. So: column-level grants for exactly those four.
-- `id` is in the UPDATE list because PostgREST's upsert sets every payload
-- column on conflict; RLS still pins it to auth.uid().
REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;
GRANT INSERT (id, username, email, display_name) ON public.profiles TO authenticated;
GRANT UPDATE (id, username, email, display_name) ON public.profiles TO authenticated;
