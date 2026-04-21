# Chat (FAB & Bottom Sheet)

## FAB (Floating Action Button)
1. Mascot FAB appears on itinerary and brainstorm screens
2. FAB is draggable with edge-snap behavior (snaps to left or right edge)
3. Tapping FAB opens chat bottom sheet
4. FAB shows unread indicator when there are new messages

## Chat - Route Context (Pre-IG)
5. Chat in brainstorm mode has write access to modify routes
6. Routes are labeled R1–R4 — chat references them by label
7. Chat can modify route details (add cities, change days, swap activities)
8. Modified routes update in the UI after chat response
9. Route count stays at exactly 4 — chat cannot add or remove routes
10. Trip duration preserved unless user explicitly asks to change it
11. Chat welcome message appears on first open in brainstorm

## Chat - Trip Context (Post-IG)
12. Chat in itinerary mode can answer questions and suggest changes
13. Hotel suggestion cards show photo (TripAdvisor), price, area, bullets
14. Hotel suggestion card photo area collapses when no photo found
15. "Use this" on hotel suggestion replaces the hotel in the itinerary
16. Activity suggestion cards show photo (Wikipedia) and details
17. Suggestion card photo area collapses when no photo found
18. Chat messages persist in DB (trip_messages table)
19. Chat welcome message appears after first IG generation

## Chat UI
20. Chat input auto-resizes as user types
21. Chat header shows mascot image and contextual subtitle
22. Chat messages survive page refresh (loaded from DB)
