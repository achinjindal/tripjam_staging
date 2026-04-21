# Cost Optimization & API Usage

## Autocomplete
1. Autocomplete queries ≤4 chars are cached in DB (place_cache table)
2. Cache hit returns instantly without calling Google
3. Cache miss calls Google then saves result in background (fire-and-forget)
4. Queries >4 chars go directly to Google (no caching overhead)

## Geocoding
5. Geocode uses Google Text Search currently (to be replaced with Photon + Geocoding API fallback)
6. Geocode results are cached in-memory per session

## Photos
7. No Google API calls for non-hotel photos — only Wikipedia and Wikimedia Commons
8. Hotel photos use TripAdvisor with DB cache (30-day TTL)
9. place_cache table stores cached results with optional expiry
10. api_usage table tracks TripAdvisor daily/monthly counts and Google photo caps

## Validation
11. Food validation is removed — no validate API calls
12. Hotel validation is removed — no validate API calls
13. Wishlist validation is removed — no validate API calls
14. IG prompt no longer requests "alternatives" for food activities

## Dead Code
15. places-proxy has no `action=photo` handler (removed)
16. places-proxy has no `action=validate` handler (removed)
17. App.jsx has no references to `action=validate`
18. App.jsx has no references to `action=photo` (only `action=hotel-photo` for hotels)
