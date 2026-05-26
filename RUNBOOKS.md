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

## Stripe Setup (Day 2 → Day 3)

### One-time account setup

1. Create Stripe account at https://dashboard.stripe.com/register (use your business email).
2. Stay in **Test mode** for staging. **Live mode** only for production launch.

### Create the two credit packs (Test mode first)

Stripe Dashboard → Products → Create product (do this twice):

| Pack  | Name              | Price | Credits | Description                |
|-------|-------------------|-------|---------|----------------------------|
| Small | TripJam 300 Credits | $5.00 USD | 300 | One-time, no subscription   |
| Large | TripJam 1000 Credits | $10.00 USD | 1000 | One-time, no subscription   |

- **Pricing model:** "Standard pricing", one-time
- **Tax behavior:** "Exclusive" (or per local regulation)
- **Recurring:** No (one-time only)

After creating, copy each product's **Price ID** (starts with `price_`):
- `STRIPE_PRICE_ID_SMALL` = price_xxx (300 credits)
- `STRIPE_PRICE_ID_LARGE` = price_xxx (1000 credits)

Repeat for **Live mode** when going to production.

### Edge Function secrets (run for each env)

```bash
# Staging (test mode)
supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  STRIPE_PRICE_ID_SMALL=price_... \
  STRIPE_PRICE_ID_LARGE=price_... \
  APP_PUBLIC_URL=https://tripjam-staging.vercel.app \
  --project-ref wlrzvwjdrjpfqcwgmzch

# Production (live mode)
supabase secrets set \
  STRIPE_SECRET_KEY=sk_live_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  STRIPE_PRICE_ID_SMALL=price_... \
  STRIPE_PRICE_ID_LARGE=price_... \
  APP_PUBLIC_URL=https://tripjam.vercel.app \
  --project-ref viyvdqwwnbbqjuwiuzbh
```

### Webhook registration

Stripe Dashboard → Developers → Webhooks → Add endpoint:

- **Endpoint URL:** `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`
- **Events to send:** `checkout.session.completed`
- Click "Add endpoint" → reveal the **Signing secret** (starts with `whsec_`) → use it for `STRIPE_WEBHOOK_SECRET` above.

### Redeploy webhook with JWT verification disabled

The webhook must be reachable by Stripe's servers (no Supabase auth). Stripe signature verification replaces JWT auth:

```bash
# Staging
supabase functions deploy stripe-webhook --no-verify-jwt --project-ref wlrzvwjdrjpfqcwgmzch
# Production
supabase functions deploy stripe-webhook --no-verify-jwt --project-ref viyvdqwwnbbqjuwiuzbh
```

### Vercel env var to enable the UI

In Vercel Dashboard → Settings → Environment Variables, add for all environments:

- `VITE_STRIPE_ENABLED=true`

Trigger a redeploy. Until this flag is set, the "Top up" button shows
"launching soon" instead of opening Stripe.

### End-to-end test

1. Sign in to staging with `qa-tester` or a real test account.
2. Trigger the paywall (e.g. set credits to 0 in DB and try to generate-brainstorm).
3. Click **Top up** → choose **Small** → completes Stripe test checkout (card 4242 4242 4242 4242, any future expiry, any CVC).
4. Verify webhook fires (Stripe Dashboard → Webhooks → Recent deliveries → 200 OK).
5. Verify credits granted:
   ```sql
   SELECT username, credits FROM profiles WHERE username = 'qa-tester';
   SELECT amount, balance_after, reason, stripe_session_id, created_at
   FROM credit_transactions WHERE user_id = '<qa-tester-uuid>'
   ORDER BY created_at DESC LIMIT 5;
   ```
6. **Idempotency test:** Stripe Dashboard → Webhooks → click the delivery → "Resend" → verify balance does NOT increase a second time (idempotent on `stripe_session_id`).

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
