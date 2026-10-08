# Chat ("Trippy")

Spec references: `e2e/chat-apply.spec.ts`, `chat-fixes.spec.ts`, `chat-streaming.spec.ts`, `chat-actions.spec.ts`, `activity-ops.spec.ts`, `update-gate.spec.ts`, `chat-live.spec.ts` (`CHAT_LIVE=1`). Behaviour is described in `docs/user-journeys/08-chat.md`.

## Entry and empty state

1. Chat appears on the itinerary and brainstorm screens: inline on desktop, a collapsed bar plus sheet on mobile (Esc closes it).
2. The greeting matches the stage (plans being made / plans ready / itinerary building / itinerary ready).
3. Starter chips name only things that exist (plan labels, the real hotel, the busiest real day), are hidden while generating, and **send on tap**.
4. The collapsed bar shows Trippy's last reply, or a placeholder that doesn't change between renders.

## Sending and replies

5. Streamed words appear before the reply completes; cards render after it.
6. While waiting: "Trippy is thinking"; while applying an edit: "Updating your itinerary…".
7. The reply fills **its own** bubble, even if undo rows or other messages were added meanwhile.
8. Messages sent while Trippy is replying (chips, gem taps, poll closes) are queued, not dropped: at most 3, no duplicates.
9. An unusable reply (server `error` event) shows the server's message, changes nothing, is not saved, and is not charged.
10. Error bubbles are not saved and are not sent back to the model as history.
11. A 402 opens the paywall; a 429 says to slow down; other failures show a reason.
12. Requests carry `protocol: 2`, `client_build`, and the slim context (under 30 KB, no `ig_response`, `magazine_digest` or photo URLs).

## Itinerary edits (v3)

13. Edits arrive as one `activity_ops` action and apply all-or-nothing through `apply_activity_ops`.
14. A failed batch leaves the day unchanged and the bubble says nothing was changed.
15. Partially dropped ops: the rest apply and the bubble says part couldn't be applied.
16. Moved and untouched activities keep their saved data (coordinates, note, booked status). Untouched rows keep their ids.
17. The change card lists added / removed / swapped / moved / retimed items.
18. Undo on the card restores the day exactly (same ids and times). The card is saved in `meta` and shows after a reload, without the Undo button.
19. Each touched day gets an `update_day` activity-log row whose undo snapshot includes coordinates (no `wishlist` key).
20. New places are checked in the background. Verified ones get coordinates. A conclusive miss gets a Trippy note with a "Suggest alternatives" button that sends the follow-up.
21. An insert or replace naming a place already in the trip is skipped, and the bubble names it ("… is already in your trip").

## Worth a look (proactive fixes)

22. A built itinerary with a booked-leg clash, an arrival or departure clash, a repeated restaurant, an overlap or a long ride shows up to 3 fixes, at most one per day, under the greeting (empty chat) or at the end of the thread.
23. Tapping a fix sends its request to Trippy as a normal message and hides the fix for the session.
24. × hides a fix for this viewer across reloads.
25. Placeholder arrival/departure times (12:00 / 19:00) and hotel meals never produce a fix.

## v2 contract (old clients)

26. `update_day` keeps kept activities' saved data (title match), inserts before deleting, and rolls back on failure.

## RPC contract (`apply_activity_ops`)

27. Several inserts after the same anchor keep their order; inserting after null puts the item at the start of the day.
28. Replace creates a new row in the same slot (place data and booking cleared).
29. Move across days renumbers both days; a removed row's day is renumbered.
30. A transit hint is cleared only on rows whose next activity changed.
31. Any invalid op (unknown id, anchor on another day) rolls back the whole batch; unknown ids are errors, never silent no-ops.

## Version gate

32. A web build older than `min_client_build.web` sees a blocking "Update TripJam" screen with Reload; the config message overrides the default text.
33. No gate when the minimum is 0 or in the past, when only Android's minimum is raised, or when the config read fails (fails open).
