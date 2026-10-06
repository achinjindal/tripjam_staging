# Post-mortem: how TripJam actually uses its models

Companion to `model-migration-plan.md`. That plan asks "which model should each
call site use?" This asks a different question: **given the models we already
use, are we invoking them the way the providers intend — and what are we leaving
on the table?**

Every Anthropic claim below was verified against live docs on 2026-10-05
(`platform.claude.com` pricing, model-deprecations, models-overview,
prompt-caching). Claims about Google/OpenAI behaviour are marked as
**unverified** where I could not confirm them from a primary source; they are
hypotheses for the bench run, not conclusions.

---

## Verdict

The provider-quirk layer is now genuinely good: `_shared/llm.ts` encodes the
hard-won failure modes in one place, and the billing table is arithmetically
correct. What's missing is a whole tier of **platform features we never adopted**
— structured outputs, working prompt caching, the batch discount — plus one
quality variable the benchmark never controlled for: **knowledge cutoff**.

Three findings are worth more than the entire Phase 2 model-swap:

1. **Prompt caching is structurally impossible on every Haiku call site**, and
   one existing `cache_control` marker (IG's plan phase) has never cached
   anything. Both fail _silently_ by design.
2. **Haiku 4.5's reliable knowledge cutoff is February 2025.** It drives
   deep-dives, Inspirations, chat and booking-parse in a product whose core
   quality metric is "does this venue still exist". The incumbent's
   hallucinations in the 2026-10-03 benchmark are consistent with this, and no
   amount of prompt tuning fixes a stale world model.
3. **Two newer Anthropic models landed after the benchmark was run**, one of
   which is a strictly-free upgrade (same price, fresher knowledge, lower cache
   minimum) and another that is _cheaper than the Opus tier we priced_.

---

## 1. Prompt caching: the marker is not the feature

Anthropic's minimum cacheable prefix is **model-dependent and non-monotonic**.
Verified 2026-10-05:

| Model                                 | Min cacheable prefix |
| ------------------------------------- | -------------------- |
| Claude Haiku 4.5                      | **4,096 tokens**     |
| Claude Sonnet 5                       | 1,024 tokens         |
| Claude Sonnet 5.5 / Opus 5 / Opus 5.5 | 512 tokens           |

Below the minimum, the request is processed **without caching and no error is
returned**. The only way to detect it is `cache_creation_input_tokens` and
`cache_read_input_tokens` both coming back 0.

Measured size of every static system prompt in the stack (chars/3.7):

| Call site                                      | ~tokens | Model today | Caches?                                |
| ---------------------------------------------- | ------- | ----------- | -------------------------------------- |
| `generate-brainstorm` RG                       | 3,447   | sonnet-5    | ✅ yes                                 |
| `generate-itinerary` SYSTEM_PROMPT (day fills) | 2,992   | sonnet-5    | ✅ yes                                 |
| `generate-itinerary` **PLAN_SYSTEM**           | **564** | sonnet-5    | ❌ **no — but marked `cache_control`** |
| `generate-destination-research` (Inspirations) | 1,190   | haiku-4.5   | ❌ no (needs 4,096)                    |
| `city-deep-dive`                               | 1,033   | haiku-4.5   | ❌ no (and no marker)                  |
| `generate-todos`                               | 406     | haiku-4.5   | ❌ no                                  |
| `extract-preferences`                          | 254     | haiku-4.5   | ❌ no                                  |
| `generate-wishlist`                            | 240     | haiku-4.5   | ❌ no                                  |
| `generate-day-narratives`                      | 268     | haiku-4.5   | ❌ no                                  |
| `estimate-expenses`                            | 229     | haiku-4.5   | ❌ no                                  |

Three consequences:

**(a) IG's plan phase had a decorative cache breakpoint — now fixed.** `planBlocks` sends
`PLAN_SYSTEM` with `cache_control: {type: "ephemeral"}`, but at ~564 tokens it
is under Sonnet 5's 1,024 minimum, so it has never cached — it just pays full
input price on every IG run. Confirmable from `llm_usage`: historical
plan-phase rows show zero in both cache columns.

**Fixed by flipping RG/IG to Sonnet 5.5** (applied 2026-10-05) — same $2/$10
price, 512-token minimum, so 565 tokens is now cacheable. The static check in
`scripts/bench/verify-phase0.ts` now asserts this and will fail if a prompt edit
ever drops a _marked_ prefix back under its model's minimum.

**(b) Phase 3.2 of the migration plan cannot work as written.** It proposes
adding `cache_control` to `generate-destination-research` for "~3%". At 1,190
tokens on Haiku's 4,096 minimum, that marker would cache nothing. The 55% of
Inspirations cost that is input tokens is 75k of _fresh search results_ anyway —
the plan's own measurement — so there was never much prefix to cache. Drop 3.2;
keep 3.1 (`HAIKU_MAX_USES` 6→3), which attacks the real driver.

**(c) "Move X to Haiku to save money" silently costs you caching.** RG (3,447)
and IG (2,992) are cacheable on Sonnet and would both fall under Haiku's 4,096
minimum. Any Haiku-ward move must price in losing the 0.1x read on a ~3k prefix,
which can exceed the per-token saving.

**Economics worth stating plainly:** cache write is 1.25x input (5-min) or 2x
(1-hour); read is 0.1x. So a 5-minute entry pays for itself after **one** read,
a 1-hour entry after **two**. Max 4 breakpoints per request.

---

## 2. Knowledge cutoff is the quality variable nobody controlled for

Verified from the live model table:

| Model                                      | Reliable knowledge cutoff             |
| ------------------------------------------ | ------------------------------------- |
| Claude Haiku 4.5                           | **Feb 2025** (training data Jul 2025) |
| Claude Sonnet 5 / 5.5, Opus 5.5, Fable 5.1 | **Jun 2026**                          |

Haiku 4.5's world model is 16 months staler than Sonnet's. TripJam's dominant
failure mode is naming a venue that does not exist _or has closed_ — and Haiku
runs `city-deep-dive`, `generate-destination-research`, `chat`,
`inbound-email`, `generate-todos`, `estimate-expenses`, `generate-wishlist`,
`generate-day-narratives` and the `places-proxy` repair judgement.

This reframes the 2026-10-03 result. That benchmark concluded "venue reality was
NOT model-determined… the incumbents were the only ones that failed: haiku
invented _Veshmarkt, Tbilisi_… sonnet-5 invented _Homemade Food Jorgo_". A
16-month-fresher world model is a simpler explanation for part of that than
prompt structure, and it is one the abstention fix (Phase 4.1) does _not_
address: abstention stops a model inventing what it never knew, but it cannot
tell it that a real restaurant shut in 2025.

**Action:** treat knowledge cutoff as a first-class selection criterion for every
venue-naming call site, and score the bench arms for _closed_ venues separately
from _non-existent_ ones. The `score-trips.mjs` oracle already distinguishes
these (`closed_*` vs `not_found`) — that split is now the most interesting
column in the table.

---

## 3. Two models landed after the benchmark

The 2026-10-03 matrix evaluated 6 models. Since then:

| Model                 | Price (in/out) | Notes                                                                                                           |
| --------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| **Claude Sonnet 5.5** | **$2 / $10**   | Identical price to Sonnet 5. Jun 2026 knowledge. 512-token cache minimum (vs 1,024). Retirement floor Sep 2027. |
| **Claude Opus 5.5**   | **$4 / $20**   | _Cheaper than Opus 5_ ($5/$25). Cache reads at 0.05x instead of 0.1x. Default effort `medium`.                  |

**Sonnet 5.5 is now the default for RG and IG** (applied 2026-10-05): same cost
per token, 16-months-fresher knowledge, and it makes IG's plan-phase cache work.
Rollback is a secret flip, not a deploy — `LLM_MODEL_RG`/`LLM_MODEL_IG` (or
`LLM_MODEL_DEFAULT`) set to `claude-sonnet-5` restores the old behaviour
instantly. The bench's `prod-baseline` arm therefore now measures Sonnet 5.5
rather than carrying a separate arm for it.

**It was not a drop-in.** Sonnet 5.5 ships five breaking changes vs Sonnet 5,
and one of them would have taken RG and IG down on the first request:

> "On Claude Sonnet 5.5, a request that sends `thinking: {"type": "disabled"}`
> returns a 400 `invalid_request_error` whose message points to
> `between_tools`."

The adapter sent exactly `{type:"disabled"}` to the entire Claude 5 family, and
`claude-sonnet-5-5` prefix-matches every `startsWith("claude-sonnet-5")` test in
the codebase — so the fatal shape was selected in four places: the adapter's two
request builders, IG's `IG_ARCH=single` escape hatch, `chat`, and
`generate-destination-research`. All now derive the shape from
`traitsOf(model).thinkingBody`:

| Model                         | Thinking field                      |
| ----------------------------- | ----------------------------------- |
| sonnet-5, opus-5              | `{type:"disabled"}`                 |
| **sonnet-5-5**                | **`{type:"between_tools"}`**        |
| opus-5-5, fable-5, mythos-5   | omitted (adaptive always on)        |
| opus-4-8, opus-4-7, and older | omitted (already means no thinking) |

`between_tools` is valid at `low`/`medium`/`high` effort only, accepts no
sibling fields, and — since none of these calls use tools — returns plain text
exactly as `disabled` did. Three of Sonnet 5.5's other four breaking changes
don't touch us (forced `tool_choice`, `computer_20251124`, advisor pairings); the
fourth, thinking blocks being conversation-bound, doesn't either because we never
replay thinking blocks.

**Writing the regression test for that found a second latent 400.** The adapter
used one `isV5` flag for both "reject temperature" and "disable thinking", but
those rules have different boundaries: sampling parameters are rejected on
**Opus 4.7 and later**, which includes Opus 4.8 — a model the old regex treated
as pre-Claude-5 and therefore temperature-safe. IG and `generate-wishlist` both
pass `temperature: 0.8`, so an `LLM_MODEL_DEFAULT=claude-opus-4-8` arm would
have 400'd on every call. The two rules are now separate traits with explicit
per-model assertions.

**Pre-emptive billing fix:** neither `claude-sonnet-5-5` nor `claude-opus-5-5`
is in `RATES`. Per the project's own rule, pointing any function at them today
would hit the fable-5 fallback and over-bill **5x on input / 2.5x on output**.
Add both before anyone touches an env var. Also note `computeLLMCost` applies a
flat `CACHE_READ_MULTIPLIER = 0.1`, which is wrong for Opus 5.5 (0.05x) and
Fable 5.1 (0.025x) — over-billing, so not urgent, but it is drift waiting to
happen.

---

## 4. Haiku 4.5 has the nearest retirement floor in the lineup

| Model                         | Retirement — "not sooner than" |
| ----------------------------- | ------------------------------ |
| **claude-haiku-4-5-20251001** | **October 15, 2026**           |
| claude-opus-4-5               | November 24, 2026              |
| claude-sonnet-4-6             | February 17, 2027              |
| claude-sonnet-5               | June 30, 2027                  |
| claude-sonnet-5-5             | September 28, 2027             |

Haiku 4.5 is still **Active**, not deprecated, and Anthropic commits to ≥60
days' notice before retiring a public model — so nothing breaks on Oct 15. But
it is the only model we depend on whose floor is inside the next 12 months, every
other model in the lineup is 2027+, and it currently powers eight call sites
with no identified replacement. The migration plan should carry "pick Haiku's
successor" as a named item rather than discovering it on a deprecation email.

---

## 5. Structured outputs make most of our JSON code obsolete

Anthropic supports constrained decoding — `output_config: {format: {type:
"json_schema", schema}}` — on Sonnet 5, Haiku 4.5, Opus 4.8/5/5.5 and Fable 5.
We use none of it. Instead, across the codebase we hand-roll:

- `stripFences()` in `generate-itinerary`
- `parseLLMJson()` / fence-safe slicing in `_shared/llm.ts`
- `text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)` in `generate-todos`
  and `estimate-expenses`
- `jsonMatch = text.replace(/^```(?:json)?/i, "")…match(/\{[\s\S]*\}/)` in
  `generate-wishlist`
- a **two-step truncation repair** in `App.jsx` (trailing-comma strip, then a
  char-by-char bracket-state walk that backs out of unterminated strings)
- a plan-parse retry in IG that exists _because_ "one malformed plan response
  500'd the whole generation and the user paid again on re-run. Observed live."
- `expectArray` plumbing in the adapter, which exists solely because OpenAI's
  `json_object` mode cannot emit a top-level array

Constrained decoding removes the _class_ of bug all of that defends against. The
prompts can also shed their "Return ONLY a raw JSON object, no markdown, no
fences" preambles, which is free input tokens on every call.

Caveats worth knowing before adopting: schemas must set
`additionalProperties: false`, recursive schemas and numeric/length constraints
are unsupported (the Python/TS SDKs strip those and validate client-side — we're
on raw fetch, so we'd validate ourselves), the first request with a new schema
pays a one-time compile latency and is then cached 24h, and it is incompatible
with citations. `strict: true` on tool definitions is the equivalent for tool
parameters.

This is the single largest _reliability_ win available, and unlike the model
swap it reduces code rather than adding configuration. It is also the honest fix
for `gemini-3.5-flash-lite`'s format unreliability (1/4 IG parse failures) —
though note the equivalent feature on Google/OpenAI needs its own verification.

---

## 6. The cache-prime was the right instinct with the wrong primitive

IG's cache-priming call is a good idea with a documented basis: a cache entry
becomes readable only once the first response **begins streaming**, so N
simultaneous day-fills would all miss and all pay the 1.25x write premium. The
fan-out needed a warm cache first.

Three corrections, all now applied:

1. **`max_tokens: 0` is the documented pre-warm form**, not `max_tokens: 1`.
   It runs prefill, writes the cache, and returns immediately with no content
   and **zero output tokens billed** — no one-token reply to discard. (Rejected
   with `stream: true`, thinking _enabled_, `output_config.format`, or forced
   `tool_choice`; this call uses none of those.)
2. **The prime was being billed twice.** After Phase 0 routed it through
   `callLLM`, `max_tokens: 1` always reported truncation, so the adapter's
   retry-at-1.5x fired on _every_ IG run, re-issuing the prime at a 100-token
   cap. Now `retryOnTruncation: false`.
3. **It was pure waste on two of three providers.** Only Anthropic honours
   `cache_control`; Gemini and OpenAI cache automatically, server-side. The
   prime is now gated on `traitsOf(model).supportsPromptCache`, so an
   OpenAI/Gemini arm no longer pays a billed call plus ~1s of critical-path
   latency for nothing.

A documented alternative to priming, if the prime ever proves unreliable: fire
one day-fill, await its first streamed token, then fan out the rest.

---

## 7. The Batch API discount is unused — and partly usable

Batch is **50% off both input and output**: Haiku 4.5 at $0.50/$2.50, Sonnet 5
at $1/$5. It stacks with prompt caching. Up to 100k requests; most complete
within an hour, 24h ceiling.

Most of TripJam is user-blocking, so this is not a blanket win. What is genuinely
batchable:

- **Magazine pre-generation for popular destinations.** `city-deep-dive` is
  currently lazy — destination + top 2 cities on route load, rest on Magazine
  open. Pre-generating the long tail for frequently-requested cities at 50% off,
  into `magazine_digest`, converts a user-blocking paid call into a cache hit
  that costs $0. This compounds with the plan's Phase 3.3 (raise the DB cache
  hit rate), which is already identified as the highest-leverage Inspirations
  item.
- **Inspirations for common (destination, tag, month) buckets** — same argument,
  and this is the 38.9%-of-spend line item.
- **Any backfill or re-scoring job**, including re-running this bench.

Not batchable: RG, IG, chat, `extract-preferences`, verify-repair — all sit in
front of a waiting user.

---

## 8. Provider-side levers we are not pulling (unverified — test in the bench)

I could not confirm these from a primary source in this session. Each is a
code-grounded observation plus a hypothesis:

- **No reasoning-effort control is sent to OpenAI.** `callOpenAI` sends
  `model`, `max_completion_tokens`, optional `response_format`, and messages —
  nothing that bounds reasoning. If `gpt-6-luna` exposes an effort/reasoning
  parameter, that would plausibly explain _both_ of its measured problems at
  once (2–5x verbosity, 70s on RG) and our mitigations — `suggestCap`, the
  retry-at-1.5x — are treating the symptom. This is the highest-value thing to
  check before the IG flip: it could turn the 36s-vs-16s IG latency regression
  (plan §1.3) into a non-issue.
- **Our 0.1x cache-read multiplier is an Anthropic rate applied to all three
  providers.** `computeLLMCost` has one `CACHE_READ_MULTIPLIER`, and the adapter
  faithfully populates `cache_read_input_tokens` from OpenAI's
  `prompt_tokens_details.cached_tokens` and Gemini's
  `cachedContentTokenCount`. If either provider's cached-input discount is less
  generous than 0.1x, we under-bill cached input on those models — the direction
  the code comments correctly identify as the dangerous one ("over-charging is
  visible and refundable; the reverse is not"). Verify each provider's published
  cached-input rate before any non-Anthropic flip, and add a per-provider
  multiplier if they differ.
- **Gemini/OpenAI structured-output equivalents.** Gemini has
  `responseSchema` alongside the `responseMimeType` we already set; OpenAI has
  JSON-schema structured outputs beyond the `json_object` mode we use. Either
  would be a better answer to flash-lite's format failures than a retry wrapper.

---

## 9. What we are doing right (don't regress these)

Worth recording, because several are non-obvious and were learned expensively:

- **Billing on real usage, not estimates**, with a length/4 fallback only when
  usage events never arrive.
- **Billing both attempts of a retry.** The truncation retry and the IG plan
  retry both add the failed attempt's tokens. Easy to get wrong, invisible when
  wrong.
- **Usage normalised to disjoint buckets**, including folding Gemini's
  `thoughtsTokenCount` and subtracting OpenAI's cached tokens out of
  `prompt_tokens` — that subtraction is a genuine double-billing fix.
- **`runInBackground` / `waitUntil` around post-stream billing.** The comment
  records that fire-and-forget work after a long stream was being killed by
  isolate teardown, dropping _every_ IG usage log and deduction.
- **Billing before stream niceties** in RG's `finally`, because a client
  disconnect used to make `writer.write` reject and skip the deduction
  entirely.
- **The unknown-model alarm.** Loud failure on a missing `RATES` entry is the
  right call, and the fallback direction (most-expensive) is the right default.
- **Abstention-permitting prompts.** The deep-dive's "return FEWER sights you
  are completely certain about rather than padding to 8" is the single most
  effective anti-hallucination device in the codebase, and the plan's §4.1 is
  right to generalise it to IG's meal slots.

---

## 10. What changed in the code as a result

Applied in this pass (all local, `npm run check` green):

- IG cache-prime: `max_tokens: 1` → `0`, retry disabled, gated on
  `supportsPromptCache`.
- IG: deleted the Gemini single-shot branch that bypassed the parallel
  architecture, dropped `thoughtsTokenCount`, and **skipped `deductCredits`
  entirely** — every Gemini IG was free to the user and invisible to billing.
- RG: deleted the equivalent Gemini fork (same unbilled path), routed through
  `streamLLM`, kept provider errors surfacing as a clean HTTP 500 by pulling the
  first stream event before returning the `Response`.
- `city-deep-dive`, `extract-preferences`, `generate-todos`,
  `estimate-expenses`, `generate-day-narratives`, `generate-wishlist`,
  `places-proxy` repair: routed through the adapter with `modelFor()` +
  `suggestCap()`, cache-token columns now logged, `expectArray` set on the two
  array-returning prompts.
- `LLM_MODEL_DEFAULT` added to `modelFor()` so one secret moves a whole arm;
  `generate-destination-research` deliberately **not** wired, because its
  `web_search` server tool is Anthropic-only.

Recommended next, in value order:

1. Add `claude-sonnet-5-5` and `claude-opus-5-5` to all four rate tables.
2. ~~Carry a sonnet-5.5 arm~~ — done differently: Sonnet 5.5 is now the RG/IG
   default, so `prod-baseline` measures it. Validate in the bench run; roll back
   with a secret flip if quality disappoints.
3. Verify the OpenAI reasoning-effort parameter before deciding IG.
4. Verify per-provider cached-input rates; split `CACHE_READ_MULTIPLIER` if they
   differ.
5. Adopt structured outputs on the array-returning prompts first (todos,
   expenses, RG) — smallest schemas, clearest win, deletes the most parsing.
6. Drop plan §3.2 (Inspirations caching); it cannot work on Haiku.
7. Name a Haiku 4.5 successor.
