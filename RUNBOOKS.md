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

## Prod credits launch (current state + steps to go live)

**Current state on prod (as of last migration):**
- ✅ Schema migrated: `profiles.credits` is `NUMERIC(10,2)`, `stripe_customer_id` added, `credit_transactions` has `provider_session_id` UNIQUE
- ✅ RPCs updated: `deduct_credits` + `grant_credits` accept NUMERIC, idempotent on `provider_session_id`
- ✅ User balances preserved (~999999 each — intentionally inflated, effectively unlimited)
- ❌ Edge functions still on OLD code (using `Math.max(1, ...)` floor + old `_shared/credits.ts`)
- ❌ Credits UI hidden on prod (`CREDITS_UI_ENABLED` auto-detects via VITE_SUPABASE_URL and returns `false`)
- ❌ Lemon Squeezy secrets not set on prod Supabase
- ❌ Webhook not registered for prod URL in Lemon Squeezy dashboard

**To go live (full launch checklist):**

1. **Choose launch starting balance** (replace `300` with chosen value):
   ```sql
   -- On prod DB
   UPDATE profiles SET credits = 300 WHERE credits >= 999000;  -- reset only the inflated test balances
   ALTER TABLE profiles ALTER COLUMN credits SET DEFAULT 300;
   ```

2. **Deploy Day 2/3 edge functions to prod:**
   ```bash
   npm run deploy:functions:prod
   # then separately for the webhook with --no-verify-jwt:
   supabase functions deploy payment-webhook --no-verify-jwt --project-ref viyvdqwwnbbqjuwiuzbh
   ```

3. **Set Lemon Squeezy secrets on prod Supabase:**
   ```bash
   supabase secrets set \
     LEMONSQUEEZY_API_KEY='<same key>' \
     LEMONSQUEEZY_STORE_ID='388127' \
     LEMONSQUEEZY_VARIANT_SMALL='1707537' \
     LEMONSQUEEZY_VARIANT_LARGE='1707540' \
     LEMONSQUEEZY_WEBHOOK_SECRET='<NEW 40-char secret — different from staging>' \
     APP_PUBLIC_URL='https://tripjam.vercel.app' \
     --project-ref viyvdqwwnbbqjuwiuzbh
   ```

4. **Register the prod webhook in Lemon Squeezy dashboard:**
   - Callback URL: `https://viyvdqwwnbbqjuwiuzbh.supabase.co/functions/v1/payment-webhook`
   - Secret: matches what you set above
   - Events: only `order_created`

5. **Flip frontend flag to enable UI on prod:**
   Edit `src/credits.js` — replace the conditional:
   ```js
   export const CREDITS_UI_ENABLED = true;  // launched
   ```
   Also set `VITE_PAYMENTS_ENABLED=true` in Vercel env vars for production.

6. **Switch Lemon Squeezy from TEST to LIVE mode** (real money):
   - Complete LS payout setup (KYC + Wise/PayPal/bank)
   - LS dashboard → toggle Test mode OFF
   - Same product variants work in both modes

7. **Smoke test on prod after deploy:**
   - Sign in with a real account
   - Verify avatar dropdown shows balance
   - Trigger paywall, attempt purchase with real card → verify webhook fires + credits granted

---

## Lemon Squeezy Setup (Day 2 → Day 3)

Lemon Squeezy is our Merchant of Record (Stripe India is invite-only).
They handle VAT/sales tax, refunds, and chargebacks; we just plug in.

### One-time account setup

1. Sign up at https://app.lemonsqueezy.com/register (any email).
2. Complete identity verification (KYC) — quick for individuals.
3. Set up payout method: PayPal, Wise, or direct bank (India supported).
4. **Create a store** with `USD` as the default currency. ⚠️ Store currency
   is locked at creation — if you accidentally created it with INR, delete
   and recreate. Pricing in USD ensures international buyers see consistent
   amounts; Lemon Squeezy auto-converts at checkout.

### Create the two credit packs

Dashboard → Products → New product. Do this twice:

| Pack  | Name                | Price       | Credits | Tax category                       |
|-------|---------------------|-------------|---------|------------------------------------|
| Small | TripJam 300 Credits | $5.00 USD   | 300     | Software as a service (SaaS) - personal use |
| Large | TripJam 1000 Credits | $10.00 USD | 1000    | Software as a service (SaaS) - personal use |

- **Pricing model:** Standard pricing (one-time)
- **Recurring:** No
- **Description:** "300 credits for TripJam — generate itineraries, explore destinations, get AI travel tips."

After publishing each product, grab the **Variant ID** (the URL contains
`/products/<product_id>/variants/<variant_id>` or via API call to
`GET /v1/variants?filter[product_id]=<product_id>`).

### Grab IDs and keys

| Where | Value | Env name |
|---|---|---|
| Settings → API → New API token | API key starting `eyJ...` | `LEMONSQUEEZY_API_KEY` |
| Settings → Stores → click your store | Numeric store ID (URL path) | `LEMONSQUEEZY_STORE_ID` |
| Small product page → Variants | Numeric variant ID | `LEMONSQUEEZY_VARIANT_SMALL` |
| Large product page → Variants | Numeric variant ID | `LEMONSQUEEZY_VARIANT_LARGE` |
| Set when creating webhook (below) | Any string ≥6 chars (use 32+ random) | `LEMONSQUEEZY_WEBHOOK_SECRET` |

### Edge Function secrets (run once per env)

```bash
# Staging
supabase secrets set \
  LEMONSQUEEZY_API_KEY='eyJ...' \
  LEMONSQUEEZY_STORE_ID='12345' \
  LEMONSQUEEZY_VARIANT_SMALL='67890' \
  LEMONSQUEEZY_VARIANT_LARGE='67891' \
  LEMONSQUEEZY_WEBHOOK_SECRET='<32+ random chars>' \
  APP_PUBLIC_URL='https://tripjam-staging.vercel.app' \
  --project-ref wlrzvwjdrjpfqcwgmzch

# Production (use the same Lemon Squeezy account; same IDs are fine)
supabase secrets set \
  LEMONSQUEEZY_API_KEY='eyJ...' \
  LEMONSQUEEZY_STORE_ID='12345' \
  LEMONSQUEEZY_VARIANT_SMALL='67890' \
  LEMONSQUEEZY_VARIANT_LARGE='67891' \
  LEMONSQUEEZY_WEBHOOK_SECRET='<32+ random chars>' \
  APP_PUBLIC_URL='https://tripjam.vercel.app' \
  --project-ref viyvdqwwnbbqjuwiuzbh
```

> Tip: Lemon Squeezy has a **Test mode** toggle. Keep test mode ON in your
> store while validating staging. Switch OFF (live mode) before launching prod.

### Webhook registration

Lemon Squeezy Dashboard → Settings → Webhooks → Add new webhook:

- **Callback URL:** `https://<project-ref>.supabase.co/functions/v1/payment-webhook`
- **Signing secret:** the value you used for `LEMONSQUEEZY_WEBHOOK_SECRET` above (32+ random chars). Must match exactly.
- **Events:** check **only** `order_created` for now. (Add `order_refunded` later if you want to claw back credits on refunds.)
- Save.

Repeat for the production project URL.

### Redeploy webhook with JWT verification disabled

The webhook must be reachable by Lemon Squeezy's servers without a Supabase
auth header. Our HMAC signature verification replaces JWT auth:

```bash
# Staging
supabase functions deploy payment-webhook --no-verify-jwt --project-ref wlrzvwjdrjpfqcwgmzch
# Production
supabase functions deploy payment-webhook --no-verify-jwt --project-ref viyvdqwwnbbqjuwiuzbh
```

### Vercel env var to enable the UI

In Vercel Dashboard → Settings → Environment Variables, add for all environments:

- `VITE_PAYMENTS_ENABLED=true`

Trigger a redeploy. Until this flag is set, the "Top up" button shows
"launching soon" instead of opening checkout.

### Webhook replay / debugging

If a customer pays but their credits don't update (webhook delivery failed,
or our handler had a bug):

1. **Find the order in Lemon Squeezy dashboard** → Orders → search by email or order ID.
2. **Check Settings → Webhooks → click your webhook → Recent deliveries.**
   - Find the failed delivery (red status). Click for details.
   - "Send again" button replays the request with the same payload + signature.
3. **Verify in DB:**
   ```sql
   SELECT amount, balance_after, reason, provider_session_id, created_at, metadata
   FROM credit_transactions
   WHERE provider_session_id = '<order_id>';
   ```
4. **If still missing**, manually grant credits using the SQL in the Credits
   section below. Mark the operation in the transaction metadata so it's traceable.

### Manual credit grant for a paid order (last resort)

If webhook replay also fails (e.g. handler bug), grant credits manually
**only after confirming payment** in Lemon Squeezy dashboard:

```sql
SELECT grant_credits(
  '<user-id>'::uuid,
  300::numeric,                      -- or 1000 for large pack
  'lemonsqueezy-manual-recovery',
  '{"order_id":"<ls-order-id>","reason":"webhook_failed"}'::jsonb,
  '<ls-order-id>'                    -- still use order ID as idempotency key
);
```

This uses the same UNIQUE constraint on `provider_session_id`, so if the
webhook later succeeds it won't double-grant.

### End-to-end test (staging, with Test mode ON in Lemon Squeezy)

1. Sign in to staging with `qa-tester` or a real test account.
2. Trigger the paywall (e.g. `UPDATE profiles SET credits = 0 WHERE username = 'qa-tester';` then try a brainstorm).
3. Click **Top up** → choose **Small** → completes Lemon Squeezy test checkout (use card `4242 4242 4242 4242`, any future expiry, any CVC).
4. Verify webhook fires (Lemon Squeezy Dashboard → Settings → Webhooks → click your webhook → Recent deliveries → 200 OK).
5. Verify credits granted:
   ```sql
   SELECT username, credits FROM profiles WHERE username = 'qa-tester';
   SELECT amount, balance_after, reason, provider_session_id, created_at
   FROM credit_transactions WHERE user_id = '<qa-tester-uuid>'
   ORDER BY created_at DESC LIMIT 5;
   ```
6. **Idempotency test:** Lemon Squeezy Dashboard → Webhooks → click the delivery → "Send again" → verify balance does NOT increase a second time (idempotent on `provider_session_id`).

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
