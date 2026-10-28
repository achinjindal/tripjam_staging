/* global Deno */
// Unit tests for the destination-search filter. Run: npm run test:functions
// Fixtures are real Google autocomplete results (types trimmed), 2026-10-28.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { keepDestinationLike } from "./destinationSuggest.js";

const g = (text, types) => ({ placePrediction: { text: { text }, types } });
const texts = (items) => items.map((it) => it.placePrediction.text.text);

Deno.test("tokyo: keeps the prefecture, drops the mall and arenas", () => {
  const out = keepDestinationLike([
    g("Tokyo, Japan", ["administrative_area_level_1", "geocode", "political"]),
    g("LaLaport TOKYO-BAY", ["establishment", "shopping_mall"]),
    g("Keio Arena Tokyo", ["establishment", "event_venue", "arena"]),
    g("Zepp Haneda Tokyo", ["event_venue", "live_music_venue"]),
  ]);
  assertEquals(texts(out), ["Tokyo, Japan"]);
});

Deno.test(
  "keeps colloquial areas and natural features (regions filter drops them)",
  () => {
    const out = keepDestinationLike([
      g("Amalfi Coast, SA, Italy", ["geocode", "political", "colloquial_area"]),
      g("Amalfi Coast Italian + Wine Bar", ["restaurant", "food"]),
      g("Lake Como, Italy", ["natural_feature", "establishment", "lake"]),
      g("Phi Phi Islands", ["island", "establishment", "natural_feature"]),
      g("Phi Phi CoCo Beach Resort", ["lodging", "hotel", "resort_hotel"]),
    ]);
    assertEquals(texts(out), [
      "Amalfi Coast, SA, Italy",
      "Lake Como, Italy",
      "Phi Phi Islands",
    ]);
  },
);

Deno.test(
  "keeps landmarks and parks, drops namesake businesses and streets",
  () => {
    const out = keepDestinationLike([
      g("Machu Picchu, Peru", ["historical_place", "tourist_attraction"]),
      g("Machu Picchu, Lima, Peru", ["route", "geocode"]),
      g("Angkor Wat, Krong Siem Reap", ["landmark", "place_of_worship"]),
      g("Angkor Wat, Berlin", ["restaurant", "cambodian_restaurant"]),
      g("Banff National Park", ["national_park", "park"]),
    ]);
    assertEquals(texts(out), [
      "Machu Picchu, Peru",
      "Angkor Wat, Krong Siem Reap",
      "Banff National Park",
    ]);
  },
);

Deno.test(
  "nothing destination-like: falls back to Google's list, never empty",
  () => {
    const items = [g("Some Resort", ["lodging"]), g("Untyped", undefined)];
    assertEquals(keepDestinationLike(items), items);
    assertEquals(keepDestinationLike(undefined), []);
  },
);
