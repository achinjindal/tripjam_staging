# Itinerary View & Navigation

1. Itinerary header shows trip name, date range, and traveler count
2. City pill strip at top shows hotel cities with day ranges (e.g. "Tokyo Day 1–3")
3. Clicking a city pill scrolls to the correct day — day header aligns at top of visible area
4. Sticky day headers show: day label, city, date, activity count, route link
5. Each activity card shows: time, icon, title, duration, note
6. Hotel activity cards show "Check in at [Hotel Name]" with hotel-specific options
7. Transit activities show origin → destination with duration
8. Transition rows between activities show commute time and transport mode
9. "To hotel" transition appears at end of day — except on last day with departure
10. "To departure" transition appears on last day when departure details are set
11. Arrival timeline shows on Day 1 with arrival time and ready time
12. Departure timeline shows on last day
13. Wishlist section ("Local gems on the way") is collapsible, shows spot count
14. Each wishlist item links to Google Maps
15. Activity photos load progressively (shimmer → photo or collapse)
16. If a stored photo URL fails to load, it retries with fresh Wikipedia/Commons fetch
17. Bottom navigation shows: Magazine, Itinerary, Map, Board tabs
18. "Trips" button returns to Home
19. "Edit trip" button goes to Routes page with saved routes

## Transitions & Geocoding Integrity
20. No transition should show "1 min walk" for all activities in a day — indicates duplicate geocodes
21. Activities within a trip should have distinct geocode values — never the generic city/park/region name for all
22. Stale stored transition values (1 min) are recalculated on page load, not trusted
23. Map always re-geocodes via server (does not trust stale stored lat/lng on activities)
24. Photo search uses place name from title (via extractPlace), not the geocode field (which may be a street address)
