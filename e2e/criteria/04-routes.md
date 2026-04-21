# Route Generation & Selection

1. After setup, user lands on Routes page showing "Shape your trip" header
2. A spinning loader overlay shows while routes are being generated
3. Routes stream in progressively as they're generated (cards appear one by one)
4. Spinner disappears only when generation is complete (button shows "Select a route to continue")
5. Exactly 4 route cards are generated, labeled R1 through R4
6. Each route card shows: title, tagline, icon, day-by-day outline, salient points, bestFor badge, warning badge
7. One route is marked with "★ Recommended" badge
8. Points show ✓ (green) for positive and ✗ (amber) for negative — no duplicate checkmarks in text
9. Days are descriptive strings (e.g. "Colombo → Galle (2.5h drive)"), never numbers or placeholders
10. Clicking a route card selects it (radio-style — only one selected at a time)
11. "Build My Itinerary →" button is disabled until a route is selected
12. "Edit details" button returns to setup form with data preserved
13. Back button from Routes on a draft trip returns to Home
14. Back button from Routes on an edit goes back to Itinerary
15. Route cards with errors show red border and error banner
16. Routes are saved to DB (brainstorm_items table) when a draft trip exists
17. Editing a completed trip loads previously saved routes from DB
18. Editing a completed trip reuses the same trip ID (no duplicate trips created)
