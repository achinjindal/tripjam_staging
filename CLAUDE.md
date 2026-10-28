# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this?

TripJam is an AI-powered travel planning and collaboration app. Solo founder project.

## Tech Stack

- **Frontend:** React 18 (JSX) + Vite 8, single-page app, no router library (History API for URL routing)
- **Backend:** Supabase (Postgres, Auth, Edge Functions, RLS, Realtime)
- **AI:** Multi-provider (Anthropic / Google / OpenAI) via the shared adapter `supabase/functions/_shared/llm.ts`. **Model defaults live in code, not here.** `grep -rn 'modelFor(' supabase/functions` is the only authoritative answer — env secrets can override per environment, and any list written here rots (this paragraph has been wrong twice). Broad strokes: Gemini on RG and IG, gpt-6-luna on Magazine deep-dives (8x cheaper AND more accurate than Haiku — `bench-results-2026-10-05.md`), Haiku 4.5 on everything else, plus **Sonnet 5.5** for the Inspirations escalation (`INSPIRATIONS_ESCALATION_MODEL`, Anthropic-only because that path needs the `web_search` server tool). The IG **plan** and **fills** are separately selectable and are NOT on the same model — the plan is awaited before the stream opens, so it is tuned for latency.
  - **Always call LLMs through `_shared/llm.ts`** (`callLLM` / `streamLLM`). It routes by model-id prefix and encodes every provider quirk in one place; a model swap becomes a string change rather than an integration. Never hand-roll a provider fetch in a function.
  - **Per-function model selection:** `modelFor("<KEY>", default)` reads `LLM_MODEL_<KEY>` → legacy names (`IG_MODEL`, `RG_MODEL`, `CHAT_MODEL`, …) → **`LLM_MODEL_DEFAULT`** → the hardcoded default. Each function can sit on a different model independently. `LLM_MODEL_DEFAULT` is the blunt lever: it moves every unset call site at once, so it is a rollback/bench tool, not a config. `generate-destination-research` deliberately bypasses `modelFor` so a global default can never route its Anthropic-only `web_search` path to another provider.
  - **Provider quirks the adapter handles** (all discovered the hard way — do not re-litigate): the `thinking` off-switch DIFFERS per Claude-5 model — Sonnet 5/Opus 5 want `{type:"disabled"}`, **Sonnet 5.5 hard-400s on that and needs `{type:"between_tools"}`**, Opus 5.5/Fable omit it entirely; never branch on a `startsWith` prefix, read `traitsOf(model).thinkingBody`. Claude 5 and Opus 4.7/4.8 also reject `temperature`; Gemini 3.x needs `thinkingConfig:{thinkingBudget:0}` or thought tokens eat `maxOutputTokens`, **but** Gemini ≥3.5 flash-lite and `*-latest` reject that flag with a 400 (adapter retries without it); OpenAI's `response_format:{type:"json_object"}` **cannot emit a top-level JSON array**, so array-returning prompts (RG, todos, expenses) must pass `expectArray: true`; Gemini `thoughtsTokenCount` and OpenAI reasoning tokens are billed as **output**; OpenAI `prompt_tokens` **includes** cached tokens so they must be subtracted or cached input is billed twice.
  - **Verbose models truncate at caps tuned for terse ones.** Use `suggestCap(model, baseline)` instead of a literal `max_tokens`; `callLLM` also retries once at 1.5x on truncation and bills both attempts.
- **Maps:** Leaflet + react-leaflet, Photon/Nominatim geocoding (with trip destination enrichment)
- **Photos:** Wikipedia/Wikimedia Commons (free, 3 concurrent / 250ms stagger, global cool-down on upstream 429s)
- **Places:** Google Places API (autocomplete, hotel search with lodging type)
- **Analytics:** PostHog (tagged with `app_env` for staging/production filtering)
- **Error tracking:** PostHog error tracking (web `capture_exceptions` + edge `_shared/errortrack.ts`, gated on `POSTHOG_KEY` secret; alerts file GitHub issues)
- **Mobile:** Capacitor (Android APK), vite-plugin-pwa (auto-update, 5-min check interval)
- **Payments:** Lemon Squeezy (web MoR; credits via `create-checkout` + `payment-webhook` edge functions) + RevenueCat (Android Google Play Billing via `@revenuecat/purchases-capacitor`)
- **Testing:** Playwright E2E (sequential, workers: 1)
- **Hosting:** Vercel (frontend auto-deploy), Supabase (backend/DB/functions)

## Project Structure

`ls` shows the layout; these are the parts it does not tell you.

- **`src/App.jsx` is ~20,000 lines** — the entire trip view (state, data fetching,
  every panel/tab/modal). Sub-components exist (`BoardView`, `SetupForm`,
  `Magazine`, `MapView`) but most state still lives in App.
- **Module-level stores, not React context:** `credits.js` and `dialogs.jsx` both
  expose a store read via `useSyncExternalStore` hooks. Match that pattern rather
  than adding a provider.
- **`theme.js` also exports `PLACES_PROXY` and `PLACES_HEADERS`** — not where you
  would look for them.
- **Ships-dark modules:** `realtime.js` (behind `VITE_REALTIME_ENABLED`),
  `members.js` (exports `INVITE_ENABLED`). Both are built but flag-gated off.
- **`chat/_ops.ts`** holds the v3 itinerary edit ops and ref resolution — the
  chat endpoint itself is `chat/index.ts`.
- **`scripts/trip-cost.cjs` needs `SUPABASE_SERVICE_ROLE_KEY`**; with an anon key
  it returns nothing at all rather than erroring.
- **`docs/user-journeys/`** is the per-journey documentation (`00-overview.md` is
  the index), with `file:line` references into the code.
- **`e2e/criteria/`** holds per-journey acceptance criteria, numbered to match the
  test areas.

### Repo root gotchas

- `ad-hoc/` and `inspiration/` are untracked full copies of the repo (scratch workspaces with their own `src/`, `supabase/`, etc.). When searching or editing, work only in the root `src/` and `supabase/` — a grep hit inside these copies is not the real code.
- `pitch/` — untracked pitch-deck assets (Python deck builder + screenshots), not app code.
- Root-level `*-design.html` are design mockups, not app code — some tracked, some gitignored. Don't edit them as production code either way.
- `RUNBOOKS.md` — operational runbooks (RevenueCat/Play Billing setup, Supabase secrets, ops SQL snippets).

## Commands

Run `npm run` to list every script (`dev`, `build`, `check`, `test:e2e`,
`deploy:functions:*`, `db:push:*`, …). Only the non-obvious ones are noted here:

- **`npm run check`** = format:check + lint + typecheck + **`test:functions`** + build.
  `test:functions` is a Deno unit suite that also runs a few pure `src/*.test.js` files.
  Its file list is **explicit in `package.json`**: a new `*.test.*` file is not run until
  you add it there. Run `check` before review; if formatting fails, `npm run format` and rerun.
- **CI is NOT the gate.** `.github/workflows/checks.yml` runs only lint, typecheck and
  build — it does **not** run `format:check` or `test:functions`. Green CI does not mean
  the unit tests pass or the formatting is clean; only `npm run check` locally does.
- **`npm run test:e2e`** runs sequentially (`workers: 1`) — the API-dependent
  specs cannot run in parallel. Single spec / single test:
  `npx playwright test e2e/board.spec.ts` / `npx playwright test -g "<title>"`.
  Single Deno unit file:
  `deno test --allow-env --config supabase/functions/deno.json supabase/functions/chat/_ops.test.ts`.
- **`deploy:functions:*` ships your LOCAL working tree, not `origin/main`.**
  Deploying from a branch that is behind silently reverts whatever another
  session deployed, with a successful CLI response and a bumped version number.
  `git fetch origin` and confirm you are up to date before deploying.
  `model-bench` is deliberately left out of these scripts: it is a staging-only bench
  harness (an LLM proxy gated on `BENCH_SECRET`) and must never be deployed to prod.
- **`db:push:*` relinks the CLI and then pushes every unrecorded migration.** Some
  migrations have been applied by hand and are missing from `schema_migrations`, so a
  push would re-run them. Run `supabase migration list` against the target first.

```bash
# These three must bypass JWT verification. supabase/config.toml now declares
# verify_jwt = false for each, so ANY deploy keeps it — including the bulk
# deploy:functions:* scripts, which do not pass the flag.
#
# MEASURED 2026-10-28, because it is easy to assume otherwise: deploying one
# of these WITHOUT --no-verify-jwt does NOT re-enable JWT. Staging
# payment-webhook went v115 -> v116 (so the deploy really happened) with
# verify_jwt still false, and prod's three sat at false after two bulk
# deploys. The CLI omits the field rather than sending the default, and the
# server preserves it. That behaviour is UNDOCUMENTED, which is why the
# config.toml exists — not to fix a live bug, but so a CLI change cannot
# silently turn these into 401s (failed payments, dropped booking emails).
#
# Still use the explicit flag when deploying one of them on its own:
supabase functions deploy payment-webhook    --no-verify-jwt --project-ref <ref>
supabase functions deploy revenuecat-webhook --no-verify-jwt --project-ref <ref>
supabase functions deploy inbound-email      --no-verify-jwt --project-ref <ref>
```

## Internal Nomenclature

- **RG** — Route Generation. Pre-IG step where 4 route options are generated.
- **IG** — Itinerary Generation. Full day-by-day plan from the selected route. An **awaited PLAN skeleton** (route, anchors, hotels — `LLM_MODEL_IG_PLAN`) then **parallel per-day fills** (`LLM_MODEL_IG_FILL`, ~85% of the tokens). The plan is awaited BEFORE the stream opens, so its latency is dead air for the client — measured 5–25s. `IG_ARCH=single` is a legacy Anthropic-only escape hatch. **Before flipping `LLM_MODEL_IG_FILL`:** an A/B on 2026-10-02 showed Haiku fills cut cost 72% but hallucinated hotels and restaurants badly — the code comment in `generate-itinerary` points here for this reason.
- **Magazine** — Destination guide tab (highlights, deep dives, food, tips). Pre-loads the first 2 **destinations** (first comma-segment — `Bali`, NOT `Indonesia`; using the country was a real bug that warmed the wrong card) + the first 2 route cities when RG returns. Once an itinerary exists a background 2.5s stagger primes every remaining city; `onVisible` covers anything still cold. Deep-dive content persisted in `trips.magazine_digest`.
- **Inspirations** — Sub-tab of Magazine. Web-search-backed articles/vlogs from named individual creators. Cached per (destinations, tags, monthBucket) in `trips.inspirations_digest`.
- **Board** — Tab with Notes, To-dos, Bookmarks, Expenses, Travel & Hotels widgets.
- **Pre-IG sheet** — Bottom sheet shown after route selection, before IG (budget, pace, morning preference, transport).
- **Transit tips** — Per-day actionable public transport advice (e.g. "Use Suica card · Day pass ¥600").

## Architecture Notes

### Frontend

- `main.jsx` does all URL routing via `parseUrl()` — pages: `home` (Landing), `signin`, `signup`, `trip`, `edit`, `create`, `public` (`/share/:token`), `join` (`/join/:token` invite links), `admin`, `privacy`, `terms`, `forgot-password`, `reset-password`. No router library.
- The URL `/trip/:id/magazine` maps to the internal tab key `brainstorm` (legacy name). This translation happens in `parseUrl()` — the public URL and the internal state key deliberately differ.
- Design system in `theme.js`: `T` (colors + semantic states), `TYPE` (6-level typography), `RADIUS` (4 values), `SHADOW` (3 levels), `MOTION` (3 speeds). Import from there, never hardcode values.
- Auth is email + password (username auto-derived from the email local part) plus Google OAuth. Legacy accounts created in the username-only era sign in via the fake-email shim `username@tripjam.app`.
- Trip ID generated client-side (`crypto.randomUUID()`) to avoid RLS issues.
- **A bare `supabase.from().insert()/.update()` silently no-ops.** The builder is a
  lazy thenable: un-awaited (or without `.then()`), it never issues a request and
  never errors. This silently lost chat persistence, IG timing, and route
  dismissals in production. Always await, and check the result.
- **Client version gate:** builds carry `VITE_APP_BUILD` (stamped in `vite.config.js`); `src/UpdateGate.jsx` blocks clients older than `app_config.min_client_build` (fails open). The Android APK runs its bundled build until a Play update, so a server contract it uses can only be retired via the gate or `app_config.chat_protocol1_retired` — see RUNBOOKS.md "Client version gate".

### Collaboration (LIVE in production)

- Full spec in `docs/collaboration/`. Phases 0–3, 5, 6 and pooled credits (2.5) are merged, E2E-covered and live. Treat collab code paths as production code, not scaffolding.
- **Feature flags live in `src/flags.js`** (plus `INVITE_ENABLED` in `members.js`). They default OFF in code, but `.env.production` sets `VITE_INVITE_ENABLED`, `VITE_REALTIME_ENABLED`, `VITE_ROUTES_LENS_ENABLED` and `VITE_PLACE_PEEK_ENABLED` to **true** — the code default is a rollback lever, NOT the current state. Check `.env.production` before assuming anything is dark.
- **`E2E_CHEAP`** (set only by the Playwright webServer) suppresses the Magazine stagger pre-load, Inspirations auto-fire, Story narrative backfill, and caps the verify-place ladder at the free tiers. E2E runs therefore do NOT exercise the same pre-load paths as dev or prod — don't debug a "missing" pre-load from an E2E run.
- **DB:** migrations `20260721000001`–`0008` (plus later phase migrations: feed, polls, prefs-realtime, co-edit, board realtime) — `trip_members`, `trip_invites`, `activity_log`, `is_trip_member()` RLS helper, realtime publication, and SECURITY DEFINER RPCs (`accept_invite`, `create_or_get_invite_link`, `revoke_invite_link`, `get_invite_preview`, `transfer_ownership`, `remove_member`, `leave_trip`).
- **Activity log:** every mutating action calls `logActivity` (`activity.js`) — fire-and-forget, never blocks the mutation; failures are swallowed. Logs on solo trips too.
- **Invite flow:** MembersSheet creates/shares a `/join/:token` link → JoinTrip previews via `get_invite_preview` (safe pre-membership) → accept via `accept_invite`. Signed-out users get the token stashed in localStorage and resume after auth.
- The `/join/:token` route renders regardless of the invite flag; only the invite-creation UI is flag-gated.

### Credits System (launched)

- `CREDITS_UI_ENABLED = true` — credits UI and paywall are live. Backend deduction runs regardless of this flag.
- **`resolveAndGate` is the mandatory pre-flight gate**, not `requireMinCredits`. It decides whether the personal wallet or the trip pool pays and returns a `source` that must be threaded into `deductCredits`. A new gated function that skips it charges the wrong wallet on shared trips.
- **402 has TWO shapes:** `insufficient_credits` (personal) and `empty_trip_pool` (shared trip, pool dry). `handleGatedResponse` returns `true` for the first and the **string** `"empty_trip_pool"` for the second — it leaves the personal wallet alone and does not open the paywall; the caller opens the fork paywall. **Never compare `=== true`.**
- `deductCredits` charges `ceil((llm_cost_usd / 0.007) * 100) / 100` credits. New users get 100 on signup (DB default).
- **Deliberate unbilled LLM paths:** `extract-preferences` and `inbound-email` log `llm_usage` but charge nothing. Don't "fix" them — `extract-preferences` is also load-bearing for the 6-hourly `health-monitor.yml` probe, which spends a real Haiku call per run and emails on failure.
- **`LLM_KILL_SWITCH=true`** on edge secrets makes every LLM endpoint return 503 within ~a minute (next cold start). This is the incident lever; every LLM function must call `llmKillSwitch()` as its first guard or it cannot be stopped.
- **Web payments:** Lemon Squeezy (MoR). `create-checkout` creates a checkout session; `payment-webhook` (deployed with `--no-verify-jwt`, uses HMAC verification instead) grants credits on `order_created`.
- **Android payments:** RevenueCat via Google Play Billing. `billing.js` detects platform and calls RC SDK. On purchase: immediately calls `revenuecat-verify` for instant credit grant; `revenuecat-webhook` (also `--no-verify-jwt`) is the idempotent fallback. Both use `"rc_<transactionId>"` as `provider_session_id`.
- **Coupons:** `redeem-coupon` edge function. Single-use per user enforced via `provider_session_id` UNIQUE constraint. Current codes in the function source.

### AI / Edge Functions

- Unified chat uses action-based responses: LLM returns `actions[]` array with support for bulk dismiss (routeIds array).
  - **Reply contract:** SSE `delta` events, then exactly one of `final` (`{message, actions}`) or `error` (`{error, message}`), then `[DONE]`. `error` is sent when the reply is unusable (empty, `max_tokens`, or broken JSON that carried actions); it is not charged and the client shows it as an unsaved error bubble. Non-streaming callers get a 502 for the same cases.
  - **Applying:** `dispatchActions` returns per-action `{type, ok, reason}`; the bubble's "View updated" and wording come from what applied, not what the model claimed. `update_day` is insert-then-delete-by-id with rollback, and kept activities (matched by title) keep their saved place/booking data — the model only sees `time title`.
  - Messages sent while Trippy is replying queue (max 3, de-duped) via `sendChatDirect`; never write a send path that drops them.
  - **Chat v3 itinerary edits (`protocol: 2`):** the web client sends `protocol: 2`; the itinerary context lists each activity with a short ref (`D3.2`) and the model returns small ops (`replace_activity`, `insert_activity`, `remove_activity`, `move_activity`, `set_time`). `chat/_ops.ts` `resolveOps` validates them, maps refs to ids, rewrites remove+insert of the same place into a move, and folds them into ONE `activity_ops` action, which the client applies via the `apply_activity_ops` RPC (migration `20261007000001`, SECURITY INVOKER, all-or-nothing, returns `before` for undo and `after` for render). Clients without `protocol` (old PWAs, the Android APK until a Play update) keep the v2 `update_day` contract until `app_config.chat_protocol1_retired` is set (RUNBOOKS.md).
  - **Chat model: Haiku 4.5, re-benchmarked 2026-10-08** (`bench-results-chat-2026-10-08.md`). It was compared with gpt-6-luna and Sonnet 5.5 on 14 graded edit and question fixtures. Haiku is fastest, with a median of 2.8 s to a finished edit. Luna's hidden reasoning made it 2× slower (27–39 s worst case), and it asked instead of acting. Sonnet 5.5 cost 1.8× as much with no quality gain. Haiku's known weakness is reusing a place already in the trip, so `resolveOps` drops those (`already_in_trip`).
  - **Proactive fixes** (`src/tripFixes.js`): deterministic checks on the built itinerary (booked-leg, arrival and departure clashes, repeated restaurants, overlaps, long rides), shown in chat as one-tap requests to Trippy. Board Travel writes 12:00/19:00 as placeholder flight times, so never treat those as real.
  - **No output schema on chat.** Measured 2026-10-07 on Haiku 4.5: the itinerary action union is refused ("compiled grammar is too large") and the brainstorm schema adds ~1.5–2 s to first token cached, ~13 s on a cold compile (24 h cache, and chat traffic is well under a call a day). Don't re-add one without re-measuring.
  - The client sends a slim context (`slimChatContext` in App.jsx: trip logistics, route summaries, per-activity id/position/time/title/type/duration/confirmed, gem titles) — ~12 KB instead of the 47–94 KB of full rows. If the chat function starts reading another field, add it there too.
  - Chat calls the model through `streamLLM` (`modelFor("CHAT", …)` → `LLM_MODEL_CHAT` → legacy `CHAT_MODEL`), with multi-turn history via `CallOpts.messages`.
- Route labels (P1, P2...) computed at render time from display index, never stored.
- All functions log token usage to `llm_usage` table (fire-and-forget).
- `generate-destination-research` has three search backends, chosen by env secrets, and each falls back to the next: `INSPIRATIONS_SEARCH=brave` means we run Brave queries ourselves and the model makes one pass over the snippets (skipped for `quick` runs); `INSPIRATIONS_GROUNDED_MODEL=gemini-*` uses Google Search grounding; the default is Haiku 4.5 + Anthropic `web_search` (`INSPIRATIONS_MAX_SEARCHES`, default 3; 2 more on the Sonnet escalation). Results are cached in the DB with cache key = (destinations, tags, monthBucket).

### Maps & Photos

- Geocoding enriched with trip destination context (e.g. "Kuta" → "Kuta, Bali") to avoid wrong-continent results.
- Photos: 4-tier Wikipedia lookup. **`isNonPlacePhoto()` in `photos.js` is shared by the itinerary grid AND the Magazine hero** — add new reject patterns there, not to one surface. The hero used to carry its own private blocklist, so a filter added for the grid silently never reached it and a Wikipedia promo-reel frame rendered as a destination hero. The hero keeps a small extra list on top (it rejects panoramas the grid allows).
- TransitionRow: haversine walk/drive pill + optional transit icon linking to Google Maps transit. **No LLM time estimates** — never add one.

### Data / State

- Edit Details: changing destinations or duration FORCES a regenerate (an itinerary cannot survive them); other changes let the user choose. Replacing an itinerary shows a parameter diff first — overwriting is destructive and unrecoverable.

## Billing & cost rates

(The admin console itself is described in the `testing` skill.)

- **Cost rates live in ONE place: `supabase/functions/_shared/llm-rates.json`.** `_shared/credits.ts`, `Admin.jsx`, `scripts/trip-cost.cjs` and `scripts/bench/lib.mjs` all read it — add a new model there and every consumer picks it up. Scheduled price changes use `from`/`then` (Gemini 3.8 Flash's promotional $0.75/$3.75 doubles on 2027-01-01). Do not copy rate numbers into any other file, this one included: the duplicate is what drifts.
- Billing gotchas the rate file can't express:
  - **Cache-read exceptions `computeLLMCost` does NOT yet model:** Opus 5.5 reads at 0.05x and Fable 5.1 at 0.025x, not the standard 0.1x. Over-bills (safe direction) — fix before routing anything to either.
  - **Minimum cacheable prefix is model-dependent and fails SILENTLY:** Haiku 4.5 needs 4,096 tokens, Sonnet 5 needs 1,024, Sonnet 5.5/Opus 5/Opus 5.5 need 512. Below it, `cache_control` is ignored with no error — verify via `cache_creation_input_tokens`/`cache_read_input_tokens` both being 0. No Haiku call site in this codebase clears 4,096, so caching is impossible there as written.
- **A model missing from the rate table is a billing incident, not a shrug.** The unknown-model fallback bills at Fable 5 ($10/$50) so a swap can never under-charge — which means a missing entry over-bills by up to ~100x (an IG day-fill costing $0.0017 would bill $0.17 ≈ 25 credits). `computeLLMCost` logs `BILLING ALARM` and files a PostHog exception when it hits the fallback. Add every new model to `llm-rates.json` before pointing any function at it.
- **Non-LLM API pass-through (`deductExternalApiCredits`) charges only real upstream cost.** Google Places' `GOOGLE_PLACES_CALL_USD` was zeroed on 2026-10-05 after users were charged ~1,154 credits for calls that sat inside Google's free tier. Brave is billed only for queries beyond its monthly free allowance (`BRAVE_FREE_MONTHLY` / `BRAVE_SEARCH_CALL_USD`), counted by the atomic `incr_api_usage` RPC in `api_usage`. Places-proxy's own read-then-PATCH counter loses increments under concurrency, so never price off it. If the counter is unreachable, charge nothing.
- Per-trip cost questions: the `trip_task_cost` view (calls, credits charged and our USD per trip and task) reads off the indexes added in migration `20261028000009`.

## Testing

See the `testing` skill (`.claude/skills/testing/`) — test user, flag-gated
specs, the serial trip fixture, the review gate, and the ISP DNS-pin workaround.

## Environments

Two Supabase projects — local dev and staging share one, production is isolated.

|                  | Staging/Local                            | Production                              |
| ---------------- | ---------------------------------------- | --------------------------------------- |
| **Supabase ref** | `wlrzvwjdrjpfqcwgmzch`                   | `viyvdqwwnbbqjuwiuzbh`                  |
| **Used by**      | `npm run dev`, E2E tests, Vercel preview | `npm run build`, Vercel production, APK |
| **Env file**     | `.env`                                   | `.env.production`                       |

## Deployment

**Standard prod push order:** DB migrations first → edge functions → frontend (git push, Vercel auto-deploys).

- Vercel auto-deploys on push. Preview deploys use staging Supabase, production deploys use production Supabase.
- **Do not push to any remote without explicit user approval.** Every remote auto-deploys.
- **Do not make code changes without user approval.** Discuss first, implement after approval. Exception: clear bug fixes can be applied directly.
- GitHub Actions: `checks.yml` runs **lint + typecheck + build only** on pushes/PRs to main — NOT `format:check`, NOT `test:functions`, so green CI does not mean `npm run check` passes; `build-android.yml` builds the APK against production (GitHub Secrets); `health-monitor.yml` probes every 6h (Supabase pause, Anthropic balance, payment keys) and spends a real Haiku call through `extract-preferences` — don't break that function's unbilled path or the probe goes dark.
- Always deploy edge functions separately to each environment, and **`git fetch origin` first** — the deploy ships your local tree, so deploying from a stale branch silently reverts whatever another session deployed.
- After any file extraction/split, verify no duplicate `const T =` definitions and no escaped unicode (`\\u` sequences).

## Supabase Edge Functions

- **Pin `https://esm.sh/@supabase/supabase-js@2.117.2` in EVERY edge function.** A
  floating `@2` once resolved to a build whose transitive auth-js 404s on esm.sh,
  and because every function imports it (directly or via `_shared/credits.ts`),
  **all deploys failed at once** with an error naming a module our code never
  references. Bump deliberately, never by omission.

- `inbound-email`, `payment-webhook` and `revenuecat-webhook` are deployed `--no-verify-jwt` (see Commands) — each verifies its own caller instead: Svix signature + SPF/DKIM for inbound mail, HMAC for the payment webhooks. `inbound-email` secrets: `RESEND_INBOUND_WEBHOOK_SECRET`, `RESEND_INBOUND_API_KEY`, `INBOUND_EMAIL_ADDRESS`. **Pairing rule:** the frontend's `VITE_EMAIL_INGEST_ADDRESS` (`.env` / `.env.production` / Vercel) and the Supabase secret `INBOUND_EMAIL_ADDRESS` must hold the SAME address — the frontend renders `local+<tripid8>@domain` copy-to-clipboard addresses and `send-email` prints it in footers; if they drift, users forward to a dead address.
