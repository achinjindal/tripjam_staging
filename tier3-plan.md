# Realtime Tier 3 — Presence — Plan

Adds **ephemeral "who's here right now"** signals on top of the data-sync tiers: live "viewing" indicators on the member avatars + a "someone is typing" indicator in the shared Trippy chat. Builds on branch `collab-tier2` (top of the collab stack). Dark behind `VITE_REALTIME_ENABLED` + shared-trip gating; solo trips byte-identical.

Fundamentally different from Tiers 1/2: **no database, no migration, no RLS.** Presence state lives only on the realtime channel while a client is connected and auto-drops on disconnect. Part A = product/design (+ decisions). Part B = technical (for independent eng review).

## Current state (audited)

- `subscribeTrip(tripId, handlers, onSubscribed)` in `src/realtime.js` opens **one channel per trip** (`supabase.channel('trip:'+tripId)`) with `postgres_changes` bindings, and already calls `onSubscribed` on every `SUBSCRIBED` (initial + reconnect). It returns a bare `unsubscribe` function. **Presence must ride this same channel** (one channel per topic — a second channel to the same topic is wasteful/conflicting).
- Single caller: `App.jsx:6783` (`const unsubscribe = subscribeTrip(...)`).
- `AvatarStack({ names, size, ring })` (`src/MemberAvatar.jsx`) renders the header member stack in **both** header shells (desktop context bar + mobile hero). No online concept today.
- Chat: `chatInput`/`setChatInput` (composer, App.jsx:7635), `chatInputRef` textarea, `chatLoading` (each member sees only their OWN loading state). `sendChatMessage` clears `chatInput` on send.
- `members` state = the roster; `session.user.id` = self. Names resolved as elsewhere (`m.profiles?.username`).

---

# PART A — PRODUCT / DESIGN

**Goal:** make a shared trip _feel_ occupied — you can tell when a co-traveller is in the trip with you, and when they're composing a message.

- **"Who's viewing" dots:** members currently in the trip get a subtle **green presence dot/ring** on their avatar in the header stack. Matches the design split — "avatars = who's here" (the 🔔 bell answers "what changed"). Members not currently connected show as plain avatars.
- **Typing indicator:** when a co-traveller is typing in the shared chat, everyone else sees a quiet "**Aisha is typing…**" line above the composer (or in the chat thread). Clears when they send or go idle.
- **Ephemeral + honest:** presence reflects _right now_. Close the tab and you disappear from everyone's view within a second or two — no stale "online" ghosts. It stores nothing.
- **Advisory only:** presence never gates or locks anything (edit model stays unilateral + undo). It's ambient awareness.

### Product decisions

- **D-T3.1 — v1 scope:** (a) **who's-viewing dots + chat typing** [recommended — the two highest-value ambient signals]; (b) also finer-grained "viewing / editing Day N" hints [more `track` points + UI, defer to fast-follow]; (c) dots only, no typing.
- **D-T3.2 — Typing visibility:** show a human's typing to **everyone** on the trip (the chat is shared) [recommended]. Broadcasting "Trippy is responding…" to all members (so others know an AI turn is mid-flight) is a related nicety — **defer** (ties to the old `ai_busy` idea; v1 = human typing only).
- **D-T3.3 — Indicator style:** a green **dot on the avatar** [recommended, matches the avatars=who's-here design] vs a separate "2 here now" pill.

---

# PART B — TECHNICAL (independent eng review)

Uses **Supabase Realtime Presence** on the existing per-trip channel. No Postgres, no migration, no RLS.

## 1. `src/realtime.js` — extend `subscribeTrip` with presence (same channel)

- New optional param `presence = { key, state, onSync }`:
  - Create the channel with presence config: `supabase.channel('trip:'+tripId, { config: { presence: { key: presence.key } } })` (key = `userId`, so all of one user's tabs share a key).
  - Add `channel.on('presence', { event: 'sync' }, () => presence.onSync?.(channel.presenceState()))` (sync fires on any join/leave; `presenceState()` returns `{ [userId]: [meta, …] }`).
  - In the **existing `onSubscribed`** branch, `channel.track(presence.state)` — **re-tracks on every (re)connect**, which is essential (we've observed the `CLOSED → SUBSCRIBED` reconnect cycle; without re-track you silently vanish from presence).
- **Return shape change:** return `{ unsubscribe, updatePresence }` where `updatePresence(next)` calls `channel.track(next)` (track merges/replaces the client's presence meta) — used for typing on/off. Update the single caller (App.jsx:6783) to destructure. When `presence` is absent, `updatePresence` is a no-op; when `REALTIME_ENABLED` is false, everything is a no-op (return the same shape so callers don't branch).
- `removeChannel` on unsubscribe already drops presence (leave fires for peers) — no explicit `untrack` needed.

## 2. App — presence state + own tracking

- State derived from `onSync`: `presentIds` (Set of userIds present, **excluding self**) and `typingIds`/`typingNames` (present users with `meta.typing===true`, excluding self). Dedupe by key: `presenceState()` gives an array per userId (multiple tabs) → a user is "present" if ≥1 entry, "typing" if **any** entry has `typing:true`.
- **Track own presence** only on shared trips: pass `presence = { key: session.user.id, state: { user_id, name, typing:false }, onSync }` into `subscribeTrip`. Solo trips pass no presence (byte-identical).
- **Typing lifecycle** (the fiddly part):
  - Composer `onChange` → **throttled** `updatePresence({…, typing:true})` (send `typing:true` at most once per burst, not per keystroke).
  - A **client-side idle timer** (~3s after last keystroke) → `updatePresence({…, typing:false})`, so a dropped update never leaves "typing…" stuck.
  - `sendChatMessage` / send → immediately `updatePresence({…, typing:false})` + clear the timer.
- Mirror `members`/`session` into refs if the presence callbacks need current values without re-subscribing (same pattern as `membersRef`).

## 3. UI

- **Avatar dots:** extend `AvatarStack` with an optional `presentIds` (or `online: boolean[]` aligned to `names`) → render a small green dot/ring on present members. Wire in **both** header shells. Self can show a subtle "you" state or nothing.
- **Typing line:** in the chat panel, when `typingNames` non-empty, show "`{names.join(', ')} {is/are} typing…`" above the composer (reuse the existing chat status area). Excludes self.

## 4. Cross-cutting

- **Gating:** presence tracked only when `REALTIME_ENABLED && isSharedTrip`; solo trips never track → byte-identical. Self always excluded from indicators.
- **Throttle/rate:** coalesce `track()` calls (typing burst + idle-clear only); never per-keystroke.
- **Reconnect:** re-track in `onSubscribed` (§1) — the one non-obvious correctness requirement.
- Branch `collab-tier3` stacked on `collab-tier2`. No migration → nothing to repair before prod (flags-only).

## 5. Tests (staging-first)

- **Node** `scripts/tier3-presence-test.mjs`: two clients join the same `trip:<id>` channel with presence; assert each sees the other in `presenceState()` after sync; A `track({typing:true})` → B's synced state shows A typing; A `removeChannel` → B's sync no longer lists A (leave). Also: two "tabs" for one user (two connections, same key) → dedupe to one present user, and both leaving removes them.
- **Two-context Playwright** `e2e/collab-presence.spec.ts`: both open the trip → each sees the other's online dot; A focuses chat + types → B sees "…is typing"; A stops → indicator clears after idle; A closes the context → B's dot disappears. (Presence is ephemeral → generous waits; flakier than data-sync tests — the leave-on-close and idle-clear are the trickiest.)

## Open technical questions for the reviewer

1. Presence **`key`** = `userId` (so multi-tab dedupes cleanly) — correct, or does keying per-connection + client dedupe behave better on reconnect?
2. **`track()` throttle** shape for typing — is a leading `typing:true` + trailing `typing:false` (idle ~3s) the right minimal chatter, and any Supabase presence rate concern?
3. Changing `subscribeTrip`'s **return type** to `{ unsubscribe, updatePresence }` — clean, or prefer a separate `trackPresence` handle to avoid touching the return contract?
4. Does presence need `realtime.setAuth` / RLS at all (it's channel-scoped, not DB) — confirm co-members on the same trip channel see each other's presence, and that a non-member can't join `trip:<id>` (is the channel topic itself access-controlled, or only postgres_changes rows)? **This is the one security-relevant question** — could a non-member subscribe to the topic and see who's online?
5. Re-track timing: is calling `track()` inside the `SUBSCRIBED` callback the supported place, and does a rapid reconnect risk a duplicate/racey track?

---

# PART C — REVIEW CORRECTIONS (independent eng review — verdict: implement-with-changes)

**The security question is a real leak, not theoretical.** Confirmed against the project: no Supabase Realtime Authorization is configured (the only realtime migration just adds tables to the publication — that governs `postgres_changes` _only_), and the channel is public (`realtime.js:50`, no `config.private`). On a public topic, **presence + broadcast are NOT gated by the `is_trip_member` RLS** that filters postgres*changes rows. So a non-member who knows a `trip:<id>` gets zero row payloads (RLS filters them empty) but **does** receive presence sync carrying `{user_id, name, typing}` for every member currently online. The `realtime.js:4-6` comment ("RLS is enforced on realtime rows") is true for rows only — presence is a different transport on the same socket. **Leak = usernames + UUIDs + typing of who's online now** (not trip content, not offline roster). Severity: low (trip ids are 122-bit `crypto.randomUUID`, non-enumerable → targeted, not mass-harvestable), but it's a real PII-adjacent disclosure to non-members, and it only appears \_because* Tier 3 adds presence data the current row-only path never carried.

**D-T3.4 — Presence channel privacy (the decision that gates implementation):**

- **(a) Private presence on a SEPARATE channel `trip:<id>:presence` [recommended].** Make ONLY the presence channel `config.private:true` + add one `realtime.messages` RLS policy keyed to `is_trip_member(topic_uuid, auth.uid())`. Isolates the privacy fix so it **cannot break the already-shipped Tier 1/2 sync**. Cost: a second channel per trip (small) + breaks the "one channel per topic" principle (acceptable given the risk it removes).
- **(b) Make the EXISTING trip channel private.** One channel, clean — BUT a private channel gates _all_ topic messages (incl. postgres_changes) on `realtime.messages` RLS + a valid socket JWT; a missing/expired token would **silently break all Tier 1/2 live sync**, not just presence. Requires end-to-end staging validation of postgres_changes-on-private + the `setAuth`/token-refresh path before enabling. Higher regression risk to shipped features.
- **(c) Public channel + documented, signed-off risk.** Ship the leak (fast). Only acceptable as an explicit, recorded decision — not an unstated "no RLS" bullet.

Recommendation: **(a)** — closes the leak without putting the working data-sync at risk.

**DECISION (user): D-T3.4 = (a) — separate private channel `trip:<id>:presence` + `realtime.messages` RLS keyed to `is_trip_member`.** Presence is fully isolated from the shipped postgres_changes sync. D-T3.1 = dots + typing (route/day hints deferred); D-T3.2 = human typing to everyone (Trippy-busy broadcast deferred); D-T3.3 = green dot on avatars.

Implementation note for (a): a NEW `subscribeTripPresence(tripId, { key, state, onSync })` in realtime.js that opens `supabase.channel('trip:'+tripId+':presence', { config:{ private:true, presence:{ key } } })` — kept separate from `subscribeTrip` so the data-sync path is untouched. Migration adds the `realtime.messages` SELECT+INSERT policy (validate `realtime.topic()` API at build time). Node test MUST authenticate + rely on the private-channel join (a bare/unauth client should be REJECTED — that rejection is the security assertion).

**Other corrections to fold in:**

1. **Disabled path (`realtime.js:47-48`) must return `{ unsubscribe:()=>{}, updatePresence:()=>{} }`** — not a bare function, or the new destructure at App.jsx:6783 throws when `REALTIME_ENABLED` is false. (Easy to miss; hard requirement.)
2. **Re-track the CURRENT state, not the initial state:** in the `SUBSCRIBED` callback, `track()` a ref-held "latest desired presence" (so a typing state set during a reconnect blip is restored), wrapped in the existing try/catch. `track()` returns a Promise — fire-and-forget but guarded.
3. **Ref `updatePresence` itself** (set in the subscribe effect) so the chat composer (~3400 lines away) can call it without re-subscribing; do NOT lift to state. Mirror `session.user.id` + display name into refs like `membersRef` (App.jsx:6861-6864).
4. **Wire typing-clear into BOTH send paths** — `sendChatMessage` (10156) AND the human-message path `sendHumanMessage` (10125) must each `updatePresence({typing:false})` + cancel the idle timer.
5. **key=userId is correct** (multi-tab dedupe: present if ≥1 meta, typing if any meta typing; last-tab-leave drops the user). Keep it. `track()` in `SUBSCRIBED` is the supported place; keyed presence replaces (no duplicate-under-key race).
6. **Reuse `isSharedTrip` (App.jsx:6910)** for gating; solo passes no presence → byte-identical. NOTE: under option (b) the channel is private for all shared trips → NOT behavior-neutral for existing shared sync (another reason to prefer (a)).
7. **Tests:** Node test must use the **same channel config as prod** (authenticate + `setAuth` if private, else it silently tests a public channel while prod is private = false confidence) and be **event-driven on `sync`/`leave` with timeouts, not fixed sleeps** (`sync` is async; `leave` lags disconnect 1–2s). Treat the Playwright two-context test as **advisory/non-gating** — presence leave/idle is inherently the flakiest tier.
