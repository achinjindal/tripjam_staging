# Credits & Payments

TripJam meters all AI features with a credit balance stored on `profiles.credits` (NUMERIC(10,2)). New users start with 100 credits (DB column default); every gated edge function deducts credits based on actual LLM cost via an atomic Postgres RPC, and returns HTTP 402 when the balance is exhausted, which opens a paywall bottom sheet. Top-ups come from three sources: Lemon Squeezy checkout (web — wired but currently not surfaced in the UI), RevenueCat/Google Play Billing (Android), and coupon codes. All grants are idempotent via a UNIQUE `provider_session_id` on `credit_transactions`.

## 1. Earning / granting

**Signup grant.** New users get 100 credits from the column default — there is no grant transaction row at signup:

- `supabase/migrations/20260513000001_create_credits_system.sql:2` — column created with default 50
- `supabase/migrations/20260526000003_decimal_credits_rescale.sql:15,18` — default raised to 300, type changed INTEGER → NUMERIC(10,2)
- `supabase/migrations/20260603000001_default_credits_100.sql:5` — default lowered 300 → 100 (current; existing balances untouched)

**All other grants** go through the `grant_credits` RPC, wrapped by `grantCredits()` in `supabase/functions/_shared/credits.ts:358-381`. The RPC (`supabase/migrations/20260526000004_provider_neutral_payments.sql:31-77`) adds to `profiles.credits`, inserts a positive-amount row into `credit_transactions`, and — the key property — **skips the grant and returns the current balance if a row with the same `provider_session_id` already exists** (lines 51-58). The UNIQUE constraint on that column (`20260526000003_decimal_credits_rescale.sql:40,50`, renamed from `stripe_session_id` in `20260526000004`) is the backstop against races between duplicate webhook deliveries.

## 2. Spending — the deduction path

### Guard rails on every gated function

Each gated edge function (generate-brainstorm, generate-itinerary, chat, generate-todos, estimate-expenses, generate-wishlist, city-deep-dive, generate-destination-research, places-proxy) runs this sequence — e.g. `supabase/functions/generate-brainstorm/index.ts:84-94`:

1. `llmKillSwitch()` — env-var global kill switch, 503 (`_shared/credits.ts:209-226`)
2. `authenticateUser(req)` — validates the bearer token (rejecting the anon key), then reads `profiles.credits` (`_shared/credits.ts:94-117`)
3. Pre-flight balance check: `if (user.credits < 1.0) return outOfCredits(...)` → HTTP 402 with `{ error, code: "insufficient_credits", credits }` (`_shared/credits.ts:128-143`). Some functions use the equivalent `requireMinCredits()` helper (`_shared/credits.ts:147-155`; used by `city-deep-dive` and `generate-destination-research`)
4. `rateLimit(userId, ...)` — 20 calls/min/user via the `incr_rate_limit` SECURITY DEFINER RPC; fail-open on DB errors → 429 (`_shared/credits.ts:161-204`)

### Pricing formula

After the LLM call completes, `deductCredits()` (`_shared/credits.ts:230-275`) computes the real USD cost and converts to credits:

```
usd = (input_tokens * rate.input
     + cache_creation_tokens * rate.input * 1.25     // CACHE_WRITE_MULTIPLIER, credits.ts:49
     + cache_read_tokens     * rate.input * 0.10     // CACHE_READ_MULTIPLIER, credits.ts:50
     + output_tokens * rate.output) / 1_000_000       // computeLLMCost, credits.ts:52-65

credits = ceil((usd / 0.007) * 100) / 100             // costToCredits, credits.ts:69-72
```

- Rates: Sonnet 4.6 $3/$15 per M tokens, Haiku 4.5 $0.80/$4 (`_shared/credits.ts:34-38`).
- `0.007` is `CREDIT_LLM_BUDGET_USD` (`credits.ts:41`): 1 credit = $0.01 of user value, of which 70% is LLM budget and 30% margin.
- Rounds **up** to the nearest 0.01 credit; there is deliberately no `Math.max(1, ...)` floor, so a tiny Haiku call can cost < 1 credit (`credits.ts:67-68`).
- A parallel pass-through scale exists for external APIs: `costToCreditsPassthrough()` divides by $0.01 with no margin (`credits.ts:75-78`), used by `deductExternalApiCredits()` (`credits.ts:328-352`) — **currently defined but not called by any function** (verified by grep; `places-proxy` charges its internal Haiku calls through the regular `deductCredits`, `supabase/functions/places-proxy/index.ts:988`).

### Atomicity and negative balances

`deductCredits` calls the `deduct_credits` Postgres RPC (SECURITY DEFINER), which in one transaction does `UPDATE profiles SET credits = credits - p_amount RETURNING credits` and inserts a negative-amount `credit_transactions` row (`supabase/migrations/20260526000003_decimal_credits_rescale.sql:69-109`). There is **no floor at zero**: the balance can go slightly negative when an in-flight generation costs more than the remaining balance — the ≥ 1.0 pre-flight check is the only gate, and the comment at `20260526000003:99-100` documents this as intentional (prefer minor over-spend over failing mid-generation).

Deduction is fire-and-forget from the function's perspective (errors are logged, never break the user response — `_shared/credits.ts:228-229,272-274`). For streaming functions the deduction runs after the stream closes, registered via `runInBackground()`/`EdgeRuntime.waitUntil` so the Supabase isolate isn't torn down before it completes (`_shared/credits.ts:12-32`). Real streaming token counts (including cache buckets) are captured with `newStreamUsage`/`accumulateStreamUsage` from `message_start`/`message_delta` SSE events (`_shared/credits.ts:284-316`).

### Usage logging

Independently of deduction, every function POSTs a row to `llm_usage` (fire-and-forget) with `trip_id`, `function_name`, `model`, token counts — e.g. `generate-brainstorm/index.ts:260-271`. Schema: `supabase/migrations/20260511000002_create_llm_usage_and_admin.sql` (admin-read RLS), cache-token columns added in `20260622000001_llm_usage_cache_tokens.sql`.

**Exception — extract-preferences is intentionally unbilled.** It logs to `llm_usage` (`supabase/functions/extract-preferences/index.ts:75`) but never calls `deductCredits` (verified: no import or call in the file). It's a tiny Haiku call (max 100 output tokens) that runs automatically before IG.

## 3. Running out — the paywall

### Frontend store (`src/credits.js`)

Module-level store, not React context: a private `_balance` + `_paywallReason` and a listener set (`src/credits.js:24-30`), exposed to components via `useSyncExternalStore`-backed hooks `useCredits()` (`credits.js:55-63`) and `usePaywall()` (`credits.js:81-89`).

- `CREDITS_UI_ENABLED = true` (`credits.js:12`) — master switch for the credits **UX only**; when false, `refreshCredits`, `openPaywall`, and `handleGatedResponse` become no-ops, but backend deduction always runs regardless (comment at `credits.js:4-5`).
- `refreshCredits(userId)` (`credits.js:41-53`) — re-reads `profiles.credits` from Supabase and notifies listeners. Called after every gated call (e.g. `src/App.jsx:2201, 8510, 9138`), after purchases, and after coupon redemption.
- `openPaywall(reason)` / `closePaywall()` (`credits.js:70-79`) — set/clear the paywall reason string that `PaywallSheet` renders.
- `displayCredits(balance)` (`credits.js:17-20`) — floors the NUMERIC(10,2) balance so users see whole integers.
- `handleGatedResponse(res, userId, reason)` (`credits.js:93-107`) — contract: given a fetch `Response` from a gated function, on 402 it sets the balance to 0, opens the paywall, drains the body, and returns `true` (caller must abort); otherwise returns `false` and the caller is expected to call `refreshCredits` after finishing. **Note:** `App.jsx` currently does not use this helper — it inlines the equivalent `if (res.status === 402) { openPaywall(...); return; }` checks directly (e.g. `src/App.jsx:1988-1993, 7011, 7940, 9132`), so `handleGatedResponse` is exported but unused as of this writing.

### Paywall UI

`CreditsOverlay` (default export, `src/CreditsOverlay.jsx:423-472`) is mounted at the top level for authed pages in `src/main.jsx:272-321`, guarded by `CREDITS_UI_ENABLED`. It renders:

- **`PaywallSheet`** (`CreditsOverlay.jsx:202-421`) — bottom sheet shown whenever `usePaywall()` returns a reason. Shows current balance, then platform-routed purchase options: on Android (`isAndroidApp()`, `CreditsOverlay.jsx:229`) two Google Play pack buttons — 300 credits / $4.99, 1000 / $9.99 (`PACKS`, `CreditsOverlay.jsx:197-200`) — that call `purchaseCredits()` then `refreshCredits()`; on **web the only options are "Redeem a coupon" and "Maybe later"** (the Lemon Squeezy buttons were removed when the payment flow was replaced with coupon redemption — commit `529cc77`).
- A `credits_success` URL-param toast handler kept for backwards compat with old Lemon Squeezy redirect URLs (`CreditsOverlay.jsx:426-444`).

`LowCreditsBanner` (`src/LowCreditsBanner.jsx`) is the soft nudge before the hard wall: fixed top banner shown when `displayCredits(balance) ≤ 10` and `> 0` (at 0 the PaywallSheet takes over — `LowCreditsBanner.jsx:40-42`), dismissible per browser session via `sessionStorage` key `tripjam.lowCreditsBannerDismissedAt` (`LowCreditsBanner.jsx:15-16,45-51`). Its "Top up" button opens the `CouponModal`, not a checkout.

## 4. Buying

### Web — Lemon Squeezy (wired, not currently surfaced)

The full LS pipeline exists but nothing in `src/` calls `create-checkout` today (verified by grep) — the web paywall offers coupons only. The backend flow, still deployed:

- **`supabase/functions/create-checkout/index.ts`** — `POST ?pack=small|large` with a bearer token. Authenticates the user, resolves the LS variant from env (`LEMONSQUEEZY_API_KEY/STORE_ID/VARIANT_SMALL/VARIANT_LARGE`, lines 58-62), pre-fills the user's email via the Supabase admin API (lines 85-101), and creates a hosted checkout whose `checkout_data.custom` carries `{ user_id, credits, pack }` as strings (lines 111-115 — LS requires string custom values). Redirect URL after purchase: `{APP_PUBLIC_URL}/?credits_success=<credits>` (line 123). Returns `{ url, id }`.
- **`supabase/functions/payment-webhook/index.ts`** — deployed with `--no-verify-jwt` (LS can't send a Supabase JWT; see header comment lines 11-13). Verifies the `X-Signature` header with a constant-time HMAC-SHA256 compare against `LEMONSQUEEZY_WEBHOOK_SECRET` (lines 28-54); invalid signature → 400. On `order_created` it reads `meta.custom_data` and calls `grantCredits` with `providerSessionId = String(orderId)` (lines 134-150) — idempotent on webhook replays. Missing custom data returns 200 (to stop LS retries) but alerts Sentry (lines 115-131). Other events, including `order_refunded`, are acked and ignored (a clawback TODO sits at line 166).

### Android — RevenueCat / Google Play Billing

`src/billing.js` is the platform switch:

- `isAndroidApp()` (`billing.js:27-29`) — native Capacitor + platform `android`.
- `initRevenueCat(userId)` (`billing.js:32-46`) — called once after sign-in; configures the RC SDK with `VITE_REVENUECAT_ANDROID_KEY` and the Supabase user id as `appUserID` (so RC events map back to `profiles.id`).
- `purchaseCredits(packId)` (`billing.js:52-109`) — maps pack → Play SKU (`tripjam_credits_300` / `tripjam_credits_1000`, `billing.js:16-19`), fetches the product, runs `Purchases.purchaseStoreProduct`, and returns `{ transactionId, credits }`, `{ cancelled: true }`, or `{ error }`. On success it **immediately** POSTs `{ transactionId, productId }` to `revenuecat-verify` with the user's session token (`billing.js:76-96`) so credits appear without waiting for the async webhook; a failure here is swallowed because the webhook is the fallback.

Two server-side grant paths, deduplicated by the shared idempotency key `"rc_<transactionId>"`:

- **`supabase/functions/revenuecat-verify/index.ts`** (instant path) — authenticates the user, then verifies the claimed transaction actually belongs to them by calling the RC REST API `GET /v1/subscribers/<userId>` with `REVENUECAT_SECRET_KEY` and checking `subscriber.non_subscriptions[productId]` contains the transaction id (lines 77-119). Unverified → 403; verified → `grantCredits` with `providerSessionId: "rc_<transactionId>"` (lines 122-128). Note the fix at lines 73-76: the request deliberately does **not** send an `X-Platform` header — that header marks the call as an app/SDK request, for which RevenueCat rejects secret keys (error 7243), which previously broke verification (commit `a261762`).
- **`supabase/functions/revenuecat-webhook/index.ts`** (idempotent fallback) — deployed with `--no-verify-jwt`; auth is a plain string compare of the `Authorization` header against `REVENUECAT_WEBHOOK_SECRET` (lines 34-41). Processes only `NON_SUBSCRIPTION_PURCHASE` events (line 59), maps `product_id` → credits (lines 15-18, must match `billing.js` `PACK_CREDITS`), and grants with the same `"rc_<event.id>"` session id (lines 94-105), so whichever of the two paths lands second is a no-op.

### 5. Coupons

`supabase/functions/redeem-coupon/index.ts` — `POST { code }` with a bearer token. Codes and their credit amounts live in the `VALID_COUPONS` map in the function source (`redeem-coupon/index.ts:19-21` — not reproduced here). Flow: authenticate → rate-limit bucket `"coupon"` at 5/min (line 31) → normalize to uppercase → grant via `grantCredits` with `providerSessionId: "coupon_<CODE>_<userId>"` (lines 57-63). Because the session id embeds the user id, the UNIQUE constraint enforces **single use per user per code** (different users can redeem the same code). A repeat redemption makes the RPC insert throw, `grantCredits` returns `null`, and the function replies 409 "Coupon already redeemed" (lines 65-74).

Frontend entry points: `CouponModal` in `src/CreditsOverlay.jsx:34-195` (uppercases input, calls the function, shows "✓ N credits added!", refreshes credits), reachable from the PaywallSheet's "Redeem a coupon" button (`CreditsOverlay.jsx:369-391`) and the LowCreditsBanner's "Top up" button (`LowCreditsBanner.jsx:134-138`).

## Ledger tables

**`credit_transactions`** (final shape after `20260513000001`, `20260526000003`, `20260526000004`):

| column                | type              | notes                                                       |
| --------------------- | ----------------- | ----------------------------------------------------------- |
| `id`                  | uuid PK           |                                                             |
| `user_id`             | uuid → auth.users | cascade delete                                              |
| `amount`              | NUMERIC(10,2)     | negative = spend, positive = grant                          |
| `balance_after`       | NUMERIC(10,2)     | snapshot from the RPC                                       |
| `reason`              | text              | function name, `"lemonsqueezy"`, `"revenuecat"`, `"coupon"` |
| `function_name`       | text              | spends only                                                 |
| `trip_id`             | uuid              | nullable                                                    |
| `llm_cost_usd`        | NUMERIC(10,6)     | actual USD cost behind the charge                           |
| `metadata`            | jsonb             | model, token counts, pack, order attributes, etc.           |
| `provider_session_id` | text UNIQUE       | idempotency key (renamed from `stripe_session_id`)          |
| `created_at`          | timestamptz       |                                                             |

RLS: users read their own rows; admins read all; only the service role writes (via the SECURITY DEFINER RPCs).

**`llm_usage`** (`20260511000002`, cache columns in `20260622000001`): `trip_id`, `function_name`, `model`, `input_tokens`, `output_tokens`, `cache_creation_tokens`, `cache_read_tokens`, `created_at`. Admin-read only; feeds the `/admin` cost dashboard. Not tied to a user — it's an analytics log, separate from the billing ledger.

## Key files

- `src/credits.js` — frontend credit store, paywall state, `handleGatedResponse`
- `src/CreditsOverlay.jsx` — PaywallSheet, CouponModal, success toast
- `src/LowCreditsBanner.jsx` — ≤10-credit nudge banner
- `src/billing.js` — platform routing, RevenueCat init/purchase
- `src/main.jsx:272-321` — where the overlay/banner are mounted
- `supabase/functions/_shared/credits.ts` — auth, pricing, deduction, grants, rate limit, kill switch, stream usage
- `supabase/functions/create-checkout/index.ts` / `payment-webhook/index.ts` — Lemon Squeezy
- `supabase/functions/revenuecat-verify/index.ts` / `revenuecat-webhook/index.ts` — Android IAP
- `supabase/functions/redeem-coupon/index.ts` — coupon grants
- `supabase/migrations/20260513000001_create_credits_system.sql`, `20260526000003_decimal_credits_rescale.sql`, `20260526000004_provider_neutral_payments.sql`, `20260603000001_default_credits_100.sql` — schema + RPC history
