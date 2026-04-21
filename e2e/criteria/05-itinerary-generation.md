# Itinerary Generation

1. After clicking "Build My Itinerary", screen switches to generation loading view
2. Loading screen shows the selected route card in the top section (scrollable, no max height)
3. Loading screen shows "Detailing your route" header above the route card
4. Transport emoji carousel animates below the route card
5. Progress shows "Day X of Y planned ✓" as days stream in
6. "Hold your breath..." shows when all days are planned but saving is in progress
7. If no route was selected, loading screen shows only the progress (no route card)
8. Generation errors show inline with error message
9. After generation completes, itinerary view loads with a chime sound
10. Hotels have specific named properties (e.g. "Check in at Hotel Gracery Shinjuku"), never generic "Hotel check in"
11. Day 1 activities start after the arrival ready time (arrival time + buffer)
12. Last day includes a transit activity to departure point (airport/station) as the final activity
13. Last day has no hotel check-in when departure details are set
14. Each activity has: time, title, geocode, type, duration, note, icon
15. Restaurant titles are specific place names, never generic "Lunch" or "Dinner"
16. Wishlist items (Local gems) are included per day with specific named places
17. Transit activities between cities have geocode (origin) and geocodeEnd (destination)
18. Regenerating an existing trip deletes old days/activities before inserting new ones
