# 12 — Admin Console

The founder-facing admin console lives at `/admin` and is a single component, [src/Admin.jsx](../../src/Admin.jsx) (~1,070 lines, no sub-components). It has four tabs — **Users**, **Trips**, **Credits**, **Daily** — all fed by direct Supabase reads from the browser (`profiles`, `trips`, `trip_messages`, `llm_usage`, `credit_transactions`, `api_usage`, plus per-trip drill-down tables). Cost figures are computed client-side from `llm_usage` token counts using hardcoded Anthropic rates that mirror the server-side pricing in [supabase/functions/\_shared/credits.ts](../../supabase/functions/_shared/credits.ts). Access is a client-side `is_admin` check plus RLS policies on the sensitive tables — with some caveats noted below.

---

## 1. Routing and access gating

- **URL:** `parseUrl()` maps `/admin` → `{ page: "admin" }` at [main.jsx:103](../../src/main.jsx#L103). There is no `is_admin` check in the router.
- **Session:** `Root()` renders `AdminConsole` only when a session exists — unauthenticated visitors to `/admin` fall through to the Auth screen ([main.jsx:250-258](../../src/main.jsx#L250-L258)). The admin route also mounts the usual overlays (`AddRealEmailPrompt`, `LowCreditsBanner`, `Avatar`, `CreditsOverlay`) at [main.jsx:261-277](../../src/main.jsx#L261-L277).
- **Admin check (client-side):** on mount, `Admin.jsx` reads the caller's _own_ profile row — `profiles.select("is_admin").eq("id", session.user.id)` — and if `is_admin` is falsy calls `onHome()` (pushes `/` + reloads) ([Admin.jsx:67-78](../../src/Admin.jsx#L67-L78)). While the check is pending it renders "Checking access…" ([Admin.jsx:306-321](../../src/Admin.jsx#L306-L321)); all data-loading effects are gated on `isAdmin === true` ([Admin.jsx:82](../../src/Admin.jsx#L82), [Admin.jsx:122](../../src/Admin.jsx#L122)).
- **Server-side enforcement is RLS, not the component.** The `is_admin` boolean was added to `profiles` in [20260511000002_create_llm_usage_and_admin.sql:2](../../supabase/migrations/20260511000002_create_llm_usage_and_admin.sql#L2). A user who bypasses the client redirect just issues the same PostgREST queries with their own JWT, so what they can actually see is whatever RLS grants them (see §5). There is no admin-only edge function; the console talks straight to the database.

---

## 2. Tabs

Tab state is a simple `useState("users")` with four header buttons ([Admin.jsx:54](../../src/Admin.jsx#L54), [Admin.jsx:370-383](../../src/Admin.jsx#L370-L383)). A global stats bar renders above every tab: user count, trip count, LLM call count, total cost, total input/output tokens ([Admin.jsx:290-304](../../src/Admin.jsx#L290-L304), [Admin.jsx:396-402](../../src/Admin.jsx#L396-L402)). Note the LLM figures are computed from the **last 1,000 `llm_usage` rows only** (the fetch is `.limit(1000)`, [Admin.jsx:124-128](../../src/Admin.jsx#L124-L128)), so "Total Cost" is a rolling window, not all-time.

### 2.1 Users tab

Data load ([Admin.jsx:81-118](../../src/Admin.jsx#L81-L118)): all `profiles`, all `trips` (selected columns incl. `ig_response`, `ig_count`), all `trip_messages` (`user_id, trip_id, role`), and `trip_members`. (`trip_members` is fetched but never used afterward — dead query.)

Per-user computed metrics:

| Column      | Source                                                                                                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trips       | count of `trips.created_by === user.id` ([Admin.jsx:103](../../src/Admin.jsx#L103))                                                                                                                                              |
| Chats       | count of `trip_messages` with `role === "user"` by that user ([Admin.jsx:104-106](../../src/Admin.jsx#L104-L106))                                                                                                                |
| Balance     | `profiles.credits`, color-coded (≤0 red/gold, <10 gold, else green) ([Admin.jsx:705-707](../../src/Admin.jsx#L705-L707))                                                                                                         |
| Spent ($)   | sum of `calcCost()` over `llm_usage` rows whose `trip_id` belongs to a trip the user created ([Admin.jsx:691-704](../../src/Admin.jsx#L691-L704)) — attribution is via trip ownership, since `llm_usage` has no `user_id` column |
| Last Active | `created_at` of the user's most recent trip ([Admin.jsx:111](../../src/Admin.jsx#L111))                                                                                                                                          |

Clicking **View** shows that user's trips (status = "Built" if `ig_response` is set, else "Planning"; IG regeneration count from `trips.ig_count`, [Admin.jsx:484-524](../../src/Admin.jsx#L484-L524)). Clicking **Detail** on a trip runs `loadTripDetail()` ([Admin.jsx:185-249](../../src/Admin.jsx#L185-L249)) — seven parallel queries: `days` (with nested `activities(id, type)`), `trip_messages`, `generation_log`, `brainstorm_items`, `trip_todos`, `trip_bookmarks`, `trip_expenses`. The detail card shows:

- Counts: days, activities, chat messages, routes generated/dismissed (from `brainstorm_items.dismissed`), IG generations (`generation_log` row count), todos, bookmarks, expenses ([Admin.jsx:549-578](../../src/Admin.jsx#L549-L578)).
- **Activity type breakdown** — a tally of `activities.type` chips ([Admin.jsx:242-247](../../src/Admin.jsx#L242-L247), [Admin.jsx:600-615](../../src/Admin.jsx#L600-L615)).
- **IG timing** — derives compact/detailed durations client-side from `generation_log`'s `generation_started_at` / `compact_ready_at` / `detailed_ready_at` timestamps ([20260427000003_create_generation_log.sql](../../supabase/migrations/20260427000003_create_generation_log.sql), [20260504000001](../../supabase/migrations/20260504000001_add_detailed_ready_to_generation_log.sql)). (Fixed 2026-07-13 — it previously read nonexistent `compact_secs`/`detailed_secs` columns and always rendered "Compact ?s".)
- **Per-trip LLM usage table** — every `llm_usage` row for the trip with function name, model (displayed as just "Haiku"/"Sonnet"), tokens, per-call cost, date ([Admin.jsx:630-667](../../src/Admin.jsx#L630-L667)). Trip API cost is summed with full cache-aware `calcCost` ([Admin.jsx:214-226](../../src/Admin.jsx#L214-L226)).

### 2.2 Trips tab

Flat table of all trips ([Admin.jsx:749-798](../../src/Admin.jsx#L749-L798)): name, destination, date range, Built/Planning status, `ig_count`, per-trip cost, created date. Quirk: the cost sum here calls `calcCost(u.model, u.input_tokens, u.output_tokens)` **without** the cache token arguments ([Admin.jsx:767-773](../../src/Admin.jsx#L767-L773)), so it slightly undercounts cached calls relative to the Users/Credits tabs.

### 2.3 Credits tab

Four sections:

1. **By Function** ([Admin.jsx:804-864](../../src/Admin.jsx#L804-L864)) — `llm_usage` rows grouped by `function_name|model`; per group: calls, input/output tokens, cache-aware cost; sorted by cost descending.
2. **Verify-place ladder** ([Admin.jsx:866-950](../../src/Admin.jsx#L866-L950)) — reads `api_usage` where `api = 'verify-place'` for the last 30 days ([Admin.jsx:167-181](../../src/Admin.jsx#L167-L181)), summing `count` per `scope`. Scopes map to the geocode-verification cascade tiers (`cache-hit`, `override`, `tier1-photon`, `tier2-nominatim`, `tier3-haiku-pass`, `tier4-google-call`, `tier4-google-pass`, `tier5-alternatives`, `unresolved`) with hardcoded cost notes — used to tune thresholds so most hits stay on free tiers. `api_usage` shape: `(api, scope, period, count)` with a UNIQUE key ([20260420000002_create_api_usage.sql](../../supabase/migrations/20260420000002_create_api_usage.sql)).
3. **User Balances** ([Admin.jsx:952-986](../../src/Admin.jsx#L952-L986)) — `profiles.credits` per user plus "Total Spent" = sum of negative `credit_transactions.amount`, and last transaction date. Transactions are fetched separately: latest 500 rows ([Admin.jsx:154-161](../../src/Admin.jsx#L154-L161)).
4. **Recent Transactions** ([Admin.jsx:988-1032](../../src/Admin.jsx#L988-L1032)) — first 100 of those rows: date, username, `reason`, signed `amount` (Δ), `balance_after`, `llm_cost_usd`.

### 2.4 Daily tab

Client-side aggregation of the same 1,000-row `llm_usage` window, bucketed by the date part of `created_at` ([Admin.jsx:131-151](../../src/Admin.jsx#L131-L151)): calls, input/output tokens, cache-aware cost per day; the table shows the 30 most recent days ([Admin.jsx:1037-1064](../../src/Admin.jsx#L1037-L1064)). The "last 30 days" label is only as complete as the 1,000-row window allows.

---

## 3. Cost model

Client-side rates at [Admin.jsx:5-11](../../src/Admin.jsx#L5-L11):

| Model                       | Input                                                                | Output         |
| --------------------------- | -------------------------------------------------------------------- | -------------- |
| `claude-sonnet-4-6`         | $3 / M tokens                                                        | $15 / M tokens |
| `claude-haiku-4-5-20251001` | $0.80 / M tokens                                                     | $4 / M tokens  |
| _(unknown model)_           | falls back to Sonnet rates ([Admin.jsx:26](../../src/Admin.jsx#L26)) |

Prompt-caching multipliers, relative to the base input rate ([Admin.jsx:16-17](../../src/Admin.jsx#L16-L17)): cache **write = 1.25×**, cache **read = 0.10×**. The three input buckets (`input_tokens`, `cache_creation_tokens`, `cache_read_tokens`) are disjoint, matching what the Anthropic API reports. Full formula in `calcCost()` ([Admin.jsx:19-33](../../src/Admin.jsx#L19-L33)):

```
cost = in·rIn + cacheWrite·rIn·1.25 + cacheRead·rIn·0.10 + out·rOut
```

This mirrors the server-side `computeLLMCost()` in [\_shared/credits.ts:34-65](../../supabase/functions/_shared/credits.ts#L34-L65), which is the one that actually bills users (the server table also has a `claude-haiku-4-5` alias). Credits charged = `ceil((usd / 0.007) * 100) / 100` — each credit covers $0.007 of LLM spend, i.e. 70% LLM budget / 30% margin ([credits.ts:40-72](../../supabase/functions/_shared/credits.ts#L40-L72)); external API costs (Google Places) pass through at $0.01/credit with no margin ([credits.ts:74-78](../../supabase/functions/_shared/credits.ts#L74-L78)). The admin console displays raw USD, not credits; sub-cent values get 4 decimal places (`fmtCost`, [Admin.jsx:35-37](../../src/Admin.jsx#L35-L37)).

Aggregation is always the same pattern: filter the fetched `llm_usage` rows (by trip, by user-owned trips, by `function_name|model` key, or by day) and `reduce` with `calcCost` per row.

---

## 4. The `llm_usage` table and how it's written

Created in [20260511000002_create_llm_usage_and_admin.sql](../../supabase/migrations/20260511000002_create_llm_usage_and_admin.sql):

```sql
id uuid PK · trip_id uuid REFERENCES trips(id) · function_name text
model text · input_tokens int · output_tokens int · created_at timestamptz
```

Later additions: `web_search_count` (default 0, [20260527000003:46](../../supabase/migrations/20260527000003_destination_research_cache.sql#L46)) and `cache_creation_tokens` / `cache_read_tokens` (default 0, [20260622000001](../../supabase/migrations/20260622000001_llm_usage_cache_tokens.sql)). There is **no `user_id` column** — user attribution happens through `credit_transactions` written by `deductCredits()`, as noted in [generate-destination-research/index.ts:269-271](../../supabase/functions/generate-destination-research/index.ts#L269-L271). (`schema.sql` at the repo root is a stale dump that predates this table entirely — trust the migrations.)

**Writes are per-function, not centralized.** Each edge function POSTs directly to PostgREST (`${SUPABASE_URL}/rest/v1/llm_usage`) with the service-role key, fire-and-forget with `.catch(() => {})`. `_shared/credits.ts` does _not_ insert into `llm_usage`; it only provides `deductCredits()` (which writes `credit_transactions` via the `deduct_credits` RPC, [credits.ts:230-275](../../supabase/functions/_shared/credits.ts#L230-L275)). Writers:

- [chat/index.ts:330](../../supabase/functions/chat/index.ts#L330), [generate-brainstorm/index.ts:255](../../supabase/functions/generate-brainstorm/index.ts#L255), [generate-itinerary/index.ts:443](../../supabase/functions/generate-itinerary/index.ts#L443)
- [generate-destination-research/index.ts:272](../../supabase/functions/generate-destination-research/index.ts#L272) and [:506](../../supabase/functions/generate-destination-research/index.ts#L506) (two rows: `:tags` extraction + main call)
- [city-deep-dive/index.ts:112](../../supabase/functions/city-deep-dive/index.ts#L112), [generate-todos/index.ts:99](../../supabase/functions/generate-todos/index.ts#L99), [estimate-expenses/index.ts:95](../../supabase/functions/estimate-expenses/index.ts#L95), [extract-preferences/index.ts:75](../../supabase/functions/extract-preferences/index.ts#L75), [generate-wishlist/index.ts:92](../../supabase/functions/generate-wishlist/index.ts#L92)
- [places-proxy/index.ts:974](../../supabase/functions/places-proxy/index.ts#L974) — Haiku geocode-repair calls, logged as `places-proxy:<tag>` (e.g. `places-proxy:verify-place:repair`)

**Streaming functions** (chat, RG, IG) wrap the usage log + credit deduction in `runInBackground()`, which registers the work with `EdgeRuntime.waitUntil` — without it, Supabase reclaims the isolate the moment the streamed response ends and silently drops the insert (this previously lost _every_ `generate-itinerary` usage log; see the comment at [credits.ts:12-32](../../supabase/functions/_shared/credits.ts#L12-L32) and usage at [chat/index.ts:324-359](../../supabase/functions/chat/index.ts#L324-L359)). Streaming token counts are captured from `message_start` / `message_delta` SSE events via `accumulateStreamUsage()`, with a `length / 4` estimate as fallback ([credits.ts:277-323](../../supabase/functions/_shared/credits.ts#L277-L323), [chat/index.ts:315-322](../../supabase/functions/chat/index.ts#L315-L322)).

---

## 5. RLS on admin data

- **`llm_usage`** ([20260511000002:15-21](../../supabase/migrations/20260511000002_create_llm_usage_and_admin.sql#L15-L21)): RLS enabled — `"Admins can read llm_usage" FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))`, plus a `"Service role full access"` policy. The latter originally had no `TO` clause (so `USING (true)` applied to all roles); `20260713000002_scope_service_role_policies.sql` rescopes it `TO service_role` and does the same for `api_usage`, `generation_log`, `credit_transactions`, `place_cache`, and `destination_research`. That migration also adds the policies clients actually rely on: admin-read on `api_usage`/`generation_log`, and member insert/update/select on `generation_log` — load-bearing because the _frontend_ writes IG timing rows with the user's JWT ([App.jsx:8511-8536](../../src/App.jsx#L8511-L8536)).
- **`credit_transactions`** ([20260513000001:21-32](../../supabase/migrations/20260513000001_create_credits_system.sql#L21-L32)): users read own rows (`user_id = auth.uid()`), admins read all (same `is_admin` EXISTS check), plus the (now service-role-scoped) full-access policy. The prod-launch migration re-adds a user-read-own policy under a different name ([20260526000005:59-64](../../supabase/migrations/20260526000005_prod_schema_for_credits_launch.sql#L59-L64)).
- **`profiles`** ([20260527000002_tighten_profiles_rls.sql](../../supabase/migrations/20260527000002_tighten_profiles_rls.sql)): the old `USING (true)` read policy was dropped; now users read only their own row **or** admins read all via the `SECURITY DEFINER` function `is_admin_user(auth.uid())` (definer avoids RLS recursion when the policy checks the admin's own flag). This is what lets Admin.jsx list all users.
- **`trips` / `trip_messages` — no admin policy found.** The migrations and the (stale) `schema.sql` dump contain only creator/member/share-token read policies for `trips` ([schema.sql:5614-5621](../../schema.sql#L5614-L5621), [:5762](../../schema.sql#L5762)) and member-only policies for `trip_messages` ([schema.sql:5586](../../schema.sql#L5586)). Yet Admin.jsx selects _all_ trips and messages ([Admin.jsx:89-100](../../src/Admin.jsx#L89-L100)). Either an admin-read policy was added directly in the live DB (untracked by migrations), or the console silently shows only trips the admin can already see. Unresolved from the code alone.

---

## 6. CLI tooling: `scripts/trip-cost.cjs`

A standalone Node script that prints actual per-function LLM cost for one trip from `llm_usage` ([scripts/trip-cost.cjs](../../scripts/trip-cost.cjs)):

```bash
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/trip-cost.cjs [tripId]
```

- Requires the **service-role key** (falls back to `VITE_SUPABASE_URL` for the URL); exits if either is missing ([trip-cost.cjs:16-24](../../scripts/trip-cost.cjs#L16-L24)).
- With no `tripId`, auto-picks the most recent trip that has usage rows ([trip-cost.cjs:66-76](../../scripts/trip-cost.cjs#L66-L76)).
- Uses the identical cost formula and cache multipliers as `_shared/credits.ts` (it also carries the `claude-haiku-4-5` alias the Admin UI lacks) and additionally converts USD to credits at the `$0.007`/credit scale ([trip-cost.cjs:27-51](../../scripts/trip-cost.cjs#L27-L51)).
- Output: an ASCII table grouped by `function_name` — calls, input/output/cacheW/cacheR tokens, `cost $`, `credits` — sorted by cost, with a total row ([trip-cost.cjs:86-138](../../scripts/trip-cost.cjs#L86-L138)).

---

## Key files

- [src/Admin.jsx](../../src/Admin.jsx) — the entire console: gating, all four tabs, cost math
- [src/main.jsx](../../src/main.jsx) — `/admin` route ([:103](../../src/main.jsx#L103)) and render ([:261-277](../../src/main.jsx#L261-L277))
- [supabase/functions/\_shared/credits.ts](../../supabase/functions/_shared/credits.ts) — canonical pricing, `deductCredits`, `runInBackground`, stream-usage capture
- [supabase/migrations/20260511000002_create_llm_usage_and_admin.sql](../../supabase/migrations/20260511000002_create_llm_usage_and_admin.sql) — `is_admin` flag + `llm_usage` table + RLS
- [supabase/migrations/20260622000001_llm_usage_cache_tokens.sql](../../supabase/migrations/20260622000001_llm_usage_cache_tokens.sql) — cache token columns
- [supabase/migrations/20260513000001_create_credits_system.sql](../../supabase/migrations/20260513000001_create_credits_system.sql) / [20260526000005](../../supabase/migrations/20260526000005_prod_schema_for_credits_launch.sql) — `credit_transactions` + RPCs
- [supabase/migrations/20260527000002_tighten_profiles_rls.sql](../../supabase/migrations/20260527000002_tighten_profiles_rls.sql) — admin-read-all on `profiles`
- [scripts/trip-cost.cjs](../../scripts/trip-cost.cjs) — per-trip cost CLI
