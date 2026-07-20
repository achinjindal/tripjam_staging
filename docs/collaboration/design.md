# Collaborative Trip Planning — Design Spec

Build-ready UI spec for the collaboration flow. Companion to [`documentation.md`](documentation.md) (requirements) and [`../collaboration-plan.md`](../collaboration-plan.md) (strategy).

## Design system (reuse — never hardcode)

From `src/theme.js`: `T` colors, `TYPE` (DM Serif Display headings / Georgia body), `RADIUS`, `SHADOW`, `MOTION`. Patterns already in the app to reuse:

- **Bottom sheets** — `borderRadius: "20px 20px 0 0"`, dimmed backdrop, sheet tier `zIndex ≥ 1600` (above the collapsed chat bar at 900 — see the recent layering fix).
- **Toast + confirm sheet** — `src/dialogs.jsx` (`showToast`, `confirmSheet`); use for "Link copied", "Member removed", destructive confirms.
- **Avatars** — `src/Avatar.jsx`.
- **Warm palette**, serif type, soft cards with `SHADOW.sm`.

Accessibility carries over: `:focus-visible` outline, `aria-label` on icon-only buttons, `T.mist` now WCAG-passing, reduced-motion honored.

---

## Solo vs shared (applies to every screen below)

**All collaboration chrome is shared-only — it appears only when a trip has ≥2 members.** In a solo trip the app is exactly as it is today: no Members button, no `To:` selector, no attribution, no pooled-credit fork, no poll UI. Every surface in this spec is gated on `member_count >= 2` unless noted.

## Screen map

```
Trip view (existing) ── header ──▶ [👥 Members]  [🗳 Decisions•]  [📤 Share]   (👥/🗳 shared-only)
   │
   ├─ Members sheet ──▶ Invite (link) / list / remove / leave
   ├─ Shared Trippy chat (existing chat, now multi-user + live + To: selector + ＋poll)
   ├─ Activity feed (new tab/sheet)
   ├─ "While you were away" summary (on return, auto)
   ├─ Preferences sheet (per traveler)
   ├─ Polls ── card (chat/day/routes) + Decisions hub (Board tab) + open-poll pin
   ├─ Routes ── "Vote on the plan" + edit attribution + stale-vote flag
   └─ Credit pill + recharge/empty-pool fork sheet (extends CreditsOverlay)

/join/:token ──▶ Join-trip screen (accept / sign-in-first)
Email digest ──▶ transactional template (Resend)
```

---

## 1. Members sheet

Entry: a **👥 avatar-stack button** in the trip header (next to Share). Stack shows up to 3 member avatars + "+N".

```
┌─────────────────────────────────────────┐
│  Trip members                        ✕   │
│  Tokyo to Kyoto Classic                   │
│                                           │
│  ┌───────────────────────────────────┐   │
│  │ 🟠 Achin        Owner · you        │   │
│  │ 🔵 Ravi         Editor        ⋯    │   │
│  │ 🟢 Aisha        Editor        ⋯    │   │
│  └───────────────────────────────────┘   │
│                                           │
│  🔗  Invite co-travelers                  │
│      Anyone with the link can join & edit │
│  ┌───────────────────────────────────┐   │
│  │  Copy invite link            📋   │   │
│  └───────────────────────────────────┘   │
│      Link active · Revoke                 │
│                                           │
│  ───────────────────────────────────     │
│  🚪 Leave this trip                       │
└─────────────────────────────────────────┘
```

- **⋯ per member** (owner only): "Remove from trip" → `confirmSheet` (danger) → toast "Ravi removed".
- **Copy invite link** → generates/reuses `invite_links` token, copies `/join/:token`, toast "Invite link copied".
- **Revoke** → `confirmSheet` → nulls the token → toast "Invite link revoked".
- **Leave** (non-owners) → `confirmSheet` warning credits stay with the trip; on confirm calls `leave_trip()`. Their poll votes are dropped; everything else stays.
- **Leave (owner)** → tapping Leave opens a **"Choose the new owner"** picker (list of co-members) → `transfer_ownership()` then leave. If the owner is the **sole** member, Leave becomes **"Delete this trip?"** (`confirmSheet` danger → `leave_trip()` deletes it).
- States: **empty** (solo) shows only the invite block; **loading** skeleton rows; **error** inline retry.

---

## 2. Join-trip screen (`/join/:token`)

```
┌─────────────────────────────────────────┐
│               ✈️ TripJam                  │
│                                           │
│         🟠  Achin invited you to          │
│                                           │
│        “Tokyo to Kyoto Classic”           │
│         📅 Jun 10 – Jun 17 · 3 travelers  │
│                                           │
│   You'll be able to edit the plan and     │
│   chat with Trippy together.              │
│                                           │
│  ┌───────────────────────────────────┐   │
│  │           Join trip  →             │   │
│  └───────────────────────────────────┘   │
│         Maybe later                       │
└─────────────────────────────────────────┘
```

- **Logged out** → primary CTA becomes "Sign in to join"; after auth, returns here and auto-continues.
- **Invalid/expired token** → 🗺️ "This invite link is no longer active."
- **Already a member** → skip straight into the trip.
- On accept: `accept_invite(token)` → toast "You're in!" → open the trip.

---

## 3. Shared Trippy chat (multi-user)

Extends the existing chat sheet. Changes: **author attribution**, **message addressing (To: selector)**, **live streaming from others**, **presence**.

```
┌─────────────────────────────────────────┐
│  Trip chat                 👥 3    ✕      │  ← presence: who's here
│                                           │
│                    ┌────────────────────┐ │
│                    │ Make day 4 relaxed │ │  ← your bubble (right)
│                    └────────────────────┘ │
│                    → 🐧 Trippy · you · 3m │  ← addressed-to line
│                       🔵 Ravi → Everyone  │
│  ┌──────────────────────────────────────┐ │
│  │ can we keep day 3 as-is? i liked it   │ │  ← human msg, no LLM/credits
│  └──────────────────────────────────────┘ │
│                       🔵 Ravi → 🟢 Aisha  │
│  ┌──────────────────────────────────────┐ │
│  │ you're booking the ryokan right?      │ │  ← directed, still visible to all
│  └──────────────────────────────────────┘ │
│  ┌──────────────────────────────────────┐ │
│  │ 🐧 Swapped Day 4 to a slow Arashiyama │ │  ← Trippy (left)
│  │    morning + onsen afternoon.         │ │
│  │    [Day 4 updated ·  Undo]            │ │  ← inline action chip
│  └──────────────────────────────────────┘ │
│  🟢 Aisha is typing…                       │
│                                           │
│  To: [🐧 Trippy ▾]                         │  ← audience selector (default Trippy)
│  ┌───────────────────────────────────┐   │
│  │ Ask Trippy…                        │   │
│  └───────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

**Audience selector** (the `To:` control above the input):

```
   To: [ 🐧 Trippy ▾ ]        tap ▾ ─▶  ┌─────────────────────┐
                                        │ 🐧 Trippy  (default)│
   placeholder + send tint change       │ 👥 Everyone         │
   per target:                          │ ───────────────     │
   • Trippy   → "Ask Trippy…" (ocean)   │ 🔵 Ravi             │
   • Everyone → "Message the group…"    │ 🟢 Aisha            │
   • @Aisha   → "Message Aisha…"        └─────────────────────┘
```

- **Directed-to line** under each sent message shows the target: `→ 🐧 Trippy`, `→ Everyone`, or `→ 🟢 Aisha`. **All messages are visible to everyone** — the target signals intent, not visibility.
- **Default target is Trippy.** After a human-directed message, the composer keeps that target until changed (sticky), so a back-and-forth with the group doesn't require re-selecting each time; a subtle hint reminds "Tap To: 🐧 to ask Trippy."
- **Only Trippy-directed messages call the LLM / spend credits.** Everyone/@person messages are free human chat (no spinner, no cost) — reflect this: no "Trippy is thinking" state for those.
- **Author row** above each human bubble (avatar + name + target + time); own messages right-aligned.
- **Trippy bubble** carries the action result chip; the chip's summary is what lands in the feed + email.
- **@person nudge:** a message directed at a specific member may badge that member in-app ("Ravi asked you something").
- **Presence** header count + "typing…" via Realtime Presence (optional; degrade gracefully if off).
- **Concurrency (serialize AI turns only):** if Trippy is mid-response for another member, show "🐧 Trippy is helping Ravi — you're next" and queue the local prompt (accepted, not re-typed). **Human `everyone`/`user` messages still send instantly** — only Trippy turns wait. See documentation §6.
- **Streaming from others:** co-travelers' prompts and Trippy's streamed reply animate in live.

---

## 4. Activity feed

New surface — a **feed icon in the header** (badge = unseen count) opening a sheet, or a Board sub-tab.

```
┌─────────────────────────────────────────┐
│  Activity                            ✕   │
│                                           │
│  Today                                    │
│  🔵 Ravi · 2m                             │
│     Day 4 → relaxed Arashiyama morning    │
│     via Trippy: “slower pace, onsen PM”   │
│                                    Undo   │
│                                           │
│  🟢 Aisha · 1h                            │
│     Added to-do “Book JR Pass”            │
│                                    Undo   │
│                                           │
│  🟠 Achin · 3h                            │
│     Recharged pool +300 credits           │
│                                           │
│  Yesterday                                │
│  🐧 Trippy · via Ravi                     │
│     Replaced Day 3 lunch → Trishna        │
│                                    Undo   │
└─────────────────────────────────────────┘
```

- Grouped by day; each row: actor avatar, summary, relative time, italic Trippy rationale when present, inline **Undo**.
- **Undo** → applies `undo_payload`, writes an `undo` log row, toast "Reverted", notifies original actor in-app.
- Credit recharges and member joins appear as non-undoable info rows.
- **Empty:** "No changes yet — start planning together."

---

## 5. "While you were away" (on return)

Auto-shown when `activity_log` has rows newer than the member's `last_seen_at`.

```
┌─────────────────────────────────────────┐
│  While you were away                 ✕   │
│  3 changes since Tue                      │
│                                           │
│  • Ravi made Day 4 relaxed                │
│  • Aisha added 2 to-dos                   │
│  • Trippy swapped Day 3 lunch → Trishna   │
│                                           │
│  ┌───────────────────────────────────┐   │
│  │        Review in feed  →           │   │
│  └───────────────────────────────────┘   │
│           Got it                          │
└─────────────────────────────────────────┘
```

- Condensed (max ~5 lines, "+N more"). "Review in feed" opens the full feed; "Got it" dismisses.
- Either action stamps `last_seen_at = now()`.
- Never shown twice for the same changes; never for a member's own changes.

---

## 6. Preferences sheet (per traveler)

Entry: prompt after joining ("Tell Trippy what you want from this trip") and re-openable from Members or chat.

```
┌─────────────────────────────────────────┐
│  Your travel style                   ✕   │
│  Trippy plans for everyone on the trip    │
│                                           │
│  What do you love / want to avoid?        │
│  ┌───────────────────────────────────┐   │
│  │ Beaches and good coffee. Please no │   │
│  │ 6am starts. Vegetarian food.       │   │
│  └───────────────────────────────────┘   │
│                                           │
│  Quick tags (optional)                    │
│  [🏖 Beaches] [🥾 Hikes] [🍜 Food]        │
│  [🎨 Culture] [😌 Relaxed] [🌙 Nightlife] │
│                                           │
│  ┌───────────────────────────────────┐   │
│  │              Save                  │   │
│  └───────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

- Free text (`prefs_text`) + optional tags (`prefs_struct`). Saved per (trip, user).
- A small "3 of 3 travelers shared preferences" indicator elsewhere nudges completion; Trippy can also ask in chat.

---

## 7. Polls & group decisions

Three surfaces: the **poll card** (born in chat / on a day / on routes), the **Decisions hub** (canonical list), and the **open-poll pin** (anti-burial). All shared-only.

### Poll card (open, with vote-notes)

```
┌─────────────────────────────────────────┐
│  🗳  Day 4: Kyoto or Osaka?               │
│      Suggested by 🐧 Trippy · closes 9pm  │
│                                           │
│  ◉ Kyoto — temples & Arashiyama   ▓▓▓ 2   │
│      🟢 Aisha “keep it relaxed”           │  ← vote-note (comments)
│  ○ Osaka — food & Dotonbori       ░░░ 0   │
│                                           │
│  You voted Kyoto · Change · + add a note  │
│  ───────────────────────────────────     │
│  Live · anyone can change their vote      │
│  until it closes         [ Close poll ]   │  ← creator/owner
└─────────────────────────────────────────┘
```

- **Open, changeable voting:** tap to vote, live tallies via realtime, change anytime until close. No blind voting.
- **Modes:** `single` (radio, default; auto for 2 options) · `approval` (checkboxes, "pick all you're happy with"). Ranking deferred.
- **Vote-note:** optional "+ add a note" (one per voter, editable) → shows under your option, visible to all.
- **Close:** creator/owner taps **Close poll**, or it closes on `closes_at`. Not auto-on-last-vote (votes stay changeable).
- **On close:** Trippy applies the winning option (anchored polls) and factors notes in; card collapses to a one-line result (`✓ Day 4 → Kyoto`).
- States: **open / voted / closing-soon / resolved / cancelled**.

### Invocation entry points

- **Trippy-suggested:** appears in chat, framed by Trippy's message; cancellable.
- **Manual:** the composer **＋ menu → Poll** → compose sheet (question + 2–4 options + mode). Free, no LLM.

```
   [＋]  tap ─▶  ┌──────────────┐        Compose:  Question ______________
                 │ 🗳 Poll      │                  Option 1 ______  Option 2 _____
                 │ 📎 Link      │                  [＋ option]   Mode: (•)Single ( )Approval
                 └──────────────┘                  [ Post to Everyone ]
```

### Decisions hub (Board → new "Decisions" tab)

```
┌─────────────────────────────────────────┐
│  Decisions                           ✕   │
│                                           │
│  Open                                     │
│  🗳 Day 4: Kyoto or Osaka?   2/3 · 9pm    │
│  🗳 Which plan?  (routes)     1/3         │
│                                           │
│  Decided                                  │
│  ✓ Ryokan night: Hakone      → Hakone     │
│  ✓ Add Nara day trip?        → Yes (3–0)  │
└─────────────────────────────────────────┘
```

- Canonical list — open first, then resolved with outcomes. Every poll lands here regardless of where it was born, so nothing is lost to chat scroll.

### Open-poll pin (anti-burial)

A slim persistent bar atop the relevant tab until the poll closes; follows the member across itinerary/routes/chat:

```
🗳 Day 4: Kyoto or Osaka? · 2/3 voted · Vote →
```

---

## 7b. Routes: group voting & edit attribution (shared-only)

The routes/brainstorm tab is where the first big group decision happens. Two shared-mode additions to the existing route cards:

```
┌─────────────────────────────────────────┐
│  🐧 4 plans ready — put them to a vote?   │  ← Trippy auto-suggest (shared trip)
│                          [ Start a vote ] │
├─────────────────────────────────────────┤
│  P2 · Tokyo to Kyoto Classic       ★ Rec  │
│  ✏️ Edited by 🟢 Aisha · 2h          ⚠️   │  ← attribution (only if human-edited)
│  Day 1 …                                  │     ⚠️ = changed after voting started
│  …                                        │
│  [✓ Selected]  [Modify]  [Dismiss]        │
└─────────────────────────────────────────┘

   Header action (shared):  [ 🗳 Vote on the plan ]  → route poll, options = the 4 plans
```

- **"Vote on the plan"** — header affordance creates a route poll (`entity_type='route'`, options = the 4 route ids). Trippy also **auto-suggests** it right after generating routes. Winner → selection → pre-IG → IG. Unilateral "Selected" still works (voting is optional).
- **Edit attribution** — a subtle `✏️ Edited by <name> · <when>` line appears **only once a route is human-edited** (AI-generated untouched routes stay clean). Tap → that route's feed history.
- **Vote-integrity flag** — if a route is edited while its poll is open, a `⚠️` badges the card and the poll (`P2 changed after voting started`), nudging voters on that option to reconsider. Non-blocking, since votes are changeable.

---

## 8. Credits UI — personal wallet + opt-in trip pool

Extends the existing credit pill + `CreditsOverlay` paywall. Reflects the stress-tested model (documentation §5): personal wallet + optional per-trip pool, trip-pool-first waterfall.

- **Pill** (top-right): on a **shared trip** shows the trip pool balance with a 👥 (`👥 240`); on a **solo trip** shows the personal wallet as today (`240`). Tapping opens the sheet below.

### Recharge sheet (shared trip)

```
┌─────────────────────────────────────────┐
│  Trip credits                        ✕   │
│  Shared by everyone on this trip          │
│                                           │
│           👥  240 credits left            │
│      Funded by: 🟠 Achin 300 · 🔵 Ravi 100│
│                                           │
│  Add credits to this trip                 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│  │  300    │ │  1000   │ │ Coupon  │     │
│  │ $4.99   │ │ $9.99   │ │  code   │     │
│  └─────────┘ └─────────┘ └─────────┘     │
│      Shared with the whole trip · stays   │
│      with the trip if you leave.          │
│  ───────────────────────────────────     │
│  Your personal wallet: 60                 │
│  These are yours — never spent on a       │
│  shared trip unless you choose to.        │
└─────────────────────────────────────────┘
```

### Empty-pool paywall (the one genuinely new screen — the fork)

Shown when a member acts on a shared trip whose pool is empty. **Personal credits are never spent silently** — the member chooses:

```
┌─────────────────────────────────────────┐
│  This trip is out of credits         ✕   │
│  Anyone on the trip can top it up.        │
│                                           │
│  ┌───────────────────────────────────┐   │
│  │  ➕ Add credits to this trip       │   │  ← funds the pool, helps everyone
│  │     300 · $4.99   /  1000 · $9.99  │   │
│  └───────────────────────────────────┘   │
│                                           │
│  ┌───────────────────────────────────┐   │
│  │  👛 Use my personal credits (60)   │   │  ← opt-in, this session only
│  │     for this action                │   │
│  └───────────────────────────────────┘   │
│                                           │
│      We'll ask again next time you        │
│      open this trip.                      │
└─────────────────────────────────────────┘
```

- **Add to trip** → purchase/coupon lands in `trips.credit_balance` (`trip_id` passed). "Funded by" reads `credit_transactions.trip_id`.
- **Use personal** → this member's spend draws from `profiles.credits` for the session; re-asked next visit. Hidden if the member has no personal credits.
- **Solo trip:** no fork — personal wallet auto-pays; paywall is today's standard buy sheet.
- **Big-spend guard:** before any single action >~15 credits (full itinerary/route regen), a `confirmSheet`: "This will use ~40 shared credits. Continue?"
- Non-refundability + "personal is protected" stated plainly.

---

## 9. Email digest (Resend template)

One per day, 9am local, per trip, only if changed.

```
Subject: 3 changes to your Tokyo trip

Hi Aisha,

Here's what changed in “Tokyo to Kyoto Classic” yesterday:

  • Ravi made Day 4 relaxed
      “slower pace with an onsen afternoon”
  • Achin added a to-do: Book JR Pass
  • Trippy swapped Day 3 lunch → Trishna, Colaba
      “one of the city's best seafood spots”

        [ Open your trip → ]

You're getting this because you're planning together on TripJam.
Mute this trip's daily summary · Notification settings
```

- Uses `activity_log.summary` lines (Trippy's rationale carries through). Warm/serif brand styling to match the share-image card.
- Footer: one-click mute (sets `notification_prefs.email_digest = false`).

---

## Interaction states checklist (per surface)

| Surface       | Loading           | Empty                  | Error                   | Live-update                         |
| ------------- | ----------------- | ---------------------- | ----------------------- | ----------------------------------- |
| Members sheet | skeleton rows     | invite-only block      | inline retry            | member add/remove reflects live     |
| Join screen   | spinner on accept | —                      | invalid/expired message | —                                   |
| Shared chat   | typing/streaming  | first-message prompt   | send-failed retry       | others' msgs + Trippy stream in     |
| Activity feed | skeleton          | "no changes yet"       | retry                   | new rows prepend live               |
| While-away    | —                 | not shown if none      | —                       | computed on open                    |
| Preferences   | —                 | prompt to add          | save-failed toast       | —                                   |
| Poll card     | —                 | —                      | vote-failed toast       | tallies + notes + votes update live |
| Decisions hub | skeleton          | "no decisions yet"     | retry                   | polls add/resolve live              |
| Open-poll pin | —                 | hidden if no open poll | —                       | tally + dismiss on close            |
| Credit pool   | balance skeleton  | empty → fork paywall   | purchase-failed toast   | balance updates on spend/topup      |

## Component work (new/extended)

- **New:** `MembersSheet`, `JoinTripScreen`, `ActivityFeed`, `WhileAwaySheet`, `PreferencesSheet`, `PollCard`, `PollComposeSheet`, `DecisionsHub` (Board tab), `OpenPollPin`, `TripCreditsSheet`, `AudienceSelector` (chat To: control).
- **Extended:** chat sheet (author rows, target line + audience selector, ＋poll menu, presence, concurrency), header (avatar-stack + Decisions badge), route cards (edit-attribution line, ⚠️ stale-vote flag, "Vote on the plan"), `CreditsOverlay` (personal-wallet + trip-pool + empty-pool fork), `dialogs.jsx` (confirms/big-spend guard).
- **Gating:** every new component renders only in shared mode (`member_count >= 2`); solo trips import none of this chrome.
- **Consistency:** all sheets use the shared bottom-sheet shell (`20px 20px 0 0`, backdrop, `zIndex ≥ 1600`); destructive actions route through `confirmSheet`; confirmations use `showToast`. Extract a `<BottomSheet>` primitive during this work — there are now enough sheets to justify it.
