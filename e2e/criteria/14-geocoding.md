# Geocoding

## Fallback Chain
1. Geocode requests go through places-proxy `action=geocode`
2. Server checks DB cache first (permanent for hits, 1-day TTL for misses)
3. Photon (free) is tried with two strategies: full query commas→spaces, then first-segment + city
4. No Google fallback — Photon is the only geocoder. If Photon fails, result is a cached miss.
5. Commas in geocode queries are handled — not passed raw to Photon

## Caching
6. Successful geocode results are cached permanently in place_cache (no expiry)
7. Failed geocode results (misses) are cached with 1-day TTL — retried next day
8. Client does NOT cache null results in memory — retries on every page view
9. Client caches successful results in memory (_geocodeCache) for the session
10. City is not appended to query if already contained in the query string

## Accuracy (query DB to verify)
11. No geocode cache entries should have source="miss" for well-known landmarks (Forbidden City, Eiffel Tower, Taj Mahal, etc.)
12. No geocode cache entries should resolve to wrong city — verify by spot-checking lat/lng against expected city coordinates
13. All geocode cache entries for a given trip's activities should cluster within the trip's destination region

## Tracking
14. api_usage table tracks: geocode/cache-hit, geocode/photon, geocode/miss — all per day
15. place_cache entries record source (photon, miss) for each geocode lookup

## Accuracy
16. Photon results are validated against city bias coordinates — rejected if >1000km away
17. City bias is derived from query segments in reverse order (broadest last segment first, e.g. "Beijing" from "CCTV Tower, CBD, Chaoyang, Beijing")
18. Photon search uses lat/lon bias parameters for proximity-aware results
