# 08 — Chat ("Trippy")

Trippy is one chat assistant on the route-planning (`brainstorm`) and itinerary screens. The browser sends a slim snapshot of the trip plus the message to one edge function (`supabase/functions/chat/index.ts`), which streams the model's reply back over SSE. Each reply is a short message plus `actions[]`, and `src/App.jsx` applies the actions: route edits, itinerary edits, to-dos, expenses, bookmarks, budget, navigation. Itinerary edits are small operations against specific activities (chat v3, `protocol: 2`), applied in one database transaction with a change card and one-tap Undo.

References are function names rather than line numbers. All chat client code lives in `src/App.jsx` (search for the names).

---

## 1. Where the chat lives

**State**: `chatMessages` (`{id, role, content, user_id?, streaming?, applying?, error?, suggestions?, changes?, undo?, undone?, hasChanges?, changedRouteIds?, followUp?, followUpLabel?, undoData?}`), `chatInput`, `chatLoading`, `chatOpen`, `chatUnread`. Roles are `user`, `assistant` and a local-only `system-undo` (undo pills, never sent to the model).

**Persistence**: `persistMessage` writes every user message and every successful Trippy reply to `trip_messages`, using client-supplied ids so the realtime echo dedupes. A reply's cards are saved in `trip_messages.meta` (`chatMeta` / `fromChatMeta`): suggestion cards, the change card, the "View updated" flag and follow-up buttons. They survive a reload and reach co-travellers. Error bubbles are **not** saved, because they'd come back on reload and be sent to the model as if Trippy had said them.

**Layout**:

- **Mobile (collapsed)**: a bar above the bottom nav on the itinerary and brainstorm screens shows Trippy's last reply (or `getChatPlaceholder()`, one stable line per trip).
- **Mobile (open)**: a bottom sheet. Esc closes it.
- **Desktop** (`useDesktopShell`): chat is inline in the right column and always open.

**Empty state**: a stage-aware greeting plus `chatStarterChips`, built from the trip as it is.

- **Brainstorm**: chips appear only once at least 2 plans are ready, and only name plan labels that exist ("Compare P1 and P2", "Reduce hotel switches in Pn" for the plan with the most cities). Labels are P1..Pn over the non-dismissed routes, the same list the server numbers.
- **Itinerary**: chips appear only once `detailedReady`. They name the real Day-1 hotel, the destination, and the busiest real day ("Make Day 4 more relaxed").
- **Chips send on tap.**

**Message rendering**: `renderMentions()` formats bold, italics and @mentions. The list is a `role="log"` with `aria-live="polite"`, and the send button has an `aria-label`.

- **While a reply is in progress**: "··· Trippy is thinking" until words arrive, then streamed text with a cursor. "Updating your itinerary…" shows while actions are being applied.
- **Under a reply**, depending on what it did:
  - suggestion cards;
  - the **change card** ("What changed": + added, − removed, ⇄ swapped, → moved, ⏱ retimed), with **Undo** in the current session;
  - follow-up buttons;
  - "View Updated Itinerary / Plans" when something was actually applied.

---

## 2. Sending a message

- `sendChatMessage()`: the typed path (Enter sends, Shift+Enter adds a newline).
- `sendChatDirect(text)`: everything else (chips, gem taps, poll closes, "know more", follow-ups).

Both go through `startTrippyTurn`, which adds the user bubble and an empty streaming reply bubble, persists the user row, and calls `performChatSend`.

**Queue.** While Trippy is replying (`chatBusyRef`), `sendChatDirect` queues the message instead of dropping it. The queue holds at most 3, drops duplicates (including the message in flight), and drains after each reply (`drainChatQueue`). It reads `chatMessagesRef`, so the history always includes the previous reply.

**History** sent to the model (`chatHistory()`) excludes undo rows, error bubbles and anything still streaming. The server trims it to the last 6 turns and also drops error text from older clients.

**Request** (`callUnifiedChat`): `POST /functions/v1/chat` with `x-chat-stream: 1` and this body:

```js
{ screen, trip, routes, days,   // slimChatContext(): only fields the server reads
  form, message, history,
  protocol: 2,                  // chat v3 (itinerary edits as ops)
  client_build,                 // VITE_APP_BUILD, see src/version.js
  members?, sender?, preferences?, spend_personal? }
```

`slimChatContext` sends trip logistics, route summaries, per-activity id/position/time/title/type/duration/confirmed, and gem titles. That's about 12 KB, against 47–94 KB for the full rows. If the server starts reading another field, add it there too.

**Failures** come back as a reason the user can read; the bubble never just says "error":

- **402**: the paywall opens. On a shared trip whose pool is empty it's the fork paywall; dismissing it ends the turn with a "Not sent" bubble.
- **429**: "You're sending messages quickly".
- **502 or an SSE `error` event**: the server's own message.

Every outcome is captured as PostHog `trippy_chat_response` with `ms`, `ms_first_token`, `ok` and `reason`.

---

## 3. Server (`supabase/functions/chat/index.ts`)

1. Kill switch, then auth, then rate limit (20 calls a minute).
2. **Retired-contract switch**: when `app_config.chat_protocol1_retired` is true, a request without `protocol: 2` gets an uncharged "please update TripJam" reply (`protocol1Retired`, cached for 60 s).
3. Credit pre-flight (`resolveAndGate`: personal wallet, or the trip pool for shared trips).
4. **Context**:
   - plans as `PLAN Pn (id=…)` blocks;
   - for v3 itineraries, `itineraryContext()` (`chat/_ops.ts`), which lists each activity with a short ref such as `D3.2 14:00 Wat Pho (sight, 1.5h) [booked]`;
   - for v2, `Day N - City: time title, …`;
   - plus logistics, form preferences, and group context on shared trips.
5. **Prompt**: static instructions (identity, the screen's action vocabulary, rules, examples) in a cache-marked system block, then a per-request context block. Haiku 4.5's 4,096-token cache minimum means the marker is currently inert.
6. **Model call**: `streamLLM` from `_shared/llm.ts`. The model comes from `modelFor("CHAT", "claude-haiku-4-5")` (`LLM_MODEL_CHAT`, then the legacy `CHAT_MODEL`), with multi-turn history via `CallOpts.messages`. `max_tokens` is `suggestCap(model, 4096)` for v3 itineraries and 8192 otherwise. The stream's first event is awaited before responding, so a provider failure becomes a plain HTTP error. There is one retry on 429/5xx/overloaded.
7. **No output schema.** Measured on Haiku 4.5: the itinerary union is refused ("compiled grammar is too large"), and the brainstorm schema adds 1.5–13 s to the first word. Reliability comes from short replies plus the checks below.
8. **Streaming to the client**: the `message` string is extracted incrementally and sent as `{type:"delta"}` events. The stream ends with exactly one `{type:"final", data:{message, actions}}` or `{type:"error", error, message}`, then `[DONE]`.
9. **Unusable replies are not charged.** A reply counts as unusable if it is empty, hit `max_tokens`, or has broken JSON that carried actions. It is sent as `error` (or a 502 when not streaming) and captured to PostHog. A plain-prose answer is shown as is.
10. **v3 ops resolution** (`resolveOps`):
    - checks each operation against the context and maps refs to ids;
    - re-anchors inserts placed after a removed item;
    - turns remove + insert of the same place into a move;
    - drops invalid ops and counts them;
    - folds everything into one `{type:"activity_ops", ops, dropped}` action.
11. **Billing**: the `llm_usage` row and `deductCredits` run in `runInBackground`, so a client disconnect still lands them.

### Action vocabulary

- **Brainstorm**:
  - `update_route` (the whole route object, plus `stops`);
  - `dismiss_route` (`routeIds`);
  - `generate_more_plans`;
  - `pending_routes` (bulk edits: the first 3 inline, the rest listed).
- **Itinerary, v3**:
  - `replace_activity {ref, activity}`;
  - `insert_activity {day, after, activity}`;
  - `remove_activity {ref}`;
  - `move_activity {ref, day, after}`;
  - `set_time {ref, time}`;
  - `suggest` (alternatives, no change).

  The rules: fewest ops, don't touch what wasn't asked, refs always mean the original item, never move or remove `[booked]` items, "more relaxed" means removing 1–2 activities, use real places in the same neighbourhood, respect the departure constraint.

- **Itinerary, v2** (old clients): `update_day` (whole-day rewrite), `suggest`.
- **All screens**: `add_todo`, `add_expense`, `add_bookmark`, `set_budget`, `navigate`.

---

## 4. Applying actions (`dispatchActions`)

`dispatchActions` returns one `{type, ok, reason}` per action (plus `routeId`, `changes`, `undo`, `verify`, `deferred` where they apply). `performChatSend` builds the bubble from **what applied**, not what the model claimed.

- `hasChanges` is true only if a mutation succeeded.
- If an action failed, or some ops were dropped, the bubble says so ("I couldn't apply that change, so nothing was changed…" / "Part of that couldn't be applied").
- `trippy_action_apply {type, ok, reason}` goes to PostHog for each action.

| Action            | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activity_ops`    | `supabase.rpc("apply_activity_ops", {p_ops})` (migration `20261007000001`): SECURITY INVOKER (the user's RLS), one transaction, all or nothing. It returns `before` and `after` for every touched day. State is set from `after`; an `update_day` activity-log row is written per day with the `before` snapshot (feed undo); the change card is built by `summarizeOpsChanges`; photos warm for new rows. Replace makes a new row (the old place's coordinates and booking go); move keeps the row and all its data. Transit hints are cleared only on rows whose next stop changed. |
| `update_day` (v2) | Insert the new rows, check them, then delete the old rows **by id**. If either step fails, roll back and leave the day as it was. Kept activities (matched by title, the only thing the model saw) keep their saved place, coordinates, note and booked status. The model contributes time and order only.                                                                                                                                                                                                                                                                            |
| `update_route`    | Validated and merged outside the state updater, persisted to that one `brainstorm_items` row (awaited), then state updated. Invalid routes and persist errors report `ok:false`.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `dismiss_route`   | Marks routes dismissed (persisted) and adds an undo pill.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `pending_routes`  | Runs **after** the reply is shown (`deferred`): one follow-up chat call per remaining plan, with a toast for progress.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `suggest`         | Not dispatched; carried on the message as cards and saved in `meta`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `add_todo` etc.   | Insert or update the row. Missing fields or a failed write report `ok:false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `navigate`        | Switches tab and closes the sheet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**After the reply** (deferred, so the time to finish an edit is unchanged):

- **Place checks**: `verifyNewPlaces` runs every new place through the verify-place ladder. Verified places get coordinates and corrected names. A **conclusive miss** (Google answered and there's no such place, so likely an invention) gets a Trippy note, "I couldn't find “X” on the map…", with a one-tap **Suggest alternatives** button. This is reported as PostHog `trippy_places_verified`.
- **Undo from the change card** (`undoTrippyChange`) restores the RPC's before-snapshot (`restoreDayActivities`). If the day was edited since, it asks for confirmation first. It logs `undo` and sends PostHog `trippy_change_undone`.

---

## 5. Entry points from other features

| Source                                          | Mechanism                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| Starter chips                                   | `sendChatDirect` (auto-send)                                     |
| Activity "Suggest alternatives"                 | `sendChatDirect`, asking for alternatives without making changes |
| Activity "Ask Trippy" / Magazine "Ask Trippy"   | Prefill `Tell me about "<title>"`                                |
| Local gem "Tell me more"                        | `tellMeMoreGem`, which calls `sendChatDirect` (queued if busy)   |
| Hotel "see options"                             | `sendChatDirect`                                                 |
| Suggestion card "Know more"                     | `sendChatDirect`                                                 |
| Poll close (day poll)                           | `applyPollClose`, which calls `sendChatDirect` (queued if busy)  |
| Shared-trip "Rebalance" chip                    | `sendChatDirect`                                                 |
| Follow-up buttons (e.g. "Suggest alternatives") | `sendChatDirect(m.followUp)`                                     |

Chat history also feeds the pre-IG `extract-preferences` call.

---

## 6. Version gate and old clients

The Android APK runs its bundled web build until a Play update, so the server keeps the v2 contract for clients that don't send `protocol: 2`.

- `src/UpdateGate.jsx` blocks clients older than `app_config.min_client_build`.
- `app_config.chat_protocol1_retired` turns off v2 for older builds, which predate the gate.

Both are in RUNBOOKS.md, under "Client version gate".

## Key files

- `supabase/functions/chat/index.ts`: the endpoint (context, prompt, streaming, unusable-reply rules, billing, retired-contract switch).
- `supabase/functions/chat/_ops.ts` (+ `_ops.test.ts`): refs, op validation and resolution.
- `supabase/migrations/20261007000001_apply_activity_ops.sql`: the transactional ops RPC.
- `supabase/migrations/20261008000001_app_config.sql`, `20261008000002_trip_messages_meta.sql`.
- `supabase/functions/_shared/llm.ts`: `streamLLM`, `turnsOf`, `modelFor`.
- `src/App.jsx`: `slimChatContext`, `callUnifiedChat`, `startTrippyTurn`, `performChatSend`, `finishTrippyTurn`, `dispatchActions`, `verifyNewPlaces`, `undoTrippyChange`, `chatStarterChips`.
- `src/feed.js`: `restoreDayActivities` / `activityInsertShape` (undo keeps coordinates).
- `src/version.js`, `src/UpdateGate.jsx`: the client build number and the gate.
- E2E:
  - `chat-apply` (mocked chat, real database);
  - `activity-ops` (RPC contract);
  - `chat-streaming`, `chat-actions`, `update-gate`;
  - `chat-live` (real model; opt-in with `CHAT_LIVE=1`).
