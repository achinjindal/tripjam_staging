# 18 · Routes Lens — acceptance criteria

Feature: Route Overview block (Itinerary tab opener) + Route Editor sheet +
rebuild funnel. Flag: `VITE_ROUTES_LENS_ENABLED` (ships dark; staging on).
Spec: `routes-lens-design.html` Rev 6 · plan: `routes-lens-impl-plan.md`.

Fixtures: three seeded 5-day/4-night "Ziro Valley" trips (stored `data.stops`,
legacy bold-prefix days, underivable prose days), each with 5 day rows ×
3 activities. Zero LLM spend: `extract-preferences`, `generate-itinerary`,
and `generate-brainstorm` are network-blocked in every test.

| #    | Criterion                                                                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 18.1 | Overview renders from stored `data.stops`: title, P-label, total nights, segment bar with D-ranges derived from actual day rows (D1–2 · 2N / D3 · 1N / D4–5 · 1N)                                                                                              |
| 18.2 | Derivation ladder: a legacy route with `**bold**` day prefixes and no stops renders the overview (`source: derived`)                                                                                                                                           |
| 18.3 | A route that can't be derived (prose days, no stops) renders NO overview — itinerary unchanged                                                                                                                                                                 |
| 18.4 | Tapping a segment scrolls the day list to that stop's first day                                                                                                                                                                                                |
| 18.5 | Nights ledger gates Apply with reasons: balanced ✓ + disabled ("Rebuild itinerary") when pristine; "Balance nights to rebuild (N over)" when over; enables ("Rebuild itinerary from this route") when dirty AND balanced; 1-night floor disables the − stepper |
| 18.6 | Tap-to-move reorders stops; add-stop accepts free text (NEW row, ledger goes over); removal stops at the 1-stop floor (✕ hidden)                                                                                                                               |
| 18.7 | Closing with edits shows "Discard route edits?"; Keep editing preserves state; Discard closes; reopening is pristine (snapshot semantics)                                                                                                                      |
| 18.8 | Apply on a solo trip goes straight to the Pre-IG sheet with ZERO LLM requests; cancelling the funnel (Pre-IG scrim) reopens the editor with pending edits intact                                                                                               |

Manual-only (not automated): shared-trip "Rebuild now / Cancel" checkpoint,
actual write-back + IG rebuild (costed), Try-again retry, active-trip
auto-collapse, sticky strip on scroll, desktop column layout, story-mode
hiding (implicitly covered — fixtures open in Story mode and tests switch
to Plan), chat `update_route` stops invalidation.
