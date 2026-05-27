# TripJam — Launch Plan

**Status:** Draft v4 (sprint kickoff — incorporates USER_STORIES decisions)
**Owner:** Achin (solo)
**Created:** 2026-05-21 · **Last updated:** 2026-05-26 (sprint kickoff)
**Target launch window:** ~2 weeks from today (Day 1 begins 2026-05-26 with Feature 8 navigation fix)
**Monetization model at launch:** Freemium (100 free credits on signup + Stripe top-ups: **$5 → 300 credits** OR **$10 → 1000 credits** — volume discount)

> **Note on history:** v2 contained an Android-first / Play Store / RevenueCat pivot; rolled back. v3 partially consolidated. v4 (this draft) incorporates the 8-feature USER_STORIES decisions: F6 + F7 + F8 stay in launch sprint; F1-F5 move to post-launch backlog. D6-D10 re-confirmed with prior session values. D4 lowered 15→10. Google OAuth (D9) re-introduced as Day 1 Part C.

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

## 0.5 Current State Snapshot (2026-05-26)

What's already done in production and staging, *before* the formal Day 0 of the sprint begins. Sprint days below should treat these as completed pre-work.

### Production (`viyvdqwwnbbqjuwiuzbh`, https://tripjam.vercel.app)

| Item | State | Commit / Action |
|------|-------|-----------------|
| **Credits UI globally disabled** | `CREDITS_UI_ENABLED = false` in `src/credits.js`; Vite tree-shook all credit UI out of the production bundle (0 references to `CreditPill`, `PaywallSheet`, `openPaywall`, `refreshCredits` in the live JS) | `e8f6679` (deployed) |
| **All profiles inflated to 999999 credits** | 30 production profiles, all at 999999; default for new signups set to 999999 — backend gate (`if credits <= 0`) never triggers | SQL applied to prod directly |
| **3 missing profiles backfilled** | 3 prod users had `auth.users` rows but no `profiles` row (cause of 406s on profile reads + 402s on RG/IG); rows inserted with `face_icon = 1` default | SQL applied to prod directly |
| **`face_icon` signup bug fixed** | `Auth.jsx` was inserting emoji string into integer column, silently failing every signup; fixed to store integer index `faceIcon + 1` and surface upsert errors instead of silent failure | `f91528d` (deployed) |
| **Edge functions** | Untouched — `_shared/credits.ts` still has the `if (credits <= 0) → 402` gate. Inactive in practice (everyone's at 999999) but still firing `deductCredits` on every call, so `llm_usage` table continues to receive real cost data. | None |
| **`llm_usage` tracking** | Still works. Admin console will continue to show real LLM spend during the credits-disabled period — important for cost visibility. | None |

### Staging (`wlrzvwjdrjpfqcwgmzch`, `npm run dev` target)

| Item | State |
|------|-------|
| **`credits` column added** | Staging never had the column (version-number collision with the inspirations branch's `20260513000001` migration — see §10 backlog). We added it directly: `ALTER TABLE profiles ADD COLUMN credits integer NOT NULL DEFAULT 999999`. 7 profiles all at 999999. |
| **Missing profiles backfilled** | 2 staging users were missing profile rows; backfilled with default `face_icon = 1`. |
| **`face_icon` signup fix** | NOT yet deployed to staging Vercel preview (Auth.jsx fix only pushed to `main` → prod). Next preview deploy from any non-main branch will pick it up. |
| **`credit_transactions` table + `deduct_credits` RPC** | Don't exist on staging (the proper credits migration was never applied due to version collision). Edge functions try to call the RPC → fire-and-forget catches the error → no user impact. |

### Code (local + `origin/main`)

| Item | State |
|------|-------|
| `src/credits.js` | `CREDITS_UI_ENABLED = false` flag + gates on `openPaywall`, `refreshCredits`, `handleGatedResponse`, `useEnsureCreditsLoaded`. App.jsx untouched — its `openPaywall` calls become no-ops automatically. |
| `src/main.jsx` | 3 `<CreditsOverlay>` mounts gated behind the flag; session-load `refreshCredits` skipped when disabled. |
| `src/Auth.jsx` | Fixed `face_icon` integer storage + added upsert error check. |
| Untracked / pre-existing | 13 root-level `*-design*.html` design mockups (should be `.gitignore`d — see Day 1); `.claude/settings.local.json` modified (local-only IDE setting); `ad-hoc/` + `inspiration/` git worktrees. |

### What the sprint plan below needs to assume

- **All D1-D26 decisions locked** as of 2026-05-26 sprint kickoff (see §1 table)
- **Sprint Day 1 = today (2026-05-26).** Phase 1 (this consolidation pass) just happened; Phase 2 (Feature 8 code) is in flight; Phase 3 (Days 2-11 standard sprint) follows on Wed onward.
- **F1-F5 deferred to post-launch backlog** (§10). Launch sprint scope = F6 (Day 6) + F7 (Day 2-3) + F8 (Day 1, in flight today).
- **Re-enabling credits during Day 2:** flip `CREDITS_UI_ENABLED = true` in `src/credits.js` AND reset `profiles.credits` from 999999 to launch value of 100. The Day 2 NUMERIC migration's `credits::numeric * 5` would turn 999999 into 4,999,995 if applied as-is — undesirable. Migration explicitly resets to 100 before type change (see Day 2 Part A SQL below).

---

## 1. Decisions Required Before Kickoff

These must be resolved on Day 0 — they have downstream copy, code, and legal implications.

| #   | Decision                       | Value                                                                                                                                | Confirmed? |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| D1  | Free credits granted on signup | **100 credits** (~2 typical trips)                                                                                                   | ✅          |
| D2  | Paid pack price + size         | **Two SKUs (updated 2026-05-26):** Small `$5 → 300 credits` ($0.0167/credit) · Large `$10 → 1000 credits` ($0.01/credit, **3.3× better deal per credit**). Volume discount nudges users toward the larger pack. Small pack also has higher per-call founder margin (~58% vs ~30% on LLM calls); large pack matches the original $0.01/credit math. | ✅          |
| D3  | Currency                       | **USD with Stripe Adaptive Pricing** (auto-localizes at checkout, settles USD)                                                       | ✅          |
| D4  | Low-credit warning threshold   | **displayed `≤ 10` credits** (changed from 15 per 2026-05-26)                                                                        | ✅          |
| D5  | Hard-stop threshold            | `**Math.floor(balance) === 0`**                                                                                                      | ✅          |
| D6  | Production domain              | **`tripjam.app`** (user-owned, confirmed exists)                                                                                     | ✅          |
| D7  | Support email                  | **`achinj.work@gmail.com`** at launch; post-launch upgrade to `support@tripjam.app` via Cloudflare Email Routing                     | ✅          |
| D8  | Refund policy                  | **No refunds; non-refundable credits.** Rider: "If credits charged in error, email support within 30 days for case-by-case review."   | ✅          |
| D9  | Auth at launch                 | **Google OAuth + email/password, email mandatory at signup, Supabase Identity Linking** auto-merges same-email accounts. Implementation = Day 1 Part C. | ✅          |
| D10 | Launch channels (sequenced)    | Pre-launch (Day 9-10): personal DMs + Indie Hackers "building in public". Launch Mon: personal network + r/solotravel + X + IH. Launch Wed: r/travel + optional HN. Week 4: Product Hunt. Month 2+: TikTok/Reels. Dropped: existing waitlist (none). | ✅          |
| D11 | Credit storage type            | `**NUMERIC(10,2)`** on `profiles.credits` and `credit_transactions.amount`                                                           | ✅          |
| D12 | Per-call charging formula      | `**Math.ceil(actual_cost_usd / 0.007 × 100) / 100**` (fair, rounded up to nearest 0.01 credit)                                       | ✅          |
| D13 | User-facing credit display     | `**Math.floor(balance)**` everywhere user-facing; admin/debug shows 2 decimals                                                       | ✅          |
| D14 | Overdraw protection            | **Abort RG / IG / chat if `credits < 1`**. Accept ~$0.12 worst-case bleed per overdraw event.                                        | ✅          |
| D15 | `extract-preferences` charging | **Keep LLM call, mark free, add auth check** (system-internal background call; cost ~$0.0007 absorbed)                               | ✅          |
| D16 | `city-deep-dive` charging      | **Add auth + charge per-call** (~0.76 credits each). Currently missing both.                                                         | ✅          |
| D17 | Magazine pre-fetch strategy    | **Hybrid:** pre-fetch destination only on RG-complete (~0.76 credits); lazy-load city deep dives on Magazine tab open with skeletons | ✅          |
| D18 | Credit unit rescale            | **One-time 5× rescale** combined with D11 NUMERIC migration (1 old credit → 5 new credits)                                           | ✅          |
| D19 | Credits UI on screen           | **No persistent indicator**. Top-right pill removed entirely. Replaced by avatar dropdown menu (D20).                                | ✅          |
| D20 | Credits entry point            | **Top-right avatar icon → dropdown**: Profile · Credits (balance + Top up button) · Sign out. Accessible from every page.            | ✅          |
| D21 | Desktop layout breakpoint      | **≥1024px** triggers desktop layout. Below = mobile-stretched.                                                                       | ✅          |
| D22 | Desktop layout shape           | Left sidebar (~240px, trips list/nav) + center column (~50%, itinerary or active tab content) + right column (~50%, persistent map top + persistent Trippy chat bottom). Magazine/Board open in center, replacing itinerary view. | ✅          |
| D23 | LLM geocode hint format        | IG prompt requires fully qualified: **"[Place], [neighborhood], [city], [country]"** (e.g., "Hotel Gracery Shinjuku, Yasukuni-dori, Shinjuku, Tokyo, Japan"). ~+200 tokens to IG output (+$0.003/call).                          | ✅          |
| D24 | External API cost pass-through | **Google APIs (Places, Photos) at pass-through (no founder margin)**: `ceil(cost / 0.01 × 100) / 100`. Anthropic web search keeps 30% margin (bundled with LLM where we add value). Per-call costs locked in §3 cost table.                | ✅          |
| D25 | Hotel geocoding smart escalation | Hotels: Photon-first with cheap heuristic pre-check (chain regex, bad-hint detection) + post-check (city-centroid match, low-importance result) → escalate to Google when needed. ~30-40% escalation rate. Activity geocoding: Photon-only + on-demand "Fix location" button. | ✅          |
| D26 | Sprint kickoff date            | **2026-05-26 (today).** Day 1 = today; Phase 2 Feature 8 implementation in flight. Days 2-11 follow.                                 | ✅          |


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
| Onboarding tour                             | The 3-step setup wizard _is_ the onboarding.                             |
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
| Credit storage         | `**NUMERIC(10,2)`\*\* on `profiles.credits` and `credit_transactions.amount`                                                       | Exact decimal math, no float errors           |
| Credit charging        | **Cost-based, fair**: `ceil(actual_cost_usd / 0.007 × 100) / 100`. No `Math.max(1, ...)` floor.                                    | Replaces current integer-ceiling model        |
| Credit display         | `**Math.floor(balance)`\*\* wrapper everywhere user-facing; admin/debug shows 2 decimals                                           | Users never see fractions                     |
| Credit rescale         | **One-time 5× rescale** combined with the NUMERIC type change in a single Day 2 migration                                          | `credits::numeric * 5` in the `USING` clause  |
| Overdraw guard         | **Pre-flight check**: edge functions (RG / IG / chat) return 402 if `credits < 1.0` before calling Anthropic                       | Cheap, simple; accept ~$0.12 worst-case bleed |
| Rate limiting          | **Postgres counter per user per minute**, checked in `_shared/credits.ts`                                                          | Cheap; leverages existing auth path           |
| Email/transactional    | **None at launch** beyond Stripe receipts (Stripe handles them)                                                                    | Defer dedicated provider                      |
| Auth                   | **Google OAuth + email-mandatory signup + Supabase Identity Linking** (D9). Implementation = Day 1 Part C.                          | Replaces username-only fake-email model       |
| Geocoding              | **Photon-first with smart escalation to Google Places** (D25). Pass-through cost (D24). Stored lat/lng on activity rows.            | See Day 1 Part D                              |
| Credits UX             | **No persistent indicator** (D19). Top-right avatar dropdown for balance + top-up (D20). Warning at displayed ≤10 (D4).             | Day 2-3 wires this                            |
| Desktop                | **≥1024px breakpoint** (D21). Sidebar + center + persistent map/chat right panel (D22).                                             | **Phase 1 shipped 2026-05-27.** Trip-view screens (brainstorm + itinerary) only. Setup / Home / Public / Auth still mobile-stretched — Phase 2 backlog. |
| Cost guardrails        | **Anthropic hard spend cap** + **Supabase usage alerts**                                                                           | Set before Stripe goes live                   |

---

## 4. The 10-Day Plan

Each day has **one primary outcome**. If a day overruns, the next day's scope shifts — do not compound.

> **Working schedule assumption:** Mon–Fri, ~6 productive hours/day. Adjust day-by-day boundaries to match your real calendar.

### Day 0 — Pre-flight (½ day, today 2026-05-26)

- [x] D1–D26 decisions all confirmed (locked in §1 + cross-cutting decisions table)
- [ ] Verify production domain DNS (`tripjam.app`) + Vercel + production Supabase env vars all healthy
- [ ] Verify `.env.production` is complete (Anthropic key, Supabase service role, etc.)
- [ ] Configure Anthropic hard spend cap (recommend $50/day initial)
- [ ] Configure Supabase usage alerts
- [ ] Create Google Cloud project `tripjam-auth` for OAuth (prerequisite for Day 1 Part C)
- [ ] Verify Google Places API enabled and billing account has $200/mo free credit (covers ~11,765 calls/mo)
- [ ] Block calendar for 11 working days (was 10; +1 for Feature 8 in Day 1)

---

### Week 1 — Make it Safe & Salable

#### Day 1 (today, 2026-05-26) — Foundation + Feature 8 Navigation Fix + Auth Migration

**Heaviest day in the sprint** — combines original foundation work with Feature 8 (navigation permanent fix) and Day 1 Part C auth migration (Google OAuth + email mandatory + Identity Linking). Expect ~10-12 hours.

##### Part A — Safety net & cleanup (~1h)

- [ ] `git tag v1.0.0-pre-launch` on `main` and push tag
- [ ] `git checkout -b launch/v1` (long-lived launch branch)
- [ ] Add **Sentry** to frontend (`src/main.jsx`) tagged with `app_env`
- [ ] Add **Sentry** wrapper to edge functions via `_shared/sentry.ts`
- [ ] Remove hardcoded production anon key from `e2e/geocoding.spec.ts`
- [ ] `.gitignore` the 13 root-level `*-design*.html` / `*-validation*.html` / `*-fullpage.html` mockups (still untracked)
- [ ] Remove duplicate `DebugContext` definition (keep only `src/context.js`)
- [ ] Fix `CLAUDE.md` reference to non-existent `JoinView.jsx`

##### Part B — Edge function auth fixes (~1h)

- [ ] **Fix `city-deep-dive` (D16)** — currently missing both auth and credits. Add `authenticateUser` to `supabase/functions/city-deep-dive/index.ts`. (Credit deduction wired but stays commented until Day 2 migration lands.)
- [ ] **Fix `extract-preferences` (D15)** — add `authenticateUser` only. Code comment marking as free system-internal call.

##### Part C — Auth Migration (D9) (~6-8h)

Today TripJam uses username-only auth with fake email `username@tripjam.app`. Day 1 Part C replaces this with Google OAuth + mandatory real email + Supabase Identity Linking.

- [ ] Google Cloud Console: create OAuth 2.0 Client ID with redirect URIs for both staging + prod Supabase callbacks
- [ ] Enable Google provider in both Supabase Auth dashboards (staging + prod)
- [ ] Enable Supabase Identity Linking (auto-link same-email accounts)
- [ ] Update `src/Auth.jsx`: add email input as required, validate format, replace fake-email construction with real email in `signUp({ email, password })`, add "Continue with Google" button calling `supabase.auth.signInWithOAuth({ provider: 'google' })`
- [ ] DB migration: add `profiles.email TEXT`, `profiles.display_name TEXT`, sync trigger from auth.users; backfill existing users with synthetic emails so they don't break
- [ ] Force-prompt modal on first post-migration login for legacy users with `email LIKE '%@tripjam.app'`
- [ ] Verify three signup paths: (a) email+password new account, (b) Google OAuth new account, (c) existing username-only login with add-email prompt
- [ ] Verify identity linking: same email signed up via both methods links to one `auth.users` row

##### Part D — Feature 8 Navigation Fix (~2-3h, in parallel with Part C)

Per F8 design (smart escalation, pass-through Google cost):

- [ ] DB migration `20260526_geocode_metadata.sql`: add `geocode_source TEXT`, `geocode_confidence TEXT` columns to activities; create `geocode_overrides (place_normalized, city, lat, lng, source, created_by)` table
- [ ] Story 8.3: Investigate why `supabase.from("activities").update({transition_mins, transition_mode})` silently fails (line 2161). Likely `tmp-${Date.now()}` ID race or RLS — fix + add Sentry breadcrumb on failure
- [ ] Extend `places-proxy` with `action=lookup-place` (Google Places `findPlaceFromText` with `type=lodging`, returns place_id + lat/lng + business_status)
- [ ] Add smart escalation helper to `places-proxy`: `shouldEscalateToGoogle(name, hint, city)` — checks (a) hint = city name, (b) chain regex (Hilton/Marriott/Hyatt/Gracery/Granbell/etc.), (c) Photon result post-check (city centroid match, low importance)
- [ ] Update `selectHotel` in `App.jsx` line 2650: before insert, call smart escalation. If escalates → `lookup-place` for lat/lng. If not → Photon. Persist coords to activity row.
- [ ] Update `TransitionRow` ([src/App.jsx:1400](src/App.jsx)): read stored lat/lng first, only call `geocodePlace` when missing. Show "Fix location" button if pin appears wrong.
- [ ] Update IG prompt: require fully qualified geocode format per D23
- [ ] One-shot backfill script `scripts/backfill-activity-geocodes.cjs` for 2,527 existing activities (run staging first, then prod with approval)

**Done when:**
- Sentry receives test errors from both frontend + edge function in staging
- `city-deep-dive` + `extract-preferences` both reject unauthenticated requests
- All three signup paths verified (email/password, Google OAuth, legacy migration prompt)
- Identity linking smoke test passes (same email + two providers = one user row)
- New trip generation shows hotel coordinates persisted via smart escalation (verified in DB)
- Backfill script run on staging successfully; spot-check 10 random activities show correct lat/lng

**If running out of time:** Defer Android Google OAuth piece to Day 1b (push Day 2 by half a day). Web Google OAuth + Feature 8 are the critical path.

**Already-done pre-sprint items (count toward Day 1's outcome):**

- [x] **Credits UI disabled via `CREDITS_UI_ENABLED = false`** (commit `e8f6679`) — gates `openPaywall`, `refreshCredits`, `handleGatedResponse`, `useEnsureCreditsLoaded`; 3 `<CreditsOverlay>` mounts in `main.jsx` gated; tree-shaken out of production bundle. **At launch time, this needs to flip back to `true`** (see Day 2 + Day 3 notes).
- [x] **`face_icon` signup bug fixed** (commit `f91528d`) — `Auth.jsx` was inserting emoji string into integer column, silently failing every signup. Now stores `faceIcon + 1` and surfaces upsert errors. Prevents recurring missing-profile bugs.
- [x] **Production credit balances pre-set to 999999** + new-signup default = 999999. To re-enable credits properly at launch, reset to launch values (see Day 2 Part A note below).

**New items added 2026-05-26:**

- [ ] **Audit `face_icon` UI rendering** — verify `CreditPill`, `Home.jsx`, `Admin.jsx`, anywhere `profiles.face_icon` is displayed correctly handles integer 1-10 → emoji lookup (it was previously stored as emoji string, now stored as integer index)
- [ ] **Deploy `face_icon` Auth.jsx fix to staging Vercel preview** — push a non-main branch to trigger preview build (or wait until first preview deploy of the launch sprint branch picks it up). Today's fix is on prod (`main`) only.
- [ ] **Restore the 3 prod-backfilled users' face_icon picks** — they currently default to `1` after the missing-profile backfill. Optional UX touch — they can re-select via profile editor.

**Done when:** Sentry receives a test error from staging frontend AND from a staging edge function. `city-deep-dive` and `extract-preferences` both reject unauthenticated requests. `face_icon` UI audit passes for all integer values 1-10.

#### Day 2 (Tue) — Stripe Wiring + Credit System Overhaul

**Primary outcome:** Decimal credits with integer display live in staging; test-mode Stripe purchase grants 500 credits end-to-end.

This is the heaviest day in the sprint. Do migration + code first; Stripe last (so you're not debugging Stripe on top of a broken credits model).

**Part A — Database migration (do first)**

> **⚠️ Current state caveat (per §0.5):** all profiles in prod + staging currently have `credits = 999999` (intentionally inflated for the credits-disabled period). The original `credits::numeric * 5` rescale would turn these into 4,999,995 — undesirable. **Reset to launch values BEFORE the rescale** (or skip the multiplication and set to launch value directly). Also note: `credit_transactions` table does NOT exist on staging (only on prod) due to the schema migration collision (see §10 backlog).

Create `supabase/migrations/20260522_decimal_credits_rescale.sql`:

```sql
-- Step 0 (new — required because credits were inflated to 999999 pre-sprint):
-- Reset everyone to the intended launch starting balance before changing types.
-- D1 says 100 credits on signup = the new "free starting balance".
-- Adjust this if you want existing users to start with more.
UPDATE profiles SET credits = 100 WHERE credits = 999999;
ALTER TABLE profiles ALTER COLUMN credits SET DEFAULT 100;

-- Combined NUMERIC type change (no rescale multiplier needed — D1 + D2 already encode the new scale)
ALTER TABLE profiles
  ALTER COLUMN credits TYPE NUMERIC(10,2);

-- credit_transactions exists on prod, may not on staging — guard with IF EXISTS
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credit_transactions') THEN
    ALTER TABLE credit_transactions ALTER COLUMN amount TYPE NUMERIC(10,2);
    ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS stripe_session_id TEXT UNIQUE;
  ELSE
    -- Create from scratch for staging
    CREATE TABLE credit_transactions (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      amount NUMERIC(10,2) NOT NULL,
      balance_after NUMERIC(10,2) NOT NULL,
      reason text NOT NULL,
      function_name text,
      llm_cost_usd NUMERIC(10,6),
      stripe_session_id text UNIQUE,
      created_at timestamptz DEFAULT now()
    );
  END IF;
END $$;

-- Add Stripe columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Update RPCs to accept NUMERIC. Re-create with NUMERIC parameter type.
-- deduct_credits(p_user_id uuid, p_amount NUMERIC, p_function_name text, p_model text, p_llm_cost_usd NUMERIC)
-- grant_credits(p_user_id uuid, p_amount NUMERIC, p_source text, p_stripe_session_id text)
```

- [ ] Push migration to staging Supabase; verify all existing test-account balances are now `100.00` (not `999999`)
- [ ] Verify `credit_transactions` table exists on both environments after migration
- [ ] Verify `deduct_credits` and `grant_credits` RPCs work with NUMERIC inputs (including fractional like `5.72`)
- [ ] **Re-enable the credits UI:** in `src/credits.js`, flip `CREDITS_UI_ENABLED = true`. After deploy, the pill + paywall will reappear and balances drive real behavior.

**Part B — Code changes**

- [ ] Update `supabase/functions/_shared/credits.ts`:
  - `CREDIT_LLM_BUDGET_USD = 0.007` (was `0.035`)
  - `EXTERNAL_API_USER_VALUE = 0.01` (new — for D24 Google pass-through)
  - `costToCredits(usd) → Math.ceil((usd / 0.007) × 100) / 100` (LLM calls; no `Math.max(1, ...)` floor)
  - `costToCreditsPassthrough(usd) → Math.ceil((usd / 0.01) × 100) / 100` (new — for Google APIs per D24)
  - Add `requireMinCredits(user, min = 1.0)` helper that returns 402 if `user.credits < min`
- [ ] Update `places-proxy`: deduct credits inline for Google calls using pass-through formula. Lookup-place + Photo actions both deduct.
- [ ] Update `src/credits.js`:
  - Add `displayCredits(balance)` = `Math.floor(balance ?? 0)`
  - **Remove `<CreditPill>` (top-right green dot pill) entirely per D19** — replaced by avatar dropdown menu (Day 3)
  - Admin/debug mode shows `balance.toFixed(2)` (full precision) — gate behind `?debug=1` or `profiles.is_admin`
- [ ] Add pre-flight check to `generate-brainstorm/index.ts`, `generate-itinerary/index.ts`, `chat/index.ts`:
  - Call `requireMinCredits(user, 1.0)` before invoking Anthropic; return 402 with code `insufficient_credits` if blocked

**Part C — Stripe wiring (TWO PACKS per D2 updated 2026-05-26)**

- [ ] Create Stripe account (test mode); create **two products**:
  - Small pack: `credits_300_pack` at $5.00 USD (=300 credits)
  - Large pack: `credits_1000_pack` at $10.00 USD (=1000 credits)
  - Enable Adaptive Pricing on both (D3)
- [ ] New edge function `create-checkout-session` — auths the user, takes a `pack` query param (`"small" | "large"`), maps to the right Stripe product, creates Checkout Session, returns the URL
- [ ] New edge function `stripe-webhook` — verifies signature → on `checkout.session.completed`, reads the line item's product → grants either 300 or 1000 credits via `grant_credits(user_id, amount, 'stripe', session.id)`; idempotent on `credit_transactions.stripe_session_id UNIQUE` constraint
- [ ] Register webhook endpoint URL in Stripe dashboard (staging URL first)
- [ ] End-to-end test both packs: complete each Stripe test checkout → verify webhook fires → verify correct credit amount granted (300 or 1000) → replay webhook → verify no double-grant

**Done when:**

- [ ] Migration applied to staging without errors; existing test accounts show `100.00` credits, stored as decimal
- [ ] Smallest Haiku call (e.g. todos at $0.0027) deducts `0.39` credits from balance, not `1`
- [ ] Google Places call (in places-proxy) deducts `1.70` credits per D24 pass-through
- [ ] User-facing credit display is always whole integer (Math.floor), admin shows decimals
- [ ] RG / IG / chat all return 402 when `credits < 1.0` without calling Anthropic
- [ ] Stripe test purchase grants `500.00` credits exactly once; webhook replay is idempotent
- [ ] **CREDITS_UI_ENABLED flipped to `true`** in `src/credits.js` AND `<CreditPill>` removed (pre-existing pill replaced by Day 3 avatar dropdown UX)

#### Day 3 (Wed) — Credits UX (per F7) + Purchase Flow

**Primary outcome:** No persistent credits indicator (per D19). Avatar dropdown in top-right (per D20) is the entry point for balance + top-up. Stripe Checkout for $5 → 500 credits.

**New UI scope (replaces old "CreditsOverlay" design):**

- [ ] **Top-right avatar component** (new `src/Avatar.jsx`): small 32×32 icon showing user's face_icon emoji, mounted globally in `main.jsx` for every authenticated view
- [ ] **Avatar dropdown** (click): Profile · **Credits (current balance + Top up button)** · Sign out
- [ ] **No persistent CreditPill** anywhere (D19) — confirm removed in Day 2 Part B
- [ ] **Low-credits banner**: appears at top of screen when `displayCredits(balance) <= 10` (D4 updated); dismissible per-session ("10 credits left — top up?")
- [ ] **Hard-stop modal**: when `displayCredits(balance) === 0` (D5) with single "Top up" CTA
- [ ] **"Top up" button** (from avatar dropdown OR low-credit banner OR hard-stop modal) → opens **pack selector modal** with two options:
  - "Small · 300 credits · $5"
  - "Large · 1000 credits · $10 — best value · 3.3× more per dollar" (highlighted as default)
  - User picks → calls `create-checkout-session?pack=small|large` → opens Stripe Checkout in new tab
- [ ] Success-return URL `/credits/success` → shows toast "300 credits added!" or "1000 credits added!" (based on which pack) + auto-refreshes balance via `refreshCredits()`
- [ ] Cancel-return URL `/credits/cancel` → silent return to app
- [ ] On top-up success, leftover decimals roll forward — `0.42 + 500 = 500.42`, displayed as `500`. No special handling needed; document in code comment.
- [ ] Admin/debug shows full precision (`balance.toFixed(2)`); users see integer only
- [ ] Inline hint near Magazine tab: *"~1 credit per city explored"* (R12 mitigation)

**Done when:**
- [ ] Avatar visible in top-right of every authenticated view
- [ ] Click avatar → dropdown opens → shows current balance + Top up button + Sign out
- [ ] Logged-in user can run out of credits → click Top up → pay (test mode) → see new balance reflected within 5 seconds
- [ ] Low-credit banner appears when 10 displayed credits remain; dismissable; doesn't reappear same session
- [ ] Admin sees `99.42` while user sees `99`
- [ ] No green-dot pill or other persistent credit indicator visible anywhere in default views

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

#### Day 6 (Mon) — Performance Pass + IG Speedup (F6) + Magazine Pre-fetch Reduction

**Primary outcome:** TTC (total time to complete) for IG reduced significantly. Progressive disclosure — show each day only when it is COMPLETE (with photos + navigation). Plus general perf wins.

##### Part A — IG speedup (F6 per USER_STORIES decisions)

Q6a: TTC is primary pain (~25-40s currently). Q6b: progressive disclosure OK, but only show days when COMPLETE. Q6c: keep two-phase compact-then-detailed. Q6d: no caching (every trip unique).

- [ ] **Parallelize day completion**: as each day streams in from detailed phase, immediately kick off photo prefetch + geocode resolution for that day's activities in parallel. Don't wait sequentially.
- [ ] **Show day as "complete" only when all three ready**: detailed IG response received + photos cached + activity coords resolved. Day card shows skeleton until all three are done, then transitions to interactive state with full content.
- [ ] **Optimize IG compact phase**: confirm `max_tokens: 4000` is appropriate; if shorter compact is acceptable for the design, reduce to 2500 to save ~3s.
- [ ] **Reduce IG output verbosity for activities**: tighten prompt to skip filler text in `note` fields when not actionable. Saves ~10-15% output tokens.
- [ ] **Prefetch Day N+1 photos/geocodes when Day N is rendered** (already partly there per CLAUDE.md preload logic; extend to ensure geocode resolution is included)
- [ ] **Add Sentry timing breadcrumbs**: log `ig_compact_complete_at`, `ig_detailed_day_N_complete_at`, `day_N_fully_rendered_at` — gives us real TTC data to optimize against post-launch

##### Part B — Perf pass (existing scope)

- [ ] Lazy-load `src/airports-data.json` (418 KB) — only import on Setup form mount
- [ ] Run `vite build --report` (or `rollup-plugin-visualizer`) — identify other split opportunities
- [ ] Verify PWA caching strategy for Wikipedia images (already configured per CLAUDE.md)
- [ ] OG tags for `/share/:token` pages so shared trips render rich previews in iMessage/WhatsApp/Slack
- [ ] Lighthouse audit: landing page mobile score ≥ 85, logged-in shell ≥ 75

##### Part C — Magazine pre-fetch reduction (D17, R12 mitigation)

In `src/App.jsx` around lines 2532-2569:
- [ ] Keep the destination-only pre-fetch on RG-complete (1 call, ~0.76 credits)
- [ ] **Remove** the "top 2 cities" auto pre-fetch — currently triggers 2 extra deep dives users haven't asked for
- [ ] **Add** city deep-dive lazy-load only when the user opens the Magazine tab, with skeleton states for visible cards
- [ ] Each city card shows a skeleton loader on first paint, then renders content after Haiku returns (~1s)

**Done when:**
- [ ] **Day 1 photos + navigation render within 2-3 seconds of Day 1 itinerary text first appearing** (per Story 6.2 revised 2026-05-26)
- [ ] Subsequent days appear progressively, each "complete" before being shown as interactive
- [ ] Landing page LCP < 2.5s on a throttled mobile
- [ ] Share link in iMessage shows trip thumbnail + title
- [ ] After RG completes, only 1 deep dive (destination) has fired — verify in `llm_usage` table
- [ ] Sentry shows TTC + Day-1 photos+nav timing distribution we can use for post-launch optimization decisions

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

### Margin per paid pack (two-pack model per D2)

**Small pack: $5 → 300 credits** ($0.0167/credit, **better-for-founder pricing**)
- $5 retail → ~$4.55 after Stripe (~$0.45 fee)
- 300 credits × $0.007 LLM budget = $2.10 reserved for LLM spend
- Realistic LLM spend: ~$1.20-1.60 (rounding works in founder's favor)
- **Net margin: $2.95-3.35 (59-67%)** before infrastructure

**Large pack: $10 → 1000 credits** ($0.01/credit, **better-for-user pricing**)
- $10 retail → ~$9.41 after Stripe (~$0.59 fee)
- 1000 credits × $0.007 LLM budget = $7.00 reserved
- Realistic LLM spend: ~$4.00-5.50
- **Net margin: $3.91-5.41 (39-54%)** before infrastructure

**Blended assumption** (if 60% buy small, 40% buy large): ~52% blended margin. Small pack has higher % margin per dollar but lower absolute revenue. Large pack drives volume.

**Why two packs:** the small pack is the impulse buy ($5 feels low) for users who just want a top-up. The large pack is the value option for engaged users planning multiple trips — 3.3× better per-credit deal incentivizes upgrading.

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

### New items added 2026-05-26 (pre-sprint cleanup)

A. ~~Decision on the Inspirations feature~~ — **Resolved 2026-05-27 via path 1 (merge).** Migrations consolidated into `20260527000003_destination_research_cache.sql` (fresh timestamp avoids the prior `20260513000001` collision with `create_credits_system.sql`). Edge function `generate-destination-research` rewritten with auth + rate limit + credit deduction (Haiku 4.5, max 4 web searches per call — was Sonnet + 8 on the orphan branch). `InspirationsSection` ported into current `Magazine.jsx`, wired into the post-IG Magazine view in `App.jsx` as an opt-in button ("Get destination inspirations · ~8 credits"). Deployed to staging + prod, smoke-tested. Pre-trip Magazine + per-activity sources pill remain Phase 2.

B. **Schema migration version collision cleanup** — `20260513000001` was used for two different migrations on different branches (main = `_create_credits_system.sql`, inspiration = `_destination_research_cache.sql`). Staging applied the inspiration version; when main's `db:push:staging` saw the version was "already applied" it skipped → credits column never got created on staging (worked around in §0.5). Long-term fix: rename one of them with a fresh timestamp, document the convention.

C. **Apply Auth.jsx `face_icon` fix to staging Vercel preview** — fix is on `main` → prod only. Staging won't pick it up until a preview branch is built. New signups on staging continue to silently fail until fixed.

D. **`face_icon` UI audit** — if not closed during Day 1, defer here. Verify integer 1-10 → emoji rendering across `CreditPill`, `Home.jsx`, `Admin.jsx`, and any other consumer of `profiles.face_icon`.

E. **Restore credits flow at launch** — Day 2 already covers the migration + reset, but tracking explicitly here so it's not forgotten: flip `CREDITS_UI_ENABLED = true` in `src/credits.js` AND reset `profiles.credits` from 999999 to launch starting values, AND deploy.

### New scope from USER_STORIES.md (2026-05-26, deferred to post-launch)

Full story details in [USER_STORIES.md](USER_STORIES.md). Brief summary here for backlog tracking.

**F1 — Inspirations (RG + IG)** — month 1 priority
- Use existing `inspiration` branch as starting point; merge into main with schema-version rename (collision fix)
- Switch main research call from Sonnet → Haiku 4.5; reduce web search `max_uses` 8→4
- Charge **7.72 credits per cold digest** (cache hits free); button opt-in UX ("Get destination inspirations · ~8 credits")
- Show alongside route options panel (not as input to LLM)
- `ⓘ N sources` pill on activity cards (existing branch design)
- New ideas: bookmark digest to reading list, refresh button, filter by tags

**F2 — Chat enhancements** — month 1 priority
- Faster TTL (target ≤1.5s to first token); "Thinking..." indicator if model is slow
- Auto-fetch thumbnails for places mentioned in chat: Wikipedia first (free) → Google Photos fallback (0.70 credits, pass-through)
- Actionable replies: "➕ Add to itinerary · 📍 Open in Maps · 🔍 Tell me more" buttons
- Cleaner shorter replies (system prompt tweak for brevity)
- **NEW: "View Updated Itinerary" button gets snippet + thumbnail preview** of what changed (per Q2c)

**F3 — Google Photo automatic fallback** — month 2
- Wikipedia first (free) → Google Photo automatic fallback ONLY when Wikipedia returns nothing
- No opt-in "Get better photo" button (Story 3.1 rejected 2026-05-26 — silent UX preferred)
- Charged 0.70 credits/photo (pass-through, no founder margin per D24); silent deduction same as navigation geocoding
- Server-side cache so subsequent users get free photos for the same place

**F4 — Homepage redesign** — month 1 (high impact)
- Visual trip cards with cached destination photo (no editorial commission)
- Tab buttons on each card depending on trip state:
  - Pre-IG (only RG done): `Routes · Map · Board · Magazine`
  - Post-IG: `Routes · Itinerary · Map · Board · Magazine` (BOTH visible)
  - Route directly to `/trip/:id/plans` (Routes) or `/trip/:id` (Itinerary) etc.
  - Default tap on card goes to Itinerary if generated, else Routes
- Smart featured destinations carousel for new users (curated initially, data-driven post-launch month 2 based on time-of-year + aggregate trip popularity)
- (Past-trips memories section CUT per Q4d)

**F5 — Desktop web** — month 2+ (large project)
- Breakpoint ≥1024px (D21); below = mobile-stretched
- Layout (D22): left sidebar (240px trips list) + center column (~50% itinerary/active tab) + right column (~50% persistent map top + persistent Trippy chat bottom)
- Magazine and Board open in center column replacing itinerary
- Responsive CSS using shared components (no fork)
- No desktop-only features (no drag-drop, no keyboard shortcuts) per Q5d

**F8 (continued) — Navigation accuracy follow-ups** — post-launch
- Story 8.4: Admin geocode audit tab — lists activities with "Fix location" usage > N or low-confidence resolutions
- Story 8.5: User-driven location corrections (long-press → mini-map → drop pin → save to global geocode_overrides)
- **Self-hosted Pelias geocoder** (~$10/mo VPS, 3-5 days work) — eliminates Google Places per-call cost long-term

### Existing items (in rough priority order)

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
| 2026-05-26 (PM) | **Late-day product tweaks (post Feature 8 deploy).** Story 3.1 REJECTED — no "Get better photo" opt-in button; F3 simplifies to silent Wikipedia → Google fallback only when Wikipedia returns nothing. Story 4.2 REVISED — homepage trip-card tab buttons depend on trip state: show **Routes always**, show **Itinerary only when IG generated** (both visible post-IG). Story 6.2 REVISED — stricter Day 1 perf target: photos + nav must load within **2-3s of Day 1 itinerary text first appearing** (down from 8s). D2 + Story 7.2 REVISED — **two-pack pricing** instead of single SKU: Small `$5 → 300 credits` ($0.0167/credit) and Large `$10 → 1000 credits` ($0.01/credit, 3.3× better deal per credit). Volume discount, two Stripe products, pack selector modal in Day 3 UX. §7 margin table rewritten for both packs (~59-67% small, ~39-54% large). | Claude + Achin |
| 2026-05-26 | **Sprint kickoff.** USER_STORIES.md created + 8 features reviewed end-to-end. D6-D10 re-confirmed with rolled-back v3 values (tripjam.app, achinj.work@gmail.com, no-refund + 30d rider, Google OAuth + email mandatory + Identity Linking, sequenced launch channels). D4 lowered 15→10 per F7 directive. New D19-D26 added: no persistent credits UI (D19), avatar dropdown entry point (D20), ≥1024px desktop breakpoint (D21), sidebar+center+chat/map layout (D22), fully qualified geocode hint format (D23), Google API pass-through cost model with no founder margin (D24), smart escalation for hotels via heuristic chain/bad-hint detection (D25), sprint kickoff date 2026-05-26 (D26). Launch scope decisions: F6 IG speedup → Day 6, F7 credits rebuild → Day 2-3, F8 navigation fix → Day 1 (today). F1-F5 deferred to post-launch backlog with detailed stories. Day 1 expanded with Parts A (safety/cleanup), B (edge fn auth), C (auth migration Google OAuth), D (Feature 8 navigation fix). Day 2 reframed with new credits flow: no pill, avatar dropdown, warning at 10. Day 3 rebuilt around F7 stories (no persistent indicator, avatar entry point, top-up via Stripe). Day 6 expanded with F6 IG speedup (parallelize photo prefetch + geocode resolution, show days only when COMPLETE, Sentry timing breadcrumbs). Cost model corrections: Google calls 1.70 credits/call (pass-through), Google photos 0.70 credits/photo, Inspirations digest 7.72 credits (cold, button opt-in). Typical trip cost ~46 credits cold (free tier covers ~2 trips). | Claude + Achin |
| 2026-05-25 | **Pre-sprint deploys (out-of-band):** Disabled credits UI globally for testing — added `CREDITS_UI_ENABLED = false` flag in `src/credits.js`, gated 3 `<CreditsOverlay>` mounts in `src/main.jsx`, all paywall + balance code tree-shaken from production bundle (commit `e8f6679`). Pre-set all 30 production profiles to `credits = 999999` (column default also set to 999999) via direct SQL. Same fix applied to staging (which also required adding the missing `credits` column due to migration version-number collision with the `inspiration` branch). Backfilled 3 prod + 2 staging users with missing `profiles` rows. Discovered + fixed `Auth.jsx` signup bug (`face_icon` integer column was rejecting emoji-string upserts, silently breaking every signup); fix landed via commit `f91528d`. Both commits deployed to production via push to `main`. | Claude + Achin |
| 2026-05-26 | **Consolidation pass.** File was rolled back somewhere between 2026-05-22 and 2026-05-26 — the Android-first / Play Store / RevenueCat pivot and Google-OAuth Day 1 Part C work that previously lived in v2/v3 drafts are not currently present in this file. (The credit decimal model D11-D18 remains intact.) This consolidation adds: §0.5 Current State Snapshot summarizing pre-sprint deploys; annotations to Day 1 (already-done items + new items like staging Auth deploy, `face_icon` UI audit, backfilled-user `face_icon` restoration); Day 2 Part A reworked to handle the current 999999 credit balances (reset to launch value before NUMERIC rescale; handle missing `credit_transactions` on staging via conditional `DO $$ BEGIN ... END $$`); §10 backlog additions A-E (Inspirations decision, schema collision cleanup, staging Auth deploy, `face_icon` audit fallback, credits re-enable tracking); fix to broken D4 row text. | Claude + Achin |


