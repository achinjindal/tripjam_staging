# 17 — Collab P0/P1 journey-gap features

Acceptance criteria for the 2026-08-11 build (spec: `collab-p0p1.spec.ts`).
All flag-gated behavior requires `VITE_INVITE_ENABLED=true`; solo trips must
be byte-identical with the flag off. No test may trigger RG/IG/chat LLM spend.

## Join routing

- Any malformed `/join/<token>` (non-uuid, truncated) renders JoinTrip's
  "invite no longer valid" state — never a silent fall-through to Home/Landing.

## Styles: quick tags (passenger lane)

- "Your kind of trip" shows six one-tap tag pills; toggles persist to
  `trip_preferences.prefs_struct.tags` and reseed on reopen.
- A tags-only save counts as a shared style everywhere: the sheet counter,
  both nudges, and the RG/IG/chat style builders (via hasStyle/styleTextOf).
- Save toast on shared trips names the consequence ("Trippy now plans for
  both of you").

## Seeded rebalance chip

- Saving a style arms a one-shot "✨ Rebalance the plans/itinerary for
  everyone's style" chip pinned above the chat input (visible with history).
- Disarms on tap or on opening a DIFFERENT trip; survives the pre-trip → trip
  id flip. Tap sends via sendChatDirect (a normal credited chat turn).

## Share surface

- With collab on, Share opens one sheet: "Invite to plan together" (routes to
  the members sheet) above image/text/"Share a view-only link". The direct
  copy behavior remains only when the flag is off.

## Invite hints

- Self-invite → inline "That's you — you're already planning this trip 🙂"
  (never toast-only; repeated 400s in console are expected RPC rejections).
- Unknown email → inline "No TripJam account for that email yet" +
  "Copy invite link" + (when send-email is configured) "Email them an invite".
- Targeted invite to an existing account fires an invite_member email
  (fire-and-forget; @tripjam.app shims skipped server-side).

## Expense splitting

- Shared trips: add-expense form gains a "Paid by" picker (Not-split default);
  choosing a member writes paid_by / split_mode='even' / split_count (member
  count frozen at entry).
- Rows show "paid by <name> · split N ways". Actual tab shows a Settle-up
  panel with per-currency pairwise transfers (greedy netting); planned rows
  never enter balances. Solo trips: widget unchanged.

## Welcome briefing

- Both accept paths (link /join + Home pending-invites banner) set a
  just-joined flag; the next open of that trip shows the one-time WelcomeSheet
  (deterministic, zero LLM): trip name/dates, plan state, co-traveller names,
  open-poll count. CTA opens the style sheet and suppresses the separate
  style nudge. The flag is consumed on show.

## Route votes + consensus checkpoint

- Selecting a route persists a vote to brainstorm_votes (delete-own-then-
  insert; single choice per member).
- On shared trips, Build-my-itinerary from a route that other members haven't
  voted for shows the checkpoint naming them; "Ask the group" creates a
  single-mode poll ("Build the itinerary from <label · title>?") and does NOT
  start IG; "Build anyway" proceeds. Vote-fetch failures never block building.

## Emails (send-email edge function; verified API-level, not in this spec)

- config probe → {enabled}; ships dark ({disabled:true}) without
  RESEND_API_KEY. invite_external capped 10/day/user; itinerary_ready deduped
  to one per trip per 24h; recipients resolved via profiles.email with
  @tripjam.app shims skipped; all sends logged to email_log.
