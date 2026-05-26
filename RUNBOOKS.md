# TripJam — Operational Runbooks

Operational SQL snippets and step-by-step procedures for common ops tasks.
Use these from the Supabase SQL editor or via `psql`.

---

## Connecting via psql

```bash
# Staging
PGPASSWORD='<staging-db-password>' psql \
  'postgresql://postgres.wlrzvwjdrjpfqcwgmzch@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'

# Production
PGPASSWORD='<prod-db-password>' psql \
  'postgresql://postgres.viyvdqwwnbbqjuwiuzbh@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'
```

---

## Auth & Account Management

### Manual password reset (user emailed support)

User self-serve reset is not yet wired (see backlog). Until then:

1. Verify the email is real (anti-phishing): user must email from the address they
   claim to own, OR confirm via Twitter/Discord DM that matches the account.
2. Identify the user:
   ```sql
   SELECT id, email, raw_user_meta_data
   FROM auth.users
   WHERE email = '<user-email>' OR id IN (
     SELECT id FROM profiles WHERE username = '<username>'
   );
   ```
3. Send a magic-link via Supabase dashboard:
   - Supabase Studio → Authentication → Users → find user → "Send magic link"
   - OR via SQL trigger `auth.email_change()` workflow

### Backfill email for a legacy user (manual override)

If a legacy user provides their real email but the prompt UI fails:

```sql
-- 1. Set email on auth.users (this fires the sync trigger that updates profiles)
UPDATE auth.users
SET email = '<real-email>',
    email_confirmed_at = NOW()  -- skip confirmation for support-driven changes
WHERE id = '<user-id>';

-- 2. Verify
SELECT u.id, u.email, p.username, p.email AS profile_email, p.display_name
FROM auth.users u
JOIN profiles p ON p.id = u.id
WHERE u.id = '<user-id>';
```

### Delete a user account (GDPR / user request)

```sql
-- WARNING: cascades to all trips, activities, votes, expenses, etc.
-- Snapshot first if needed.
DELETE FROM auth.users WHERE id = '<user-id>';
-- profiles row + all owned tables follow via ON DELETE CASCADE
```

### List legacy users still using `@tripjam.app` synthetic emails

```sql
SELECT u.id, u.email, p.username, p.created_at
FROM auth.users u
JOIN profiles p ON p.id = u.id
WHERE u.email LIKE '%@tripjam.app'
ORDER BY p.created_at DESC;
```

### Identity linking — manual link (advanced)

If Supabase auto-link-by-email is disabled or fails to link a Google sign-in
with an existing username-only account, link manually:

```sql
-- Find both auth.users rows (one per provider)
SELECT id, email, raw_app_meta_data->'providers' AS providers
FROM auth.users
WHERE email IN ('<real-email>', '<legacy-email>');

-- Manual linking is NOT directly supported via SQL — use Supabase REST:
--   POST /auth/v1/admin/users/{user_id}/identities
-- with service_role key. See Supabase docs:
--   https://supabase.com/docs/guides/auth/auth-identity-linking
```

---

## Credits (currently disabled, kept for future)

### Grant credits

```sql
UPDATE profiles SET credits = credits + <amount> WHERE id = '<user-id>';
```

### View top consumers (last 30 days)

```sql
SELECT u.email, p.username,
       SUM(usage_credits) AS total_credits,
       COUNT(*) AS calls
FROM llm_usage l
JOIN profiles p ON p.id = l.user_id
JOIN auth.users u ON u.id = l.user_id
WHERE l.created_at > NOW() - INTERVAL '30 days'
GROUP BY u.email, p.username
ORDER BY total_credits DESC
LIMIT 20;
```

---

## Geocoding (Feature 8 fix)

### Apply manual geocode override (admin trust-list)

When a user reports a wrong-place pin and provides correct coords:

```sql
INSERT INTO geocode_overrides (input_text, lat, lng, source, created_by)
VALUES ('<exact place name>', <lat>, <lng>, 'admin', '<admin-user-id>')
ON CONFLICT (input_text) DO UPDATE
SET lat = EXCLUDED.lat, lng = EXCLUDED.lng;
```

### Refresh an activity's coords (force re-geocode)

```sql
UPDATE activities
SET lat = NULL, lng = NULL, geocode_source = NULL, geocode_confidence = NULL
WHERE id = '<activity-id>';
-- Next time the activity is viewed, TransitionRow will resolve fresh coords
```

### Backfill activities missing coords

```bash
node scripts/backfill-activity-geocodes.cjs --batch-size 200 --env staging
node scripts/backfill-activity-geocodes.cjs --batch-size 200 --env production
```

---

## Deployment

### Standard prod push order (after staging verification)

1. **DB migrations** first (additive only — never drop columns in launch):
   ```bash
   PGPASSWORD='...' psql 'postgresql://postgres.viyvdqwwnbbqjuwiuzbh@...' \
     -v ON_ERROR_STOP=1 -f supabase/migrations/<new-file>.sql
   ```
2. **Edge functions** next (so they can rely on the new schema):
   ```bash
   npm run deploy:functions:prod
   ```
3. **Frontend** last (Vercel auto-deploys on push to `main`):
   ```bash
   git push origin main
   ```

### Rollback

- **Frontend:** Vercel → Deployments → click previous deploy → "Promote to Production"
- **Edge functions:** redeploy the prior commit:
  ```bash
  git checkout <prior-commit> -- supabase/functions/<fn-name>
  npm run deploy:functions:prod
  git checkout main -- supabase/functions/<fn-name>
  ```
- **DB:** only forward migrations. Schedule a remediation migration; never run
  destructive DDL against prod without a snapshot.

### Tags

```bash
git tag v1.0.0-pre-launch        # pre-launch snapshot (already exists)
git tag v1.0.0                   # launch day
git push origin --tags
```

---

## Monitoring

### PostHog dashboards (production)

- Daily active users → app_env = "production"
- Trip-create funnel → events: trip_create_started → trip_create_completed
- IG funnel → events: ig_started → ig_compact_complete → ig_detailed_complete

### Sentry

- Add DSN: Supabase secrets `SENTRY_DSN`, Vercel env `VITE_SENTRY_DSN`
- Configure alert rules (Sentry → Alerts → New alert):
  - "New issue" → Slack/email immediately
  - "Error frequency > 5/min" → page on-call

### Supabase logs

- Dashboard → Logs → Edge Functions → filter by function name + status code
- Common failure modes:
  - 401 = auth missing / token expired
  - 402 = out of credits (credits flow disabled at launch — should not happen)
  - 429 = LLM rate limit (Anthropic) — backoff strategy in edge function

---

## Cost Watch

### Daily LLM spend (last 7 days)

```sql
SELECT DATE(created_at) AS day,
       function_name,
       model,
       COUNT(*) AS calls,
       SUM(cost_estimate_usd) AS spend_usd
FROM llm_usage
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY day, function_name, model
ORDER BY day DESC, spend_usd DESC;
```

### Per-user cost (last 30 days)

```sql
SELECT u.email, p.username,
       SUM(l.cost_estimate_usd) AS spend_usd,
       COUNT(*) AS calls
FROM llm_usage l
JOIN profiles p ON p.id = l.user_id
JOIN auth.users u ON u.id = l.user_id
WHERE l.created_at > NOW() - INTERVAL '30 days'
GROUP BY u.email, p.username
ORDER BY spend_usd DESC
LIMIT 20;
```
