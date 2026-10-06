# E2E model bench — 14 real trips, 7 arms (2026-10-05)

Every arm drove **every** LLM step of a real trip through the production
endpoints on staging, as `qa-tester`. Trips are live and openable in the app.
Harness: `scripts/bench/{arms,run-trips,score-trips}.mjs`.

Fixtures: **Thailand, 7 days, entered at country level** (RG must invent the
route) and **Tbilisi + Kazbegi, 4 days** (long-tail, two-city, mountain leg).
Hotels omitted from the skeleton in both, so fill models had to choose their own.

---

## Results

| arm                        | 2-trip cost |  vs base |        days | venues |    real |  +alias | **SUBST** |  hotels | major |
| -------------------------- | ----------: | -------: | ----------: | -----: | ------: | ------: | --------: | ------: | ----: |
| gpt-6-luna                 |     $0.0089 |        — | **1/11** ⛔ |     32 |     75% |     84% |        6% |     1/1 |     4 |
| **recommended-mix**        | **$0.0628** | **7.9×** |       11/11 |    140 |     54% |     79% |       15% | **4/4** |    22 |
| gemini-3.5-flash-lite      |     $0.0687 |     7.3× |       11/11 |    112 |     53% |     80% |       19% |     1/3 |     3 |
| **gpt-5.6-luna**           |     $0.0688 |     7.3× |       11/11 |    135 | **70%** | **85%** |   **10%** |     3/4 |     6 |
| **gemini-3.8-flash**       |     $0.1355 |     3.7× |       11/11 |    135 |     59% |     80% |       18% | **4/4** | **0** |
| haiku-4.5                  |     $0.2499 |     2.0× |       11/11 |    146 | **27%** | **55%** |   **36%** |     2/5 |    31 |
| prod-baseline (sonnet-5.5) |     $0.4988 |     1.0× |       11/11 |    154 |     50% |     73% |       18% |     3/4 |    23 |

Latency, 7-day Thailand trip:

| arm                   |    RG | 1st card |            IG | plan done | routes (want 4) |
| --------------------- | ----: | -------: | ------------: | --------: | --------------: |
| gemini-3.5-flash-lite |  7.3s | **4.0s** |     **15.4s** |      7.4s |             4 ✓ |
| gemini-3.8-flash      |  8.6s |     4.2s |         17.6s |     10.4s |             4 ✓ |
| prod-baseline         | 16.9s |     5.8s |         38.5s |     20.8s |             4 ✓ |
| haiku-4.5             | 18.5s |        — |         32.7s |         — |             4 ✓ |
| gpt-5.6-luna          | 36.9s |    23.0s |         73.1s |     34.6s |       **21** ⛔ |
| recommended-mix       | 10.4s |     6.5s |         79.6s |  **8.4s** |             4 ✓ |
| gpt-6-luna            | 44.8s |    30.2s | **151.7s** ⛔ |    116.1s |       **22** ⛔ |

---

## What the numbers mean — and what they don't

**SUBST = "unresolvable as written"**, not "hallucinated". The oracle asks
Google Places for the venue and compares the _returned_ name to the name the
model wrote. A low match means one of three things, and hand-checking shows all
three occur:

- genuinely invented (`Hotel Stepantsminda` → `PRIME HOTEL KAZBEGI`)
- too vague to navigate to — which the IG prompt explicitly forbids
  (`Lunch at Ananuri Roadside Café`, `Fresh fruit smoothie at floating stall`)
- a real place under another label — **scorer false positives**
  (`Wat Pho (Temple of the Reclining Buddha)` → `Wat Phra Chetuphon…`;
  `Chateau Mukhrani` → `შატო მუხრანი`)

So absolute rates are inflated for every arm. The **relative ranking is sound**:
one instrument, identical treatment, 900+ venues.

**Why this metric exists at all.** The 2026-10-03 matrix used the same rig
_without_ the name comparison and concluded "venue reality was NOT the
differentiator — nearly every model scored 100%". That oracle marks
`"Totally Invented Restaurant Xyzzy"` as real, because Google always returns a
best match. Verified 2026-10-05. Any conclusion resting on that 100% — including
the plan's §4 claim that IG's quality premium is self-inflicted — needs
re-deriving.

---

## Findings

### 1. Haiku 4.5 is dominated on every axis — replace it

36% unresolvable (double the field), 27% exact, **2/5 hotels**, 31 major
structural violations — while costing **2× more than gpt-5.6-luna, which scores
10%**. On the Tbilisi trip it managed 9/51 venues exact (18%).

This is the empirical confirmation of the knowledge-cutoff finding: Haiku 4.5's
reliable knowledge ends **Feb 2025**; every other model here is Jun 2026. It
currently runs `city-deep-dive`, `generate-destination-research`, `chat`,
`inbound-email`, `generate-todos`, `estimate-expenses`, `generate-wishlist`,
`generate-day-narratives` and the `places-proxy` repair judgement.

It is also the only model in the lineup whose retirement floor is inside 12
months (not sooner than 2026-10-15; everything else is 2027+).

**This is the highest-value change available, and it is not the one the plan
prioritised.**

### 2. The incumbent is not the quality leader

Sonnet 5.5 costs 7.3× more than gpt-5.6-luna and is _worse_ on venue reality
(18% vs 10% unresolvable, 50% vs 70% exact) and structure (23 vs 6 major).
Whatever the itinerary premium is buying, this bench does not detect it.

### 3. gpt-6-luna fails IG twice over: too slow to plan, too sloppy to fill

**Measured plan-phase duration** (time to first byte; IG awaits the plan before
the HTTP response starts, so no byte can precede it):

| arm             | plan model        |  plan done |           fills |    days |
| --------------- | ----------------- | ---------: | --------------: | ------: |
| gpt-6-luna solo | gpt-6-luna        | **116.1s** | 35.6s left, cut | **1/7** |
| recommended-mix | gemini-3.8-flash  |   **8.4s** |           71.2s |     7/7 |
| prod-baseline   | claude-sonnet-5-5 |  **20.8s** |           17.6s |     7/7 |

gpt-6-luna spent **77% of the ~150s edge budget on the ~1,200-token structural
plan**, leaving ~35s for seven fills. One completed (at 143.9s); the stream was
cut at 151.7s mid-array and the client's truncation repair salvaged that single
day. Same fills behind a Gemini plan: all seven, comfortably.

**This is a LATENCY finding, not a quality one.** The solo run never produced a
usable itinerary, so gpt-6-luna's plan _quality_ is unmeasured here.

**Its fills are not good either.** The bench contains a near-controlled
comparison — identical Gemini plan model, different fill model:

| arm              | plan             | fill             | major violations |
| ---------------- | ---------------- | ---------------- | ---------------: |
| gemini-3.8-flash | gemini-3.8-flash | gemini-3.8-flash |            **0** |
| recommended-mix  | gemini-3.8-flash | **gpt-6-luna**   |           **22** |

Both violation types are fill-phase defects: **12 `vague-title`** (meal and
activity names that are not navigable places — explicitly forbidden) and **10
`duplicate-geocode`** ("Each activity MUST have a DIFFERENT geocode"). Gemini
commits zero of either. So the honest claim is only that gpt-6-luna's fills
_complete within the time budget_ behind a fast plan — completion is not
quality.

**Side effect worth fixing independently:** that trip has **zero
`generate-itinerary` rows in `llm_usage` and no credit deduction** — the
post-stream logging and `deductCredits` live in the `finally` of the
`runInBackground` pump, and a hard wall-clock kill reclaims the isolate before
it runs. `runInBackground`/`waitUntil` protects against client disconnects, not
against the platform timeout. The provider still billed us for 151s of
generation. Note this also means the "$0.0070" cost recorded for that arm
EXCLUDES its IG entirely.

Thailand: IG hit **151.7s** (the ~150s edge wall clock) and returned **1 of 7
days**. Tbilisi: RG returned **0 parseable routes**, so no trip was built.

But the **recommended-mix arm, whose fills are also gpt-6-luna, completed 7/7
days with first-day at 8.4s** — because Gemini runs the ~1,200-token IG _plan_.
Solo, gpt-6-luna's first day arrived at 116s. The `IG_PLAN_MODEL`/`IG_FILL_MODEL`
split already in the code is what makes the cheap fill model viable.

The 2026-10-03 matrix benchmarked day-fills **in isolation** and projected 14×.
End to end at real trip length it doesn't finish. Shipping Phase 2.5 on that
evidence would have silently truncated 7-day itineraries in production.

### 4. Both OpenAI models ignore an explicit prompt instruction

Both RG user-message variants end with "Do NOT generate tier 2 experiences —
only routes". gpt-6-luna returned **22** items, gpt-5.6-luna **21**. Gemini and
Sonnet return exactly 4. A user would see 21 cards instead of 4.

### 5. gpt-6-luna's RG failure is format, not capability

It produced 6,820 chars / 3,738 output tokens (cap 14,400) and emitted at least
one well-formed object — but not the required top-level array. Our own adapter
causes this: OpenAI's `json_object` mode cannot emit a top-level array, so
`expectArray` turns JSON mode **off**, leaving the shape to prompt compliance.
Thailand complied; Tbilisi didn't. 1 in 2.

This is exactly what **structured outputs** (`output_config.format` +
`json_schema`) fix — constrained decoding instead of asking nicely. Note
`gemini-3.5-flash-lite`, which the old matrix ruled out as "least format
reliable (1/4 IG parse fails)", produced clean output on **both** trips here —
plausibly because the adapter now sets `responseMimeType: application/json`.

### 6. gemini-3.8-flash: zero major structural violations, both trips

The only arm to manage it, against the baseline's 23 and Haiku's 31. Also 4/4
hotels, 3.7× cheaper, ~2× faster. Caveat: its price **doubles 2027-01-01**
($0.75/$3.75 → $1.50/$7.50), cutting the advantage to ~1.9×.

---

## Recommendation

1. **Replace Haiku 4.5 now.** It is worse _and_ more expensive than the
   alternatives. Candidate: `gemini-3.8-flash` (0 structural violations, 4/4
   hotels) or `gpt-5.6-luna` (best venue reality) for the non-latency-critical
   extractors. This supersedes plan steps 2.1–2.3.
2. **RG → `gemini-3.8-flash`.** 4 routes, 4.2s to first card, 0 structural
   violations. (Plan already said this; the data agrees.)
3. **Do not ship gpt-6-luna for IG at all, in either role.** As the plan model
   it consumes 77% of the wall clock; as the fill model it adds 22 major
   structural violations that Gemini does not make, and the mix's Tbilisi IG
   still took 142.8s against a ~150s wall. The 7.9× saving on the mix arm buys
   measurably worse itineraries than the 3.7× saving on plain Gemini.
4. **Test an untried arm: RG + IG-plan on Gemini, IG-fill on `gpt-5.6-luna`.**
   Best venue reality (10%) with Gemini absorbing the latency-critical phases.
   The arms conflate RG and IG models, so this combination was never measured.
5. **Adopt structured outputs** before any further OpenAI migration. Finding 5
   is a silent empty-result failure that constrained decoding removes outright.
6. **Re-derive plan §4.** Its premise came from the uncorrected oracle.

---

## The 14 trips

`npm run dev`, sign in as `qa-tester` / `qaTest123!`, then open any path below.
Trip names carry the arm id as a suffix.

| arm                   | trip            |  days | path                                         |
| --------------------- | --------------- | ----: | -------------------------------------------- |
| prod-baseline         | thailand        |     7 | `/trip/c8553711-6f20-4b7c-9ef7-f8664bd1870a` |
| prod-baseline         | tbilisi-kazbegi |     4 | `/trip/3d45086d-2c6c-457c-9516-f1de038f46b3` |
| gemini-3.8-flash      | thailand        |     7 | `/trip/28e1d4f1-384b-4b13-a5d1-1dc191344630` |
| gemini-3.8-flash      | tbilisi-kazbegi |     4 | `/trip/562c14c4-d232-4097-be7e-031bb5dc87a9` |
| gemini-3.5-flash-lite | thailand        |     7 | `/trip/12bb9709-b035-4a9e-a842-80d0e6f035dd` |
| gemini-3.5-flash-lite | tbilisi-kazbegi |     4 | `/trip/c4e0596f-1448-479e-96fd-29909e500209` |
| gpt-5.6-luna          | thailand        |     7 | `/trip/5e0bccac-9995-4579-bea4-129a880e1e0b` |
| gpt-5.6-luna          | tbilisi-kazbegi |     4 | `/trip/133d36c4-6069-487d-bac8-8dfa34d3c967` |
| recommended-mix       | thailand        |     7 | `/trip/b388415e-d5c7-4248-a1ab-18185a39b3a9` |
| recommended-mix       | tbilisi-kazbegi |     4 | `/trip/8a808b28-4d27-4b52-a849-5fa573c01d93` |
| haiku-4.5             | thailand        |     7 | `/trip/71fbf4d4-8099-4f11-a3a0-f315745d50f3` |
| haiku-4.5             | tbilisi-kazbegi |     4 | `/trip/5899183f-9dcc-47c3-8d84-8b56afbd5cfc` |
| gpt-6-luna            | thailand        | **1** | `/trip/091931ff-ed5c-4031-b534-ddfa2cd0a33f` |
| gpt-6-luna            | tbilisi-kazbegi | **0** | `/trip/16d40e7d-d8bf-41cc-9fc8-4fda736843e5` |

Best side-by-side: open `prod-baseline/thailand` against
`gemini-3.8-flash/thailand` — same destination, same dates, 3.7× cost
difference.

---

## Caveats

- **`places-proxy` was excluded from the deploy** (it carries unrelated
  uncommitted WIP), so verify-repair ran on the deployed Haiku build identically
  in every arm. Repair quality is not part of these measurements.
- **n = 2 trips per arm.** Directionally strong for the large gaps (Haiku,
  gpt-6-luna); not enough to separate arms within a few points.
- **SUBST false-positive rate is unquantified.** A proper hand-adjudication pass
  over the ~140 flagged venues would tighten every absolute number.
- The structural `VAGUE_TITLE` check is too narrow — it catches
  `Lunch near X` but not `Lunch at <invented café>`, so some prompt violations
  surfaced as substitutions instead.
