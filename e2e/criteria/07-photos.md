# Photo System

## Sources & Fallback Chain
1. Non-hotel photos: Wikipedia T1 (exact title) → T2 (city stripped) → T3 (full-text search) → T4 (Wikimedia Commons) → collapse
2. Hotel photos: TripAdvisor (via hotel-photo endpoint) → Google Places fallback → collapse
3. No emoji placeholders (🏨, 📍) should ever render — photo area collapses when no photo found

## Wikipedia Photo Quality
4. BAD_PATTERNS filter blocks: SVG, PDF, maps, flags, logos, icons, emblems, panoramas, regulations
5. Portrait filter blocks: headshots, mugshots, coat of arms
6. T3 (Wikipedia search) accepts top 2 results without title relevance check but still checks filename relevance
7. Duplicate photos are not shown — each URL is used only once across the itinerary

## TripAdvisor Hotels
8. Hotel photos are fetched via `places-proxy?action=hotel-photo` endpoint
9. TripAdvisor results are cached in DB for 30 days
10. TripAdvisor rate limits enforced: 1,000 calls/day, 4,900 calls/month
11. Each hotel lookup costs 2 TripAdvisor API calls (search + photos)
12. When TripAdvisor limits exhausted or hotel not found, photo area collapses (no Google fallback)
13. No Google Places photo calls — zero Google photo charges

## Performance
15. Photo fetch queue allows 3 concurrent requests with 200ms stagger (not serial 800ms)
16. Broken stored photo URLs trigger fresh fetch via onError handler
17. Photos are saved to activities table in DB after first fetch

## Non-Hotel Photo Sources
18. Google Places `action=photo` endpoint is removed — never called for non-hotel photos
19. Google Places `action=validate` endpoint is removed — never called

## Success Rate (query DB to verify)
20. place_cache: No geocode entries with source="miss" should exist for places in known travel destinations (query: `SELECT key FROM place_cache WHERE action='geocode' AND source='miss'`)
21. place_cache: No geocode entries should have null lat/lng in result (query: `SELECT key FROM place_cache WHERE action='geocode' AND result->>'lat' IS NULL`)
22. place_cache: No geocode entries should resolve to wrong continent — lat/lng should be within ~5 degrees of expected city coordinates
23. Photon two-strategy search: first tries commas→spaces, then first-segment + city as fallback
24. Geocode miss cache uses 1-day TTL (not permanent) — retries next day
25. Client does not cache null geocode results in memory — always retries on next view
