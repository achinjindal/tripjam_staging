# URL Routing

## URL Schema
1. `/` renders Home page
2. `/new` renders Setup wizard at step 0
3. `/trip/:id` renders Itinerary view for that trip (loads trip from DB by ID)
4. `/trip/:id/plans` renders Plans/brainstorm page for that trip
5. `/trip/:id/magazine` renders Magazine tab for that trip
6. `/trip/:id/map` renders Map tab for that trip
7. `/trip/:id/board` renders Board tab for that trip
8. `/trip/:token` (UUID format) renders public shared view without auth

## URL Updates
9. Clicking "New Trip" on Home pushes `/new`
10. Clicking a trip card on Home pushes `/trip/:id`
11. Clicking "Edit trip" / pencil on Home pushes `/trip/:id/plans`
12. Switching bottom nav tabs updates URL (e.g. Magazine → `/trip/:id/magazine`)
13. Switching to Itinerary tab updates URL to `/trip/:id` (no suffix)
14. Navigating to Plans page pushes `/trip/:id/plans`
15. Going Home pushes `/`

## Browser Navigation
16. Browser back button returns to previous screen (not previous website)
17. Browser forward button goes forward after back
18. Refreshing on `/trip/:id` stays on that trip's itinerary
19. Refreshing on `/trip/:id/plans` stays on that trip's plans
20. Refreshing on `/new` stays on setup wizard
21. Refreshing on `/` stays on Home

## Deep Links
22. Pasting `/trip/:id` in a new tab loads that trip directly (after login)
23. Pasting `/trip/:id/magazine` opens that trip's Magazine tab
24. Pasting a non-existent trip ID redirects to `/`
25. Pasting `/trip/:token` (UUID) shows public view without login

## State Management
26. No localStorage `LAST_TRIP_KEY` or `LAST_SCREEN_KEY` used — URL is source of truth
27. `parseUrl()` correctly parses all URL patterns
28. `pushUrl()` only pushes if path actually changed (no duplicate history entries)
29. `initialTab` prop is passed from main.jsx to App.jsx and used for bottom nav tab

## Edge Cases
30. Opening `/trip/:id` when not logged in shows Auth screen, then loads trip after login
31. Multiple rapid tab switches don't create excessive history entries
32. "Explore Other Plans" button pushes `/trip/:id/plans`
