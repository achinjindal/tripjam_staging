# 08 — Chat ("Trippy")

TripJam has a single unified chat assistant ("Trippy") that works on both the brainstorm (route-planning) and itinerary screens. The frontend sends the current screen plus a snapshot of routes/days/form to one edge function (`supabase/functions/chat/index.ts`), which calls Sonnet 4.6 with a screen-specific action vocabulary and returns `{message, actions[]}` as a single JSON payload. `App.jsx` renders the message and executes each action against local state and Supabase tables (routes, days/activities, todos, expenses, bookmarks, budget, tab navigation). Despite the edge function consuming Anthropic's SSE stream internally, the client sees a **non-streaming** response — the "typing" cursor in the UI is cosmetic.

---

## 1. Where the chat lives (frontend UI)

All chat code is in `src/App.jsx` — there is no separate chat component.

**State** (`src/App.jsx:7128-7134`):

- `chatMessages` — array of `{role, content, user_id?, suggestions?, hasChanges?, changedRouteIds?, streaming?, undoData?}`. Roles: `user`, `assistant`, and a synthetic `system-undo` (undo pills, never sent to the LLM).
- `chatInput`, `chatLoading`, `chatOpen` (`src/App.jsx:6840`), `chatUnread`, `chatAttention` (mascot pulse).

**Persistence/load**: on trip load, messages are fetched from the `trip_messages` table ordered by `created_at` (`src/App.jsx:7157-7178`); if the DB returns nothing but local messages already exist (e.g. user chatted during IG before the trip row settled), local state is kept. Every user and assistant message is inserted into `trip_messages` fire-and-forget (`src/App.jsx:9166`, `9218`; same in `sendChatDirect` at `8740`, `8784`). `system-undo` rows are local-only.

**Layout** — two shells:

- **Mobile (collapsed)**: a persistent chat bar sits above the bottom nav on `itinerary` and `brainstorm` screens, hidden on the Board tab (`src/App.jsx:12538-12650`). It shows the mascot (pulses via `chatAttention` after IG completes — `src/App.jsx:8506-8508`) and a fake-input preview showing the last assistant message or a screen-aware placeholder from `getChatPlaceholder()` (`src/App.jsx:7135-7147`). Tapping opens the sheet.
- **Mobile (open)**: bottom sheet — 50dvh on brainstorm (no scrim, touches pass through to route cards), 85dvh with scrim on itinerary (`src/App.jsx:13595-13666`).
- **Desktop** (`useDesktopShell`): chat is always rendered inline in the `right-bottom` grid cell; the collapsed bar and close button are hidden (`src/App.jsx:13595-13610`, `13736`).

**Per-tab behavior**: chat renders only when `screen === "itinerary" || screen === "brainstorm"` and `activeBottomTab !== "board"` (`src/App.jsx:13595-13597`) — there is no chat on the Board tab or setup wizard. The behavioral difference between brainstorm and itinerary is driven server-side by the `screen` field in the request (different action vocabulary, see §3), plus different empty-state greetings and suggested-prompt chips client-side (`src/App.jsx:13798-13837`).

**Empty state**: a canned greeting bubble plus 3 suggested-prompt chips — brainstorm gets route-tweak prompts ("Reduce hotel switches in P2", …), itinerary gets prompts derived from the actual Day 1 hotel and destination (`src/App.jsx:13815-13837`). Chips prefill `chatInput` and focus the textarea; they do not auto-send.

**Message rendering**: `renderMentions()` handles `**bold**`, `_italic_`/`*italic*`, and `@mention` highlighting (`src/App.jsx:8673`). Assistant messages that mention itinerary activity names get up to 3 Google Maps link-out pills appended (`src/App.jsx:14045-14118`). Messages with mutation actions get a "View Updated Itinerary" / "View Updated Plans" CTA that closes chat and scrolls to the changed route (`src/App.jsx:14173-14215`).

---

## 2. Sending a message

Two paths, near-identical:

- `sendChatMessage()` (`src/App.jsx:9142-9226`) — user typed into the textarea (Enter sends, Shift+Enter newline — `src/App.jsx:14245-14250`). Captures PostHog `chat_message_sent` with `screen` and message length.
- `sendChatDirect(message)` (`src/App.jsx:8725-8790`) — programmatic sends from other features (see §6).

Both: build `history` = `chatMessages` minus `system-undo` rows; optimistically append the user message **and** a placeholder `{role:"assistant", content:"", streaming:true}` (renders as "···" — `src/App.jsx:14024-14027`); insert the user row into `trip_messages`; then call `callUnifiedChat()`.

`callUnifiedChat(message, history)` (`src/App.jsx:9109-9140`) POSTs to `/functions/v1/chat` with the user's Supabase access token and body:

```js
{
  (screen,
    trip,
    routes /* non-dismissed pretripRoutes */,
    days /* daysRef.current */,
    form /* pendingForm */,
    message,
    history);
}
```

- **402 handling**: `if (res.status === 402) { openPaywall("Chatting with Trippy needs credits."); throw ... }` (`src/App.jsx:9132-9135`). Note chat calls `openPaywall` directly rather than the `handleGatedResponse` wrapper used elsewhere — same end result (paywall bottom sheet via `credits.js`).
- On success, `refreshCredits(session.user.id)` updates the credit balance store (`src/App.jsx:9138`).
- Any error (including 402) is caught by the caller; the placeholder message is replaced with `"Sorry, something went wrong. (<err>) Try again."` (`src/App.jsx:9201-9204`). There is no retry.

The response is a single JSON body — the client does **not** consume a stream. `await res.json()` at `src/App.jsx:9137`.

---

## 3. Server processing (`supabase/functions/chat/index.ts`)

Request pipeline, in order:

1. **Kill switch** — `llmKillSwitch()` returns 503 if `LLM_KILL_SWITCH=true` (`index.ts:27`, helper at `_shared/credits.ts:209`).
2. **Auth** — `authenticateUser(req)` verifies the bearer token and loads the profile's credit balance (`index.ts:30`, `_shared/credits.ts:94`). 401 on failure.
3. **Credit pre-flight** — `user.credits < 1.0` → 402 via `outOfCredits()` (`index.ts:34`); the 1.0 floor prevents overdraw at the boundary.
4. **Rate limit** — `rateLimit(user.id, ...)`: 20 calls/min/user via `incr_rate_limit` RPC, fail-open, 429 with `Retry-After: 60` when exceeded (`index.ts:36`, `_shared/credits.ts:161`).
5. **Context building** (`index.ts:39-112`): `screen` selects `isBrainstorm`/`isItinerary`. Routes are serialized as `PLAN P1 (id="...") — title / cities / days / points`; days as `Day N - City: time title, ...` plus local gems; arrival/departure logistics and form preferences (destinations, month, duration, travelers, budget, notes) are appended.
6. **System prompt, split for caching** (`index.ts:114-224`): `staticInstructions` (identity "Trippy", the screen-specific action vocabulary, response rules, examples) is sent as a system block with `cache_control: {type:"ephemeral"}`; the per-request `dynamicContext` (trip/routes/itinerary snapshot) is a second, uncached system block (`index.ts:256-263`). The static block only varies by screen, so it's reused across every turn of a conversation. Request includes `anthropic-beta: prompt-caching-2024-07-31` (`index.ts:272`).
7. **History hygiene** (`index.ts:227-249`): drop empty/streaming messages, merge consecutive same-role messages, drop a leading assistant message, then **cap to the last 6 messages** (`index.ts:248`) before appending the new user message.
8. **Model call** (`index.ts:251-265`): `claude-sonnet-4-6`, `max_tokens: 8192`, `stream: true`, direct `fetch` to `api.anthropic.com/v1/messages`.
9. **Server-side stream accumulation** (`index.ts:283-312`): the SSE stream is read line-by-line; `text_delta` chunks are concatenated into `accumulated`, and real token usage (including cache read/write) is captured from `message_start`/`message_delta` events via `accumulateStreamUsage` (`_shared/credits.ts:277-336`). Nothing is streamed to the client — streaming is used only to get real usage events and avoid long-response timeouts.
10. **Billing + logging** (`index.ts:324-359`): wrapped in `runInBackground()` so the Deno isolate survives past the response — inserts an `llm_usage` row (`function_name: "chat"`, model, input/output/cache tokens, trip_id) and calls `deductCredits`. Credits = `ceil((usd / 0.007) * 100) / 100` with cache-write at 1.25× and cache-read at 0.10× input rate (`_shared/credits.ts:52-72`). Token counts fall back to `length/4` estimates only if usage events never arrived (`index.ts:316-322`).
11. **Parsing/validation** (`index.ts:361-369`): extract the substring between the first `{` and last `}` and `JSON.parse` it. On parse failure the raw accumulated text becomes `data.message` (no actions). A missing `message` defaults to `"Done."`. Individual actions are **not** schema-validated server-side — the dispatcher tolerates bad payloads (§5).
12. **Backwards compat** (`index.ts:371-396`): legacy `updatedRoutes`/`pendingRoutes` and `updatedDays`/`suggestions` top-level fields are converted into `update_route`/`pending_routes` and `update_day`/`suggest` actions if `actions` is absent.
13. Response: `{message, actions?}` JSON with CORS headers. Errors return 500 with `{error, message:"Sorry, something went wrong."}` (`index.ts:401-413`).

### The action contract (what the LLM is told)

The prompt defines actions per screen (`index.ts:128-217`):

- **Brainstorm-only**: `update_route` (must return the _entire_ route object with original id, full day strings, points as `{text, good}`, preserve trip duration), `dismiss_route` (single `routeId` or bulk `routeIds`), `generate_more_plans`.
- **Itinerary-only**: `update_day` (full day object keyed by exact `label`; real place names, recalculated times, `wishlist` of 3-5 gems, only changed days, departure-time constraint), `suggest` (alternatives without mutation; hotel suggestions add `area`, `price`, `bullets`).
- **All screens**: `add_todo`, `add_expense`, `add_bookmark`, `set_budget`, `navigate`.
- **Brainstorm bulk-edit protocol**: when modifying _all_ plans, return the first 3 as `update_route` actions plus `{"type":"pending_routes","routeIds":[...]}` for the rest (`index.ts:205`) — the app fans out follow-up calls (see table).

Response rules: raw JSON only, message ≤ 2-3 sentences of plain prose (bold/italics OK, no markdown headers/lists), "ACTION BIAS" (do the change, don't ask), honesty rule (never claim an untaken action), refer to plans as P1/P2 (`index.ts:196-205`).

---

## 4. Actions applied client-side

Back in `sendChatMessage`/`sendChatDirect` (`src/App.jsx:9179-9199` / `8751-8765`):

- `suggest` actions are pulled out and attached to the assistant message as `suggestions` (rendered as horizontally scrolling `SuggestionCard`/`HotelSuggestionCard` — `src/App.jsx:14120-14172`; cards offer "Use ..." which prefills the input, and "know more" which fires another `sendChatDirect`).
- Any non-`suggest` action sets `hasChanges` (drives the "View Updated ..." CTA); `update_route` ids are collected into `changedRouteIds` for scroll-to-card.
- `dispatchActions(actions, userMsg, history)` (`src/App.jsx:8792-9107`) then executes every action sequentially.

Finally the placeholder assistant bubble is replaced with the real content, `chatLoading` clears, and the assistant row is persisted to `trip_messages`.

### Action dispatch table

| Action type           | Payload                                                                                                      | Local state effect                                                                                                                                                                                                                                                  | DB effect                                                                                                                                                                               | Notes / validation                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `update_route`        | `{route: {id, title, tagline, tier, category, icon, city, days[], bestFor, warning, recommended, points[]}}` | Merges into `pretripRoutes` by id; selects the route (`setPretripSelectedRouteId`). Malformed results (empty/short day strings, missing title) get an `_error` flag rendered as "try editing this plan again in chat" on the card (`src/App.jsx:8804-8817`, `1562`) | Delete-all + re-insert of `brainstorm_items` for the trip, async, warn-on-fail (`src/App.jsx:8820-8853`)                                                                                | Skipped if `route.id` missing (`8799`)                                                    |
| `dismiss_route`       | `{routeId}` or `{routeIds: [...]}` (bulk)                                                                    | Marks matching routes `dismissed: true`; appends a `system-undo` chat pill ("N plans dismissed.") (`src/App.jsx:8859-8894`)                                                                                                                                         | `brainstorm_items.update({dismissed:true})` per id, skipping `temp_` ids (`8869-8876`)                                                                                                  | Undo pill calls `undoDismissRef.current(rid)` per id (`src/App.jsx:13869-13883`)          |
| `generate_more_plans` | `{}`                                                                                                         | Fires `triggerRgRef.current({addMore: true})` — the imperative RG trigger in BrainstormView (`src/App.jsx:8896-8899`, ref at `7216`)                                                                                                                                | RG edge function generates additional routes                                                                                                                                            | —                                                                                         |
| `update_day`          | `{day: {label, city, activities[], wishlist[]}}`                                                             | Replaces the matched day's activities + wishlist in `days` state; preserves existing photos by geocode; fetches Wikipedia photos for new non-transit activities async (`src/App.jsx:8961-9006`)                                                                     | Delete + re-insert of `activities` rows for the day (count-checked: if RLS blocked the delete, insert is skipped to avoid duplicates — `src/App.jsx:8912-8929`); `days.wishlist` update | Skipped if `label` missing or no matching day (case-insensitive label match, `8903-8909`) |
| `suggest`             | `{suggestions: [{title, geocode, note, icon, type, area?, price?, bullets?}]}`                               | No dispatch — carried on the message and rendered as suggestion cards (`src/App.jsx:9009-9011`, `14134-14170`)                                                                                                                                                      | none                                                                                                                                                                                    | Hotel type gets `HotelSuggestionCard`                                                     |
| `pending_routes`      | `{routeIds: [...]}`                                                                                          | For each id, issues a follow-up `callUnifiedChat("Apply the same change to route id=...")` and dispatches its actions — sequential fan-out for bulk route edits (`src/App.jsx:9013-9031`)                                                                           | via resulting `update_route` dispatches                                                                                                                                                 | Each follow-up is a separately billed chat call; failures warn and continue               |
| `add_todo`            | `{text, category?, due_date?}`                                                                               | none (Board reloads from DB)                                                                                                                                                                                                                                        | Insert into `trip_todos` (`src/App.jsx:9033-9045`)                                                                                                                                      | Skipped without trip id or `text`                                                         |
| `add_expense`         | `{title, amount, currency?, category?, is_planned?}`                                                         | none                                                                                                                                                                                                                                                                | Insert into `trip_expenses`, defaults USD / "Other" / planned (`src/App.jsx:9047-9062`)                                                                                                 | Skipped without `title` or `amount`                                                       |
| `add_bookmark`        | `{title, url}`                                                                                               | none                                                                                                                                                                                                                                                                | Insert into `trip_bookmarks` with 🔗 icon (`src/App.jsx:9064-9077`)                                                                                                                     | Skipped without `title` or `url`                                                          |
| `set_budget`          | `{amount}`                                                                                                   | none                                                                                                                                                                                                                                                                | `trips.update({budget_amount})` (`src/App.jsx:9079-9087`)                                                                                                                               | Skipped without `amount`                                                                  |
| `navigate`            | `{tab: "magazine"\|"itinerary"\|"map"\|"board"}`                                                             | Switches `pretripTab` (brainstorm screen) or `activeBottomTab` (itinerary screen) and closes the chat sheet (`src/App.jsx:9089-9103`)                                                                                                                               | none                                                                                                                                                                                    | Unknown tabs are no-ops                                                                   |

Unknown action types fall through the `switch` silently. Error handling is per-action (guard clauses + `console.warn`); a failed action never aborts the message or the remaining actions.

---

## 5. Streaming, billing, gating — summary of what's verified

- **Not streamed to the client.** The edge function requests `stream: true` from Anthropic but accumulates the full response server-side and returns one JSON body (`index.ts:254`, `283-312`, `398`). The frontend's `streaming: true` placeholder and blinking cursor (`src/App.jsx:14024-14043`) are a loading affordance only.
- **Billing**: `llm_usage` insert + `deductCredits` run post-response via `runInBackground` (`index.ts:328-359`); real cache-aware token counts from stream events, length-estimate fallback.
- **Gating**: 402 pre-flight when balance < 1.0 credit → frontend `openPaywall("Chatting with Trippy needs credits.")` (`src/App.jsx:9132-9134`) → `CreditsOverlay` bottom sheet.
- **History cap**: last 6 messages (`index.ts:248`); prompt caching keeps the large static instruction block at 0.10× input cost across turns.

---

## 6. Chat entry points from other features

All of these open the sheet and either prefill `chatInput` (user completes and sends) or fire `sendChatDirect` (auto-sends):

| Source                                     | Mechanism                                                                                                       | Reference                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Route card "Modify Pn" (brainstorm)        | Prefill `Modify P2: `                                                                                           | `src/App.jsx:10343-10348`                                              |
| Route card dismiss (manual, non-chat)      | Adds a `system-undo` pill to chat                                                                               | `src/App.jsx:10349-10359`                                              |
| Activity "Replace"                         | Prefill `Replace "<title>" with `                                                                               | `src/App.jsx:11776-11784`                                              |
| Activity "Suggest alternatives"            | Auto-send asking for 2-3 alternatives "without making any changes yet" (yields a `suggest` action)              | `src/App.jsx:11785-11791`                                              |
| Local gem "Add to itinerary"               | Auto-send add request + soft-dismisses the gem with an undo pill (`dismissGemPersist`, `src/App.jsx:8705-8723`) | `src/App.jsx:11792-11803`                                              |
| Hotel "Change" (own booking / see options) | Prefill or auto-send hotel-options request                                                                      | `src/App.jsx:11811-11835`                                              |
| Magazine cards "Ask Trippy"                | Prefill `Tell me about "<title>"`                                                                               | `src/App.jsx:10521-10529`, `11168-11177`, `11919-11928`, `11989-11995` |
| Suggestion card "know more"                | Auto-send detail request                                                                                        | `src/App.jsx:14146-14167`                                              |
| Empty-state prompt chips                   | Prefill, screen-specific                                                                                        | `src/App.jsx:13815-13862`                                              |
| IG completion                              | Sets `chatUnread` + pulses the mascot (`chatAttention`)                                                         | `src/App.jsx:8499-8508`                                                |

Chat history also feeds **out** of chat: the pre-IG `extract-preferences` call sends `chatHistory` (minus undo rows) so preferences mentioned in conversation influence itinerary generation (`src/App.jsx:6817`).

---

## Key files

- `supabase/functions/chat/index.ts` — the entire chat edge function (auth → context → prompt → stream-accumulate → bill → parse → legacy shim).
- `supabase/functions/_shared/credits.ts` — `authenticateUser`, `outOfCredits` (402), `rateLimit` (20/min), `deductCredits`, cache-aware cost math, `StreamUsage` helpers, `runInBackground`.
- `src/App.jsx` — chat state (`7128-7178`), placeholder logic (`7135`), `sendChatDirect` (`8725`), `dispatchActions` (`8792-9107`), `callUnifiedChat` + 402 paywall (`9109-9140`), `sendChatMessage` (`9142`), collapsed bar (`12538`), chat sheet + message rendering + undo pills + suggestion cards (`13595-14294`).
- `src/credits.js` — `openPaywall`, `refreshCredits` (module-level store behind the paywall flow).
- `src/CreditsOverlay.jsx` — the paywall bottom sheet opened on 402.
