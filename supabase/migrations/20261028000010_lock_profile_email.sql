-- Follow-up to 20261028000008: profiles.email must not be user-writable either.
--
-- inbound-email resolves a forwarded booking's sender to an account with
-- `profiles?email=eq.<sender>` (service role). With email writable, a user
-- could PATCH their own row to a victim's address; the victim's genuinely
-- SPF/DKIM-passing forwards would then file into the ATTACKER's trips
-- (names, PNRs, hotels). send-email also mails profiles.email.
--
-- Nothing in the browser needs to write it: create_profile_on_signup sets it
-- from auth.users at signup, and sync_profile_email_from_auth keeps it in
-- step on every auth email change (both SECURITY DEFINER). Auth.jsx's
-- belt-and-braces upsert stops sending it in the same change; it only runs
-- when signUp returns a session, which never happens on prod (email
-- confirmation), so old clients are unaffected there.
REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;
GRANT INSERT (id, username, display_name) ON public.profiles TO authenticated;
GRANT UPDATE (id, username, display_name) ON public.profiles TO authenticated;
