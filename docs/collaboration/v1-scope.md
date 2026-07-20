# Collaboration v1 — Scope (this iteration)

Feature checklist for the current iteration. Derived from
[`implementation-plan.md`](implementation-plan.md) (re-scoped 2026-07-20): Phases 0→3, 5, 6.
Email/push, routes-rebuild, and the itinerary magazine redesign are explicitly out of scope.

## Foundations (invisible plumbing)

- [ ] Schema reconciliation — capture drifted tables, add missing columns (prod-direct; `02`–`06` drafted)
- [ ] Live sync (realtime) — updates propagate across members without reload; `is_trip_member()` RLS

## 1. Invite & join co-travelers — Phase 1

- [ ] Members sheet with progressive entry point (`＋ Invite` solo → avatar stack shared)
- [ ] Shareable invite link (copy / native share) + revoke
- [ ] Join screen `/join/:token` (pre/post-auth) + expired/revoked state
- [ ] Remove member (owner) / Leave trip (self); max 8 members
- [ ] Membership lifecycle: **transferable ownership** (owner must transfer before leaving), **last-member-leaves → trip deleted**, member removal deletes their poll votes (everything else stays)
- [ ] Solo-vs-shared gating — zero collab chrome until a 2nd person joins

## 2. Shared Trippy chat — Phase 2

- [ ] Multi-user shared Trippy conversation with author attribution (avatars/names)
- [ ] Message addressing — who-answers (Trippy / Everyone) + @mention (public ping)
- [ ] Free human group chat vs. credit-spending Trippy turns
- [ ] Concurrency queue — Trippy turns serialize ("Trippy is helping X — you're next")
- [ ] Group-aware Trippy — sees members + preferences; proposes compromises, attributes who wanted what

## 3. Pooled credits — Phase 2.5

- [ ] Shared per-trip credit pool — anyone can fund it
- [ ] Protected personal wallet + fork paywall on empty pool
- [ ] Credit pill (pooled vs personal) + Trip Credits sheet (funded-by, packs, recharge scope)

## 4. Activity feed & transparency — Phase 3

- [ ] Activity feed — who / what / when / why (Trippy's own rationale)
- [ ] Inline undo, incl. others' edits (**best-effort, conflict-warned** — see R5; if an entity was edited after the change, undo warns rather than blind-reverts)
- [ ] "While you were away" on-return summary
- [ ] 🔔 bell + unseen badge entry point

## 5. Per-traveler preferences — Phase 5

- [ ] Preferences per traveler (free-text + quick tags)
- [ ] Trippy synthesizes "satisfy everyone" into the plan

## 6. Polls / group decisions — Phase 6

- [ ] Manual polls (free) + Trippy-suggested polls on detected disagreement
- [ ] Single + approval modes; open, changeable votes; vote-notes Trippy factors in
- [ ] Decisions hub (Board → Decisions)
- [ ] Persistent cross-tab open-poll pin
- [ ] Anchored to day / activity / freeform only

---

## Explicitly deferred (NOT this iteration)

- **Email digest + push notifications** (Phase 4) — in-app "while you were away" covers v1; email/push is the heaviest infra, fast-follow.
- **Routes-as-poll + post-IG rebuild** (Phase 7 → v1.1) — high effort × rare use; polls ship without it.
- **Ranking-mode polls** — v1.1.
- **Itinerary magazine redesign** — rewrite the detailed itinerary UI (currently list-based / cumbersome) into a **proper magazine view: full-screen photo backdrops, text overlay, refined language — super pleasant to read.** Dual-mode (Story vs Plan). Specced in [`../itinerary-story-mode-plan.md`](../itinerary-story-mode-plan.md); sequenced after collaboration.
