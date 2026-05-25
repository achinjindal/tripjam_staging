# TripJam — Launch Plan

**Status:** Draft v1
**Owner:** Achin (solo)
**Created:** 2026-05-21
**Target launch window:** ~2 weeks from kickoff (≈ June 4, 2026)
**Monetization model at launch:** Freemium (free credits on signup + Stripe top-ups)

---

## 0. North Star & Operating Principles

**North star:** First paying customer within 14 days of kickoff.

**Definition of "launched":** Anonymous visitor lands on the product site, signs up, plans a real trip on free credits, runs out, pays via Stripe, and gets more credits — all without manual intervention from the founder.

**Operating principles for this sprint:**

1. **Ship the smallest thing that lets strangers find → try → pay.** Everything else is post-launch.
2. **No refactors during launch sprint.** The 5,097-line `App.jsx` ships as-is. Refactoring is the #1 way to inject bugs into a launch.
3. **One decision per dimension.** One price, one currency, one auth method, one launch channel-set. Tiers and variants come later.
4. **Manual is fine for v1.** Manual password resets, manual support, manual GDPR requests. Build UI after the second complaint.
5. **Every merge to `main` deploys to production.** Treat `main` like prod for these two weeks. Use `launch/v1` for staging-ish work.

---

## 1. Decisions Required Before Kickoff

These must be resolved on Day 0 — they have downstream copy, code, and legal implications.


| #   | Decision                       | Value                                                                                                                                | Confirmed? |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| D1  | Free credits granted on signup | **100 credits** (~2 typical trips)                                                                                                   | ✅          |
| D2  | Paid pack price + size         | **$5 → 500 credits** (one SKU)                                                                                                       | ✅          |
| D3  | Currency                       | **USD**                                                                                                                              | ☐          |
| D4  | we will                        | **displayed `≤ 15` credits**                                                                                                         | ✅          |
| D5  | Hard-stop threshold            | `**Math.floor(balance) === 0`**                                                                                                      | ✅          |
| D6  | Production domain              | **TBD** (e.g. `tripjam.app`)                                                                                                         | ☐          |
| D7  | Support email                  | **TBD** (e.g. `support@<domain>`)                                                                                                    | ☐          |
| D8  | Refund policy                  | **No refunds; non-refundable credits**                                                                                               | ☐          |
| D9  | Auth recovery at launch        | **Optional email field, manual SQL reset by founder**                                                                                | ☐          |
| D10 | Launch channels (Day 11)       | **TBD** — choose from: Product Hunt, HN Show, X/Twitter, r/travel, r/solotravel, personal network, existing waitlist                 | ☐          |
| D11 | Credit storage type            | `**NUMERIC(10,2)`** on `profiles.credits` and `credit_transactions.amount`                                                           | ✅          |
| D12 | Per-call charging formula      | `**Math.ceil(actual_cost_usd / 0.007 × 100) / 100**` (fair, rounded up to nearest 0.01 credit)                                       | ✅          |
| D13 | User-facing credit display     | `**Math.floor(balance)**` everywhere user-facing; admin/debug shows 2 decimals                                                       | ✅          |
| D14 | Overdraw protection            | **Abort RG / IG / chat if `credits < 1`**. Accept ~$0.12 worst-case bleed per overdraw event.                                        | ✅          |
| D15 | `extract-preferences` charging | **Keep LLM call, mark free, add auth check** (system-internal background call; cost ~$0.0007 absorbed)                               | ✅          |
| D16 | `city-deep-dive` charging      | **Add auth + charge per-call** (~0.76 credits each). Currently missing both.                                                         | ✅          |
| D17 | Magazine pre-fetch strategy    | **Hybrid:** pre-fetch destination only on RG-complete (~0.76 credits); lazy-load city deep dives on Magazine tab open with skeletons | ✅          |
| D18 | Credit unit rescale            | **One-time 5× rescale** combined with D11 NUMERIC migration (1 old credit → 5 new credits)                                           | ✅          |


> **Action:** Update the "Confirmed?" column inline as decisions are made. This doc is the single source of truth for these numbers.

### 1.1 Credit Unit Reference

Quick-reference card for the credit math. Pin this in your head before touching `_shared/credits.ts`.

```
1 credit = $0.01 user value = $0.007 LLM budget (70% margin reserved for Anthropic)
1 USD of LLM cost ≈ 142.86 credits
Storage: NUMERIC(10,2) — exact decimal, never float
Display: Math.floor(balance) — always integer, always rounded down
Hard-stop: Math.floor(balance) === 0
Pre-flight check: balance < 1.0 blocks Sonnet calls (RG, IG, chat)
Free signup: 100 credits  ·  Paid pack: $5 → 500 credits  ·  Low-credit warning: ≤ 15 displayed
```

Rescale context (D18): the existing code uses `CREDIT_LLM_BUDGET_USD = 0.035` ($0.05 user value per credit). The Day 2 migration multiplies every existing balance by 5 and updates the constant to `0.007`. After migration, 1 new credit = 1/5 of an old credit in real value — but the number on screen grows 5×, which is the freemium psychology win.

---

## 2. Aggressive Scope Cuts (NOT doing for launch)

These are real, valid improvements. They are explicitly **out of scope** for the 2-week sprint. Move to §10 backlog.


| Cut                                         | Why it's safe to defer                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| Decompose `App.jsx` (5,097 lines)           | Works today. Refactoring → bugs → bad launch.                            |
| Decompose `BoardView.jsx` (1,274 lines)     | Same logic.                                                              |
| Add ESLint + Prettier                       | Style consistency doesn't gate revenue. Add during post-launch refactor. |
| Unit / component tests                      | E2E covers critical paths. Don't add a new test framework now.           |
| Refresh stale `schema.sql`                  | Migrations are the truth. Cosmetic.                                      |
| iOS via Capacitor                           | Web-first launch. iOS is a 1-day project later.                          |
| Play Store listing                          | Offer APK download from landing page if asked.                           |
| Onboarding tour                             | The 3-step setup wizard *is* the onboarding.                             |
| Help center / docs site                     | FAQ accordion on landing page covers 80%.                                |
| GDPR data export/deletion UI                | Have a manual SQL process ready. Build UI after first complaint.         |
| Email-based password reset                  | Optional email field + manual reset. Acceptable for ≤200 users.          |
| Multiple pricing tiers / subscriptions      | One SKU. Add tiers in week 4 if data demands.                            |
| Refactor `TripPublicView` to use `theme.js` | Drift, not bug.                                                          |
| Move untracked HTML mockups                 | `.gitignore` them, done.                                                 |


---

## 3. Architecture Decisions for This Sprint


| Area                   | Decision                                                                                                                           | Notes                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Branch strategy        | **Long-lived `launch/v1` branch** off `main`; merge in small chunks; tag `v1.0.0-pre-launch` on `main` before kickoff for rollback | No giant PRs                                  |
| Deployment             | **Vercel auto-deploys on push** — preview branches use staging Supabase, `main` uses production                                    | Already configured                            |
| Error tracking         | **Sentry** (frontend SDK + edge function wrapper)                                                                                  | Free tier sufficient                          |
| Payments               | **Stripe Checkout (hosted)** — no custom payment form                                                                              | Single $5 SKU                                 |
| Webhook → credit grant | **New edge function** `stripe-webhook` → calls existing `grant_credits` RPC with idempotency key on `stripe_session_id`            | Grants in NUMERIC (D11)                       |
| Credit storage         | `**NUMERIC(10,2)`** on `profiles.credits` and `credit_transactions.amount`                                                         | Exact decimal math, no float errors           |
| Credit charging        | **Cost-based, fair**: `ceil(actual_cost_usd / 0.007 × 100) / 100`. No `Math.max(1, ...)` floor.                                    | Replaces current integer-ceiling model        |
| Credit display         | `**Math.floor(balance)`** wrapper everywhere user-facing; admin/debug shows 2 decimals                                             | Users never see fractions                     |
| Credit rescale         | **One-time 5× rescale** combined with the NUMERIC type change in a single Day 2 migration                                          | `credits::numeric * 5` in the `USING` clause  |
| Overdraw guard         | **Pre-flight check**: edge functions (RG / IG / chat) return 402 if `credits < 1.0` before calling Anthropic                       | Cheap, simple; accept ~$0.12 worst-case bleed |
| Rate limiting          | **Postgres counter per user per minute**, checked in `_shared/credits.ts`                                                          | Cheap; leverages existing auth path           |
| Email/transactional    | **None at launch** beyond Stripe receipts (Stripe handles them)                                                                    | Defer dedicated provider                      |
| Auth recovery          | **Optional email field on profile**; manual reset via SQL runbook                                                                  | Documented in `RUNBOOKS.md` (created Day 5)   |
| Cost guardrails        | **Anthropic hard spend cap** + **Supabase usage alerts**                                                                           | Set before Stripe goes live                   |


---

## 4. The 10-Day Plan

Each day has **one primary outcome**. If a day overruns, the next day's scope shifts — do not compound.

> **Working schedule assumption:** Mon–Fri, ~6 productive hours/day. Adjust day-by-day boundaries to match your real calendar.

### Day 0 — Pre-flight (½ day, before Day 1)

- Confirm D1–D10 decisions above
- Verify production domain DNS + Vercel + production Supabase env vars all healthy
- Verify `.env.production` is complete (Anthropic key, Supabase service role, etc.)
- Configure Anthropic hard spend cap (recommend $50/day initial)
- Configure Supabase usage alerts
- Block calendar for 10 working days — no meetings, no context switches

---

### Week 1 — Make it Safe & Salable

#### Day 1 (Mon) — Foundation

**Primary outcome:** Safety net in place; rollback point established.

- `git tag v1.0.0-pre-launch` on `main` and push tag
- `git checkout -b launch/v1` (long-lived launch branch)
- Add **Sentry** to frontend (`src/main.jsx`) tagged with `app_env`
- Add **Sentry** wrapper to edge functions via `_shared/sentry.ts`
- Remove hardcoded production anon key from `e2e/geocoding.spec.ts`
- `.gitignore` the 13 root-level `*.html` design mockups
- Remove duplicate `DebugContext` definition (keep only `src/context.js`)
- Fix `CLAUDE.md` reference to non-existent `JoinView.jsx`
- **Fix `city-deep-dive` (D16)** — currently missing both auth and credits. Add `authenticateUser` + `deductCredits` to `supabase/functions/city-deep-dive/index.ts`. Charges ~0.76 credits/call. Note: the auth fix is on Day 1; the *charging* part requires the new fractional `costToCredits` from Day 2 — so leave the deduct call wired but commented until Day 2 migration is in. Alternative: ship both on Day 2 along with everything else credits-related (safer).
- **Fix `extract-preferences` (D15)** — add `authenticateUser` only to `supabase/functions/extract-preferences/index.ts`. **Do not charge** — add a code comment marking it as a free system-internal call (cost absorbed, ~$0.0007 per trip).
- Commit freemium numbers (D1–D18) into `LAUNCH_PLAN.md`

**Done when:** Sentry receives a test error from staging frontend AND from a staging edge function. `city-deep-dive` and `extract-preferences` both reject unauthenticated requests.

#### Day 2 (Tue) — Stripe Wiring + Credit System Overhaul

**Primary outcome:** Decimal credits with integer display live in staging; test-mode Stripe purchase grants 500 credits end-to-end.

This is the heaviest day in the sprint. Do migration + code first; Stripe last (so you're not debugging Stripe on top of a broken credits model).

**Part A — Database migration (do first)**

Create `supabase/migrations/20260522_decimal_credits_rescale.sql`:

```sql
-- Combined 5× rescale + NUMERIC type change in a single transaction
ALTER TABLE profiles
  ALTER COLUMN credits TYPE NUMERIC(10,2) USING credits::numeric * 5;

ALTER TABLE credit_transactions
  ALTER COLUMN amount TYPE NUMERIC(10,2) USING amount::numeric * 5;

-- Add Stripe columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS stripe_session_id TEXT UNIQUE;

-- Update RPCs to accept NUMERIC. Re-create with NUMERIC parameter type.
-- deduct_credits(p_user_id uuid, p_amount NUMERIC, p_function_name text, p_model text, p_llm_cost_usd NUMERIC)
-- grant_credits(p_user_id uuid, p_amount NUMERIC, p_source text, p_stripe_session_id text)
```

- Push migration to staging Supabase; verify all existing test-account balances are now 5× their old value
- Verify `deduct_credits` and `grant_credits` RPCs work with NUMERIC inputs (including fractional like `5.72`)

**Part B — Code changes**

- Update `supabase/functions/_shared/credits.ts`:
  - `CREDIT_LLM_BUDGET_USD = 0.007` (was `0.035`)
  - `costToCredits(usd) → Math.ceil((usd / 0.007) × 100) / 100` (remove `Math.max(1, ...)` floor)
  - Add `requireMinCredits(user, min = 1.0)` helper that returns 402 if `user.credits < min`
- Update `src/credits.js`:
  - Add `displayCredits(balance)` = `Math.floor(balance ?? 0)`
  - Update every site that renders credits to call `displayCredits()` instead of raw balance (`CreditsOverlay`, `Admin.jsx`, anywhere balance is shown)
  - Admin/debug mode shows `balance.toFixed(2)` (full precision) — gate behind `?debug=1` or `profiles.is_admin`
- Add pre-flight check to `generate-brainstorm/index.ts`, `generate-itinerary/index.ts`, `chat/index.ts`:
  - Call `requireMinCredits(user, 1.0)` before invoking Anthropic; return 402 with code `insufficient_credits` if blocked

**Part C — Stripe wiring**

- Create Stripe account (test mode); create one product: `$5 → 500 credits`
- New edge function `create-checkout-session` — auths the user, creates Stripe Checkout Session, returns the URL
- New edge function `stripe-webhook` — verifies signature → calls `grant_credits(user_id, 500.00, 'stripe', session.id)`; idempotent on `credit_transactions.stripe_session_id UNIQUE` constraint
- Register webhook endpoint URL in Stripe dashboard (staging URL first)
- End-to-end test: complete Stripe test checkout → verify webhook fires → verify exactly `500.00` credits granted → replay webhook → verify no double-grant

**Done when:**

- Migration applied to staging without errors
- Existing test accounts show 5× their old credit balance, now stored as decimal
- Smallest Haiku call (e.g. todos at $0.0027) deducts `0.39` credits from balance, not `1`
- User-facing credit display is always whole integer, admin shows decimals
- RG / IG / chat all return 402 when `credits < 1.0` without calling Anthropic
- Stripe test purchase grants `500.00` credits exactly once; webhook replay is idempotent

#### Day 3 (Wed) — Purchase UX

**Primary outcome:** Users in the app can buy credits without a landing page.

- "Top up" button in `CreditsOverlay` → opens Stripe Checkout in new tab (`create-checkout-session`)
- Low-credits banner appears when `displayCredits(balance) <= 15` (D4)
- Hard-stop modal when `displayCredits(balance) === 0` (D5) with single "Top up" CTA
- On top-up success, leftover decimals roll forward automatically — `0.42 + 500 = 500.42`, displayed as "500". No special handling needed; document this in code comment.
- Admin/debug shows full precision (`balance.toFixed(2)`); users see integer only
- Success-return URL `/credits/success` → shows "Credits added!" + auto-refreshes balance
- Cancel-return URL `/credits/cancel` → silent return to app
- Inline hint near Magazine tab: *"~1 credit per city explored"* (R12 mitigation)

**Done when:** Logged-in user can run out of credits → click Top up → pay (test mode) → see new balance reflected within 5 seconds. Low-credit warning visible when 15 displayed credits remain. Admin sees `99.42` while user sees `99`.

#### Day 4 (Thu) — Landing Page

**Primary outcome:** A stranger can understand and sign up.

- Single-scroll landing page at `/` for logged-out users
- Sections: Hero, 3-step "How it works" with screenshots, Pricing ($5/100 credits, "10 free on signup"), FAQ accordion, footer with Privacy/ToS/support email
- Sign-up CTA above the fold + repeated in pricing section
- OG tags + favicon polish + meta description
- Mobile responsive (this is critical — most traffic will be mobile)

**Done when:** Landing page is live on a Vercel preview, your spouse/friend can describe the product in 30 seconds without prompting.

#### Day 5 (Fri) — Legal + Soft Auth Recovery + Support

**Primary outcome:** You can legally accept money and respond to users.

- Privacy Policy (use Termly free tier or hand-write minimum)
- Terms of Service (same)
- Both linked from landing page footer + checkbox on signup
- Add **optional** email field to signup form + profile editor
- Set up `support@<domain>` (Fastmail / Forwardemail / Google Workspace)
- Create `RUNBOOKS.md` in repo with:
  - Manual password reset SQL
  - Manual credit grant SQL
  - Manual user delete SQL (for GDPR requests)
  - Stripe webhook replay procedure
- Pin "We reply within 24h on weekdays" on support page / signup

**Done when:** Legal pages render, email field saves to `profiles`, runbook documented, you can recover an account using only the runbook.

---

### Week 2 — Polish, Soft Launch, Public Launch

#### Day 6 (Mon) — Performance Pass + Magazine Pre-fetch Reduction

**Primary outcome:** Fast first paint + clean shares + no opaque credit charges from Magazine pre-fetch.

- Lazy-load `src/airports-data.json` (418 KB) — only import on Setup form mount
- Run `vite build --report` (or `rollup-plugin-visualizer`) — identify other split opportunities
- Verify PWA caching strategy for Wikipedia images (already configured per CLAUDE.md)
- OG tags for `/share/:token` pages so shared trips render rich previews in iMessage/WhatsApp/Slack
- Lighthouse audit: landing page mobile score ≥ 85, logged-in shell ≥ 75
- **Magazine pre-fetch reduction (D17, R12 mitigation)** — in `src/App.jsx` around lines 2532-2569:
  - Keep the destination-only pre-fetch on RG-complete (1 call, ~0.76 credits)
  - **Remove** the "top 2 cities" auto pre-fetch — currently triggers 2 extra deep dives users haven't asked for
  - **Add** city deep-dive lazy-load only when the user opens the Magazine tab, with skeleton states for visible cards
  - Each city card shows a skeleton loader on first paint, then renders content after Haiku returns (~1s)
  - Net effect: pre-RG-complete Magazine cost drops from ~~3 deep dives (~~2.3 credits) to 1 (~0.76 credits). The other cities only cost credits if the user actually explores them.

**Done when:** Landing page LCP < 2.5s on a throttled mobile, share link in iMessage shows trip thumbnail + title. After RG completes, only 1 deep dive (destination) has fired — verify in `llm_usage` table.

#### Day 7 (Tue) — Abuse & Safety Nets

**Primary outcome:** No 4am wakeup from a runaway bill.

- Per-user rate limit on all LLM edge functions (e.g. 20 calls/min) via Postgres counter in `_shared/credits.ts`
- Verify every edge function rejects unauthenticated requests (audit each `verify_jwt` setting)
- Audit RLS on new tables: `credit_transactions`, Stripe-touched rows
- Verify Anthropic spend alert fires (manually trigger near threshold in test)
- Verify Supabase usage alerts configured
- Add a "circuit breaker" env var (e.g. `LLM_KILL_SWITCH=true`) that all LLM edge functions check first

**Done when:** Hitting an LLM endpoint 30× in 60s with valid auth gets blocked. Flipping the kill switch disables all LLM calls within 1 minute of redeploy.

#### Day 8 (Wed) — QA Gauntlet

**Primary outcome:** Confidence to ship.

- Run full Playwright suite against staging (`npx playwright test`)
- Manual smoke (incognito, real account, real money in Stripe test):
  - Signup → setup wizard (3 steps) → RG (4 routes) → select route → pre-IG sheet → IG (compact + detailed) → board (all 5 widgets) → magazine (deep dive a city) → run out of credits → Stripe checkout → return → balance updated → share trip → open share link in private window
- Test on real Android device using built Capacitor APK
- Triage findings into "fix now" / "fix post-launch" (GitHub issues)
- Fix all Tier-1 issues before EOD

**Done when:** All E2E pass, manual smoke completes without errors, Tier-1 bugs zero.

#### Day 9 (Thu) — Soft Launch

**Primary outcome:** Real humans use it; founder watches metrics.

- Switch Stripe to **live mode**; update webhook URL to production
- Merge `launch/v1` → `main` → production deploy
- Run E2E one more time against production
- Invite 10–20 friends/family via personal note (NOT a mass email)
- Monitor Sentry + PostHog continuously
- Hotfix anything critical immediately (single-commit fixes only)

**Done when:** ≥ 5 real users have planned a real trip end-to-end. ≥ 1 has paid (even if it's a friend you Venmo back).

#### Day 10 (Fri) — Pre-Launch Hardening

**Primary outcome:** Ready for cold traffic on Monday.

- Fix all critical bugs from soft launch
- Verify Anthropic + Stripe + Supabase budgets are appropriate for 10× current usage
- Draft launch posts:
  - Product Hunt: title, tagline, gallery, first comment
  - X/Twitter: launch thread (5–7 tweets)
  - HN Show: title + first comment
  - Reddit: subreddit-specific posts (NOT cross-posted verbatim)
  - Personal network: short email / DMs
- Prep screenshots + 30-second demo video/GIF
- Schedule posts for Monday/Tuesday morning US Eastern time

**Done when:** All posts drafted in a single doc, screenshots ready, you sleep well tonight.

#### Day 11+ (next Mon) — Public Launch

- Ship the posts in the morning
- Stay on Sentry + PostHog all day
- Reply to every comment within an hour
- Triage bugs as they come in; hotfix only if blocking signup or payment

---

## 5. Definition of "Launched"

All must be true:

- Anonymous visitor lands on production domain, understands the product, signs up.
- New user gets free credits and plans one full trip without paying.
- User who hits 0 credits sees a clear path to top up.
- Stripe Checkout works in live mode; webhook grants credits idempotently.
- All errors flow to Sentry; Sentry alerts on error rate spikes.
- Anthropic + Supabase have budget alerts + hard caps configured.
- Privacy Policy + ToS linked from footer + accepted at signup.
- At least one human who isn't you has paid real money for credits.

---

## 6. Risk Register


| #   | Risk                                                 | Likelihood   | Impact | Mitigation                                                                                                                                                                       |
| --- | ---------------------------------------------------- | ------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Anthropic bill spikes from abuse                     | Medium       | High   | Per-user rate limit (Day 7) + Anthropic hard spend cap + kill switch                                                                                                             |
| R2  | Refactor temptation derails launch                   | High         | High   | Explicitly banned in §2. Re-read this doc daily.                                                                                                                                 |
| R3  | Auth recovery requests overwhelm                     | Medium       | Medium | Manual SQL runbook (Day 5); pin "24h reply" expectation                                                                                                                          |
| R4  | Stripe webhook reliability / double-charge           | Low          | High   | Idempotency key on `credit_transactions`; Stripe auto-retries                                                                                                                    |
| R5  | Production schema drift during launch week           | Low          | High   | No `prod` migrations during launch week unless P0. Use staging for any migration.                                                                                                |
| R6  | LLM model deprecation mid-launch                     | Low          | Medium | Pin model versions explicitly in edge functions; have fallback model documented                                                                                                  |
| R7  | Vercel preview ≠ prod surprise                       | Medium       | Medium | Smoke test on `main` after every merge during launch week                                                                                                                        |
| R8  | Photos/geocoding API rate-limit during traffic spike | Medium       | Medium | `place_cache` already exists; verify it's actually being hit                                                                                                                     |
| R9  | Wikipedia/Wikimedia outage breaks photos             | Low          | Low    | Photos are non-blocking; show placeholder                                                                                                                                        |
| R10 | Founder burnout in week 2                            | High         | High   | Hard stop at 8pm. No work on Sunday before public launch.                                                                                                                        |
| R11 | Long-trip user hits credit wall mid-IG               | Medium       | High   | Pre-flight `credits < 1.0` check (Day 2 / D14). Daily admin query for `WHERE credits < 0` post-launch. If overdraw is common, switch to per-endpoint estimates (RG: 10, IG: 30). |
| R12 | Magazine pre-fetch causes opaque credit drops        | High pre-fix | Medium | D17 hybrid: pre-fetch destination only (Day 6). One-line UI hint near Magazine tab: "~1 credit per city explored" (Day 3).                                                       |


---

## 7. Cost Model (Per-Call and Per-Trip)

All numbers below assume the new scale: `1 credit = $0.01 user value = $0.007 LLM budget`. Per-call charge = `ceil(actual_cost_usd / 0.007 × 100) / 100`.

### Per-call credit charges (cost-based, fair)


| Use case                                     | Model  | Real cost USD | Decimal credits | Visible drop |
| -------------------------------------------- | ------ | ------------- | --------------- | ------------ |
| `extract-preferences` (D15, system-internal) | Haiku  | $0.0007       | **0 (free)**    | none         |
| `generate-todos`                             | Haiku  | $0.0027       | 0.39            | usually 0-1  |
| `estimate-expenses`                          | Haiku  | $0.0036       | 0.51            | usually 0-1  |
| `city-deep-dive` (Magazine)                  | Haiku  | $0.0053       | 0.76            | usually 0-1  |
| `generate-wishlist`                          | Haiku  | $0.0064       | 0.91            | usually 0-1  |
| `generate-brainstorm` (RG)                   | Sonnet | ~$0.04        | 5.72            | 5-6          |
| `generate-itinerary` compact (7d)            | Sonnet | ~$0.08        | 11.43           | 11-12        |
| `generate-itinerary` detailed (7d)           | Sonnet | ~$0.10        | 14.29           | 14-15        |
| `chat` exchange                              | Sonnet | $0.005-0.02   | 0.72-2.86       | 1-3          |


### Per-trip consumption ranges


| Trip profile                                  | Credits typically consumed | % of 100 free | Conversion trigger?                              |
| --------------------------------------------- | -------------------------- | ------------- | ------------------------------------------------ |
| Weekend (3 days, 1 city, light chat)          | ~26                        | 26%           | No — free tier comfortably covers                |
| Week (7 days, 2-3 cities, normal chat)        | ~45                        | 45%           | No — free tier covers with margin                |
| Two-week (14 days, 4-5 cities, heavy use)     | ~66                        | 66%           | No — first trip free, second trip prompts top-up |
| Three-week heavy (21+ days, deep exploration) | ~99                        | 99%           | **Yes** — hits the wall, ideal time to convert   |


### Margin per paid pack

- $5 → 500 credits = `$3.50 LLM budget` allocated
- Realistic LLM spend on a 500-credit pack: ~$2.00-2.75 (rounding works in your favor on Haiku-heavy use)
- Stripe fees: ~$0.45 ($0.30 + 2.9%)
- **Net margin per pack: $1.80-2.25 (36-45%)** before infrastructure costs

### Worst case for free tier

- 100 free credits worst case if user maxes all on Sonnet: **~$0.70** absorbed
- 100 free credits realistic mix: **$0.30-0.50** absorbed
- Per overdraw event (D14 buffer): **~$0.12** absorbed

> **Action:** Re-verify these per-call cost numbers against actual `llm_usage` table data on Day 1 — typical input/output token counts may differ from estimates above.

---

## 8. Day-1 Readiness Checklist

Complete before starting Day 1:

- D1–D10 decisions confirmed (see §1)
- Production domain DNS pointed at Vercel
- Production Vercel project has all required env vars
- `.env.production` complete and committed (encrypted values via Vercel UI)
- Anthropic API has hard spend cap set
- Calendar blocked for 10 working days
- `git tag v1.0.0-pre-launch` ready to push

---

## 9. Communication Plan

- **Status:** Self-checkin at end of each day. Mark day's checkboxes in this doc.
- **Blockers:** If a Tier-1 risk fires, stop and reassess scope — don't push through.
- **Pivots:** Any change to D1–D10 mid-sprint requires updating this doc + a 1-line "why" in commit message.

---

## 10. Post-Launch Backlog (Week 3+)

In rough priority order. Do not start any of these until **public launch + 1 week of stability**.

1. **Decompose `App.jsx`** — start with `BrainstormView` (~874 lines) extraction
2. **Decompose `BoardView.jsx`** — one widget per file
3. **Server-side deep-dive cache** — keyed on `(city, month, styles)`. Same city + same travel context = serve from cache, no LLM call. Extend existing `place_cache` or add new `deep_dive_cache`. Likely 50%+ hit rate after a few months = major Magazine COGS reduction. High priority after launch stability.
4. **Monitor negative credit balances** — daily admin query for `WHERE credits < 0` (R11 follow-up). If overdraw is common, switch from `credits < 1` pre-flight to per-endpoint estimates (RG: 10, IG: 30, chat: 5).
5. **ESLint + Prettier** — add alongside decomposition PRs
6. **Email auth recovery** (proper magic-link or reset flow)
7. **Onboarding tweaks** driven by PostHog funnel data
8. **Pricing tiers** if data shows demand for larger packs
9. **iOS via Capacitor**
10. **Play Store listing**
11. **Verify multi-language `extract-preferences`** — current LLM design should handle Spanish/French/etc. notes. Add E2E test once a non-English user appears.
12. **Unit tests** for non-UI logic (`photos.js`, `airports.js`, credit math, transit calc)
13. **GDPR data export/deletion UI**
14. **Refresh `schema.sql`** from production
15. **Public help center / docs site**
16. **Refactor `TripPublicView`** to use `theme.js`
17. **Remove duplicate `DebugContext` definition** (if not done Day 1)
18. **Email transactional provider** (welcome, low-credits, weekly digest)

> Note: an earlier draft proposed a "millicredits migration" — this is no longer needed. The Day 2 `NUMERIC(10,2)` design is the final form.

---

## 11. Change Log


| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Author         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 2026-05-21 | Initial draft created                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Claude + Achin |
| 2026-05-21 | Credit model finalized: 5× rescale (100 free, $5→500 pack), `NUMERIC(10,2)` decimal storage with `Math.floor()` integer display, cost-based fair charging (`ceil(cost/0.007 × 100)/100`, no per-call floor), pre-flight `credits < 1` guard for Sonnet calls. Edge function fixes: `city-deep-dive` adds auth + per-call charge, `extract-preferences` adds auth only (free, system-internal). Magazine pre-fetch reduced to destination-only on RG-complete, cities lazy-load on tab open. New decisions D11-D18, new risks R11-R12. | Claude + Achin |


