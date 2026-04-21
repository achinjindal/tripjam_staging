# Map View

1. Map tab shows in bottom nav for both pre-trip and post-trip
2. Pre-trip map shows route cities as pins
3. Post-trip map shows activity pins for the active day
4. Pins use geocodePlace() to resolve activity geocode to lat/lng coordinates
5. Geocode results are cached in-memory (_geocodeCache)
6. Map uses Mapbox tiles with OpenStreetMap attribution
7. Activity pins are color-coded by day
8. Clicking a pin shows activity details
