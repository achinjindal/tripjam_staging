# Chat model benchmark (2026-10-08)

Trippy chat on the v3 itinerary contract (`protocol: 2`). Run against the staging chat function with `LLM_MODEL_CHAT` switched per model and restored to Haiku afterwards. Each model answered 14 fixtures, 2 runs each, on the QA Thailand trip (6 days, 46 activities).

**Fixtures:**

- 12 edits: remove, move across days, move within a day, replace ×2, insert, insert after, "make Day 5 more relaxed", shift a day by an hour, remove repeats, a two-part edit, and the vague "Day 1 feels rushed".
- 2 questions.

Each answer was graded by a deterministic check on the resolved `activity_ops` (the right op on the right activity, no other days touched). Failures were then read by hand. Script: `cb7.mjs` in the session scratchpad.

|                                        | Haiku 4.5 (current) | gpt-6-luna             | Sonnet 5.5                 |
| -------------------------------------- | ------------------- | ---------------------- | -------------------------- |
| Automated pass                         | 24/28               | 26/28                  | 25/28                      |
| Real misses after reading the failures | 4                   | 2                      | 3                          |
| Median time to first word              | **1.1 s**           | 4.7 s                  | 2.1 s                      |
| Median time to a finished reply        | **2.8 s**           | 5.4 s                  | 3.2 s                      |
| Slowest reply                          | 5.7 s               | **38.7 s**             | 7.8 s                      |
| Broken replies                         | 0                   | 0                      | 1 (`parse_failed_actions`) |
| Output tokens per reply                | 194                 | 507 (hidden reasoning) | 285                        |
| Cost per reply                         | ~$0.0043 (0.62 cr)  | ~$0.0003 (0.04 cr)     | ~$0.0077 (1.1 cr)          |

## Misses, read by hand

**Haiku 4.5**

- **"Day 1 feels rushed":** offered options instead of editing, in every run. Acceptable behaviour.
- **"Add a cooking class on Day 4":** replaced the museum once.
- **Replacing Day 3's Night Bazaar:** picked **Huen Phen** in every run, a restaurant already on Days 4 and 6.
- **Replacing a Bangkok dinner:** once picked SP Chicken, a Chiang Mai restaurant.
- A grader false negative: "Vertigo at Banyan Tree" is a rooftop bar.

**gpt-6-luna**

- **"Add a cooking class":** asked a question instead, in both runs. Those replies took 27 s and 39 s, with 2,000–3,400 hidden reasoning tokens and no streamed words.
- **First words:** only arrive after the reasoning, so a typical reply feels about 2× slower.

**Sonnet 5.5**

- **"Add a cooking class":** replaced the museum in both runs.
- **The two-part edit:** one reply with broken JSON, which counts as an unusable reply.
- **Replacing the Night Bazaar:** picked Huen Phen once.

## Decision

**Stay on Haiku 4.5.**

- **Luna:** chat cost is negligible either way, and luna's latency, worst case and habit of asking instead of acting are worse for an interactive edit.
- **Sonnet 5.5:** no measurable quality gain at 1.8× the cost, plus a broken reply.

**Haiku's repeated-place habit:**

- **The prompt rule** ("a new place must not already be anywhere in TRIP CONTEXT") did not change it: Huen Phen was still chosen in 3 of 3 runs.
- **So `resolveOps` drops these:** an insert or replace naming a place still in the trip is skipped (`already_in_trip`), and the bubble names it. After this change, no duplicate reached the itinerary.

**Separate finding: the empty-reply bug.** One question in about 40 came back as an "empty reply" error even though the model returned 234 tokens. The parser now accepts:

- prose containing a brace;
- a message under `reply`, `response` or `answer`.

12 repeats of that question then came back clean. About a third of question answers arrive as plain prose rather than JSON, so they don't stream: the words appear only when the reply completes.
