# Model migration execution plan

Addresses every concern raised by the 2026-10-03 per-use-case model benchmark
(see `memory/project_model_selection_matrix.md`). Target: **−61% LLM spend**
($20.50 → ~$8.00 on the lifetime-prod basis) with no quality regression.

**Status:** **Phase 0 COMPLETE** (2026-10-05) — rate table fixed + alarmed,
`_shared/llm.ts` built and integration-tested against all three providers,
model-aware caps wired. Phases 1–5 not started.

---

## Why there is a Phase 0 at all

Two findings make an immediate model flip unsafe. Neither is about model
quality — both are plumbing:

1. **A flip today would over-bill every user by ~100×.** `_shared/credits.ts`
   `RATES` has no entry for `gpt-6-luna`, and the unknown-model fallback is
   deliberately `RATES["claude-fable-5"]` ($10/$50) so a swap can never
   _under_-charge. A single IG day-fill (3,545 in / 2,770 out) really costs
   **$0.00174** but would be billed as **$0.1739** → ~24.9 credits instead of
   0.25. A 100-credit user would be drained in four day-fills.
2. **Most functions physically cannot call the recommended models.** Only
   `generate-itinerary` has all three providers. `generate-brainstorm` and
   `chat` have Anthropic + Gemini. `city-deep-dive`, `places-proxy` (repair),
   `generate-todos`, `estimate-expenses`, `inbound-email`,
   `generate-destination-research`, `generate-wishlist`,
   `generate-day-narratives` are **Anthropic-only**.

So Phase 0 is a hard gate. Nothing else may ship before it.

---

## Phase 0 — Blockers (gate for everything below)

### 0.1 Fix the rate table (prevents the 100× over-bill)

Add the benchmarked models and keep the four copies in sync — they drift, and
drift here is a billing bug.

| File                                    | What                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `supabase/functions/_shared/credits.ts` | `RATES` += `gpt-6-luna` {0.10, 0.50}, `gemini-3.5-flash-lite` {0.30, 2.50} |
| `src/Admin.jsx`                         | same rates in the cost-estimate table                                      |
| `scripts/trip-cost.cjs`                 | same rates                                                                 |
| `CLAUDE.md`                             | document rates + the Jan-2027 Gemini change                                |

Also add an **unknown-model alarm**. Today the fallback is silent, which is how
a 100× over-bill could reach production unnoticed:

```ts
if (!RATES[model]) {
  console.error(`BILLING: unknown model "${model}" — billing at fable-5 rate`);
  captureException(new Error(`unknown_model_rate:${model}`), { model });
}
```

- **Risk:** low. **Rollback:** revert.
- **Acceptance:** unit-check `computeLLMCost("gpt-6-luna", 3545, 2770)` ≈
  $0.00174; a bogus model id emits the alarm.

### 0.2 Build `_shared/llm.ts` — one provider adapter

Single entry point so a model swap is a string change, not an integration.
Encodes every gotcha the benchmark surfaced (each one cost a failed test round):

```ts
export async function callLLM(opts: {
  model: string; // routes on prefix: claude-* | gemini-* | gpt-*
  system: string | Block[]; // Block[] preserves Anthropic cache_control
  user: string;
  maxTokens: number;
  json?: boolean; // see rule 2 — ignored for array-returning prompts
  expectArray?: boolean;
}): Promise<{
  text: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  truncated: boolean;
}>;
```

Rules it must enforce:

1. **Claude 5 family** → send `thinking: {type:"disabled"}`, never
   `temperature`. (Thinking on by default silently eats `max_tokens`.)
2. **OpenAI `response_format: json_object` cannot emit a top-level array.** If
   `expectArray`, do NOT set json mode. RG, `generate-todos` and
   `estimate-expenses` all return arrays — forcing it yields a single object.
   gpt-6-luna returned a literal `{"error":"I must return a raw JSON array…"}`.
3. **Gemini** → try `thinkingConfig:{thinkingBudget:0}`; on HTTP 400 retry
   without it (`gemini-3.5-flash-lite` and `*-latest` reject it, older 3.x
   needs it or output truncates).
4. **Usage normalization** → Gemini `thoughtsTokenCount` and OpenAI reasoning
   tokens are billed as **output**; fold them in or cost tracking under-reports.
5. **Fence-safe array-aware parse** → models wrap JSON in ```json fences
despite instructions. Slice from the first `{`/`[` to the last `}`/`]`.
6. **Truncation detection** → set `truncated` when `output >= maxTokens`.

Then refactor `generate-itinerary`'s existing `callOtherProvider()` to use it,
deleting the duplicate.

- **Risk:** medium — touches the one function already in production with
  multi-provider code. **Rollback:** adapter is additive; `IG_FILL_MODEL`
  unset restores today's path.
- **Acceptance:** `npm run typecheck:functions` green; a golden-output test per
  provider; `generate-itinerary` behaviour byte-identical with env unset.

### 0.3 max_tokens headroom audit (silent-truncation guard)

**gpt-6-luna is 2–5× more verbose than Haiku** — reasoning tokens are billed as
output. It silently truncated at current production caps; 4 of 12
verify-repair cases failed until the cap was raised, and all four were the
_hard judgment_ cases. Flipping without this looks like random failures.

| Call site                  | Cap now | Needed      | Evidence                   |
| -------------------------- | ------- | ----------- | -------------------------- |
| `places-proxy` repair      | 300     | **900**     | 4/12 hit 300; clean at 900 |
| `city-deep-dive`           | 2048    | **2600**    | gpt-6-luna used 1623–2048  |
| `generate-itinerary` fill  | 4500    | **6000**    | used up to 4043            |
| `generate-brainstorm` (RG) | 9000    | **9000 ok** | Gemini uses ~2270          |
| `generate-todos`           | —       | +50%        | used 938 vs haiku 809      |

Add a **retry-once-on-truncation** path in `callLLM`: if `truncated`, re-issue
at 1.5× cap and increment a `truncation_retry` counter. Prevents a cap
mis-estimate from becoming user-visible breakage.

- **Acceptance:** truncation counter visible in Admin; zero truncations across
  a 20-call staging soak per migrated function.

---

## Phase 1 — Validation (gates the risky flips only)

### 1.1 Re-validate IG on 4 more destinations — **honest gap in the benchmark**

The IG fixture **pre-named the hotels in the skeleton** ("Hotel Mangalemi",
"Hotel Kalemi 2"), so the fill model never had to invent one. That is exactly
the failure mode Sonnet 5 showed in the earlier full-itinerary A/B (addressless
template hotels, "Hotel Boutique H"). Current IG numbers therefore
under-sample the hardest case, and denominators were small (2–11 businesses).

Run with hotels **omitted** from the skeleton, forcing the model to choose:

- Long-tail: **Tbilisi + Kazbegi, Georgia**; **Oaxaca, Mexico**
- Dense: **Lisbon, Portugal**
- Hard/remote: **Luang Prabang, Laos**

Arms: `gpt-6-luna`, `gemini-3.8-flash`, `sonnet-5` (control). 3 days ×
4 destinations × 3 models = 36 fills. Score with the existing Google oracle
(`score_ig3.mjs`) **plus hand adjudication** — the oracle false-positives on
translations and needs a human pass.

- **Cost:** ~$1.50. **Gate:** flip IG only if gpt-6-luna's _business-venue_
  reality ≥ sonnet-5's across all four.

### 1.2 Validate `chat` — currently **unvalidated**

Not benchmarked: its system prompt is assembled from heavily interpolated
template literals (screen-conditional action vocabularies), it streams, and it
must emit a valid `actions[]` array that the client applies to real trip data.
A format regression here silently corrupts trips.

1. Extract the prompt builder into a testable function.
2. Fixture suite of ~15 turns covering each action type
   (`update_route`, bulk dismiss with `routeIds[]`, add/remove activity).
3. Assert: valid JSON, action types in the allowed set, required fields
   present, `stops` nights sum to `days.length − 1`, day strings carry `**bold**`
   and no `Day N:` prefix.
4. Staging canary via `CHAT_MODEL=gpt-6-luna`, watch `trippy_action_apply`
   telemetry for 48h.

- **Gate:** 15/15 fixtures pass **and** canary action-apply rate ≥ Haiku's.

### 1.3 Decide the latency budget — **a real product regression**

Benchmark latencies (through a non-streaming proxy, so directional only):

|                  | RG        | IG fill | deep-dive |
| ---------------- | --------- | ------- | --------- |
| gpt-6-luna       | **70.3s** | 35.9s   | 17.0s     |
| gpt-5.6-luna     | 45.9s     | 21.3s   | 12.6s     |
| sonnet-5 (now)   | 34.1s     | 15.9s   | 16.3s     |
| gemini-3.8-flash | **11.3s** | 4.7s    | 5.3s      |
| haiku (now)      | 29.7s     | 10.5s   | 14.5s     |

Implications already baked into the recommendations:

- **RG stays on Gemini.** 70s with the user watching is unacceptable; this is
  why RG does not get the cheapest model despite 12.8× being on the table.
- **IG fill at 36s vs 16s is a ~2× regression** on the main flow. Mitigated by
  the per-day parallel fan-out (total ≈ slowest day, not sum) and the
  compact-phase-first render, but it must be measured for real.

**Action:** instrument streamed end-to-end time to first day and to last day on
staging for both arms. **Gate:** time-to-first-day must not regress >20%.

---

## Phase 2 — Staged rollout, cheapest risk first

Every step: env-var flip → staging → 48h watch → prod. **Rollback is always
"unset the env var."** Where no env var exists, add one — do not hardcode.

| #   | Use case                         | Target             | New env                  | Factor | Gated on           |
| --- | -------------------------------- | ------------------ | ------------------------ | ------ | ------------------ |
| 2.1 | prefs / todos / expenses / email | `gpt-6-luna`       | `EXTRACT_MODEL`          | 8.5×   | Phase 0            |
| 2.2 | verify-place repair              | `gpt-6-luna`       | `REPAIR_MODEL`           | 4.1×   | Phase 0 (cap 900)  |
| 2.3 | city-deep-dive                   | `gpt-6-luna`       | `DEEPDIVE_MODEL`         | 8.7×   | Phase 0 (cap 2600) |
| 2.4 | RG                               | `gemini-3.8-flash` | `RG_MODEL` (exists)      | 4.4×   | Phase 0            |
| 2.5 | IG fill                          | `gpt-6-luna`       | `IG_FILL_MODEL` (exists) | 14×    | **1.1 + 1.3**      |
| 2.6 | chat                             | `gpt-6-luna`       | `CHAT_MODEL` (exists)    | ~8×    | **1.2**            |

Ordered by blast radius, not by saving. 2.1 is invisible if it breaks; 2.5
touches the core product.

**Per-step watch list:** `llm_usage` cost/call moves the predicted direction;
PostHog exception rate flat; truncation-retry counter at 0; function-specific
counters (`tier4-google-*` for repair, parse failures for the rest).

**Why `gemini-3.5-flash-lite` is recommended nowhere** despite being cheap and
fastest: it was the least format-reliable arm — 1/4 IG runs failed to parse,
1/3 RG runs returned the wrong shape. Revisit only behind a retry wrapper.

---

## Phase 3 — Inspirations: 38.9% of spend, **no model lever exists**

The single biggest line item, and swapping models would have been wasted work.
Measured decomposition of $0.137/call:

| Component                                    | $/call  | Share |
| -------------------------------------------- | ------- | ----- |
| Input tokens (75,419 **fresh**, zero cached) | $0.0754 | 55%   |
| Web search fees (5.03 × $0.01)               | $0.0503 | 36%   |
| Output (2,218)                               | $0.0111 | 8%    |

Haiku is already Anthropic's cheapest model and `web_search` is an
Anthropic-side server tool, so there is no cheaper in-provider option and a
cross-provider move means re-engineering onto Gemini grounding / OpenAI web
search, whose per-search economics may be worse. **Attack the drivers instead:**

### 3.1 `HAIKU_MAX_USES` 6 → 3 (biggest single lever)

Cuts search fees _and_ the injected result tokens — i.e. both dominant terms at
once. Expected ≈ **−37%** (~$3.10 of lifetime spend). A/B 10 destinations and
diff entry count + URL validity; the prompt already permits fewer entries
("Better empty than fake"), so quality should hold.
File: `generate-destination-research/index.ts:524`.

### 3.2 Add prompt caching

`cache_control` is absent from this function entirely (measured
`cache_read_tokens = 0` across all 61 calls). Caching the static
`SYSTEM_PROMPT` prefix is modest (~3%) since the 75k is mostly dynamic search
results — worth doing, not worth celebrating.

### 3.3 Raise the DB cache hit rate

Results are already cached per `(destinations, tags, monthBucket)`. Instrument
the hit rate; if low, widen buckets (coarser tag sets, quarter instead of
month). A hit costs $0. Highest-leverage item here if the rate is poor.

### 3.4 Escalation audit

`:escalation` ran 2 calls at **$0.47 and $0.33** (119,939 input tokens, 7
searches). `SONNET_MAX_USES` was already cut 8→4; verify that landed and that
the escalation trigger is tight.

---

## Phase 4 — Root-cause fix: stop paying for a workaround

The benchmark's deepest finding: **venue reality was not model-determined.**
Nearly every model scored 100% on deep-dive sights and RG towns. The
difference is the _prompt_. Deep-dive permits abstention ("return FEWER sights
you are completely certain about rather than padding to 8"); IG's meal slots
**mandate** a name for every slot. A model forced to answer confabulates.

IG's quality premium is therefore self-inflicted, and these two changes attack
the cause rather than buying a bigger model:

### 4.1 Permit abstention in IG

Mirror the deep-dive rule: allow a meal slot to carry a _type_ of place
("a seafood taverna on the harbour front") instead of a fabricated proper noun
when the model is not confident. Requires a client change so an un-named meal
renders gracefully and does not enter the verify ladder.

### 4.2 Wire verify-place into flag-or-replace

Already scoped. The ladder checks every venue but only fixes the geocode —
using its now-reliable `conclusive: true` negative to flag or replace a venue
would cut hallucination **with any model**, and would finally consume the
signal that currently goes nowhere.

---

## Phase 5 — Billing truth + cleanup

### 5.1 Stop charging users for free Google calls (**open from 2026-10-03**)

`places-proxy` bills `GOOGLE_PLACES_CALL_USD = 0.017` per verify — **1,154
credits / $11.54 charged to date** — while Google's actual bill is **$0**: the
field mask puts us on Text Search **Pro**, whose free tier is 5,000 calls/month
against our ~675 **lifetime**. The 0.017 figure is stale legacy Find Place
pricing; current overage starts near $2.83/1,000. Fix: zero the pass-through,
or charge only once monthly volume crosses the free tier. (Fixes 2 and 3 from
that review shipped; this one was never approved.)

### 5.2 Delete the benchmark rig — **DONE 2026-10-06 (except model-bench)**

The three probes and six A/B forks are deleted from both projects, and their
source directories are gone. `anthropic-probe` turned out to be worse than this
section assumed: it was deployed with `verify_jwt: false`, so it answered with
**no auth header at all**, taking `model`, `max_tokens` and the thinking budget
straight from the query string — roughly $3/request on our key at Fable 5
rates. `gemini-probe` was live on **production**, not just staging.

Deleted (both envs as applicable):

```
anthropic-probe  openai-probe  gemini-probe          (gemini-probe was on prod)
generate-itinerary-{gemini,openai,haiku,sonnet5,parallel,lean}
generate-brainstorm-haiku
```

`generate-itinerary-openai` and `-gemini` were credit-gated but never called
`deductCredits`, i.e. unlimited free generation for any signed-in user.

The root cause is closed too: `npm run deploy:functions:*` now names 18
functions explicitly instead of running a bare `supabase functions deploy`,
which deploys every directory and is how a probe reached production.

**Still open:** `model-bench` remains on staging — secret-gated and failing
closed, and currently driving the Inspirations cost work. It is deliberately
NOT in the deploy allowlist, so npm cannot ship it. Delete it, and unset
`BENCH_SECRET`, when the benchmarking is finished:

```bash
supabase functions delete model-bench --project-ref wlrzvwjdrjpfqcwgmzch
supabase secrets unset BENCH_SECRET   --project-ref wlrzvwjdrjpfqcwgmzch
```

### 5.3 Revisit `CREDIT_LLM_BUDGET_USD`

At 14× cheaper IG, the designed 30% margin becomes enormous. Either bank it or
pass some through as more generous credits — a pricing decision, not a
technical one.

### 5.4 Set a Gemini price-change reminder

`gemini-3.8-flash` **doubles to $1.50/$7.50 on 2027-01-01**. RG is the only
recommendation resting on it, and its advantage shrinks 4.4× → 2.2×. Re-run the
RG arm in December 2026 against whatever gpt-6-class latency looks like then.

---

## Sequencing

```
Phase 0 (blockers) ──┬── 2.1 extractors ── 2.2 repair ── 2.3 deep-dive ── 2.4 RG
                     │
                     ├── 1.1 IG validation ───────────────────────────── 2.5 IG fill
                     ├── 1.2 chat validation ────────────────────────── 2.6 chat
                     └── 1.3 latency budget ───────────────────────────┘

Phase 3 (Inspirations) — independent of Phase 0, can run in parallel
Phase 4 (prompt root-cause) — after 2.5
Phase 5.1 (billing) — independent, ship anytime
Phase 5.2 (cleanup) — after 1.1
```

Phase 3 needs no model work and holds the largest single saving (~$3.10), so it
is the best first move if only one thing can be done.

## Effort / value

| Phase               | Effort          | Lifetime saving                   | Risk    |
| ------------------- | --------------- | --------------------------------- | ------- |
| 0 — blockers        | 1–1.5 d         | enabler (prevents 100× over-bill) | med     |
| 1 — validation      | 0.5 d + ~$2 API | gates $4.85                       | low     |
| 2 — rollout         | 1 d             | ~$9.75                            | low→med |
| 3 — Inspirations    | 0.5 d           | ~$3.10                            | low     |
| 4 — root cause      | 1–2 d           | quality + unlocks cheaper IG      | med     |
| 5 — billing/cleanup | 0.5 d           | removes $11.54 user over-charge   | low     |

## Decisions needed

1. **Approve Phase 0?** Nothing can ship without it.
2. **Phase 3 first, or the Phase 0→2 chain first?** Phase 3 is the biggest
   single saving and carries no model risk.
3. **Phase 5.1 billing fix** — zero the Google pass-through, or gate it on the
   free-tier threshold?
4. **Keep `model-bench` through Phase 1.1**, or delete now and rebuild later?
5. **IG latency**: is a ~2× generation-time regression acceptable for 14×
   cheaper, given compact-phase-first rendering? Or hold IG on Gemini instead?
