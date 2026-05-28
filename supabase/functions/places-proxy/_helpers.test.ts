// Unit tests for the pure helpers in _helpers.ts. Run with:
//   deno test --no-lock supabase/functions/places-proxy/_helpers.test.ts

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  HOTEL_CHAIN_RE,
  GENERIC_NAME_RE,
  RISKY_NAME_RE,
  normalizeName,
  nameSimilarity,
  haversineKm,
  validateGoogleResult,
} from "./_helpers.ts";

Deno.test("HOTEL_CHAIN_RE catches well-known chains", () => {
  assert(HOTEL_CHAIN_RE.test("The Westin Sapporo"));
  assert(HOTEL_CHAIN_RE.test("Hilton Tokyo Bay"));
  assert(HOTEL_CHAIN_RE.test("Park Hyatt Tokyo"));
  assert(HOTEL_CHAIN_RE.test("Marriott Marquis"));
  assert(HOTEL_CHAIN_RE.test("hampton inn riverwalk"));
  assertFalse(HOTEL_CHAIN_RE.test("Hokkaido Shrine"));
  assertFalse(HOTEL_CHAIN_RE.test("Sapporo Beer Museum"));
});

Deno.test("GENERIC_NAME_RE catches generic terms", () => {
  assert(GENERIC_NAME_RE.test("Old Town"));
  assert(GENERIC_NAME_RE.test("Old City"));
  assert(GENERIC_NAME_RE.test("Central Market"));
  assert(GENERIC_NAME_RE.test("Main Square"));
  assert(GENERIC_NAME_RE.test("city centre"));
  assertFalse(GENERIC_NAME_RE.test("Hokkaido Shrine"));
  assertFalse(GENERIC_NAME_RE.test("Tsukiji Outer Market")); // not generic; specific district
});

Deno.test("RISKY_NAME_RE matches either chain OR generic", () => {
  assert(RISKY_NAME_RE.test("The Westin Sapporo"));
  assert(RISKY_NAME_RE.test("Old Town"));
  assertFalse(RISKY_NAME_RE.test("Hokkaido Shrine"));
});

Deno.test("normalizeName strips diacritics, stopwords, punctuation", () => {
  assertEquals(normalizeName("The Westin Sapporo"), "westin sapporo");
  assertEquals(normalizeName("Café del Mar"), "cafe del mar");
  assertEquals(normalizeName("A Hotel & Spa"), "hotel spa");
  assertEquals(normalizeName("São Paulo"), "sao paulo");
  assertEquals(normalizeName(""), "");
});

Deno.test("nameSimilarity rejects unrelated names", () => {
  // The Westin Sapporo vs the US Consulate in Sapporo (Photon's actual response)
  const sim = nameSimilarity("The Westin Sapporo", "在札幌米国総領事館");
  // Japanese characters get stripped → empty after normalize → 0
  assertEquals(sim, 0);
});

Deno.test("nameSimilarity accepts identical names", () => {
  assertEquals(nameSimilarity("Hokkaido Shrine", "Hokkaido Shrine"), 1);
});

Deno.test("nameSimilarity gives chain-brand match a partial score", () => {
  // Both share "westin" as the first significant token → should pass threshold
  const sim = nameSimilarity("The Westin Sapporo", "The Westin Rusutsu Resort");
  assert(sim >= 0.4, `expected sim >= 0.4 for chain match, got ${sim}`);
});

Deno.test("nameSimilarity is high for similar phrasings", () => {
  const sim = nameSimilarity(
    "Sapporo Beer Museum",
    "Sapporo Beer Museum and Garden",
  );
  assert(sim >= 0.5, `expected sim >= 0.5, got ${sim}`);
});

Deno.test("haversineKm computes plausible distance", () => {
  // Hokkaido Shrine (43.054, 141.309) to Sapporo Beer Museum (43.077, 141.380):
  // ~6.5 km straight line
  const d = haversineKm(43.054, 141.309, 43.077, 141.38);
  assert(d > 5 && d < 8, `expected 5-8km, got ${d}`);
});

Deno.test(
  "validateGoogleResult rejects wrong-brand result for chain query",
  () => {
    const r = validateGoogleResult({
      query: "The Westin Sapporo",
      displayName: "Sapporo Park Hotel", // not a Westin
      businessStatus: "OPERATIONAL",
      resultLat: 43.05,
      resultLng: 141.35,
      centroidLat: 43.06,
      centroidLng: 141.35,
      type: "lodging",
    });
    assertFalse(r.ok);
    assert(r.reason.includes("chain"));
  },
);

Deno.test(
  "validateGoogleResult accepts brand-matching lodging far from centroid",
  () => {
    // Westin Rusutsu is 84km from central Sapporo — within the 300km lodging cap
    const r = validateGoogleResult({
      query: "The Westin Sapporo",
      displayName: "The Westin Rusutsu Resort",
      businessStatus: "OPERATIONAL",
      resultLat: 42.7476,
      resultLng: 140.9053,
      centroidLat: 43.0618,
      centroidLng: 141.3545,
      type: "lodging",
    });
    assert(r.ok, `expected ok, got ${r.reason}`);
  },
);

Deno.test("validateGoogleResult rejects non-operational businesses", () => {
  const r = validateGoogleResult({
    query: "Some Old Hotel",
    displayName: "Some Old Hotel",
    businessStatus: "CLOSED_PERMANENTLY",
    resultLat: 43.06,
    resultLng: 141.35,
    centroidLat: 43.06,
    centroidLng: 141.35,
    type: "lodging",
  });
  assertFalse(r.ok);
  assert(r.reason.includes("business_status"));
});

Deno.test(
  "validateGoogleResult rejects sight far outside city (100km cap)",
  () => {
    // 200km away with type=sight (no lodging exception) should fail
    const r = validateGoogleResult({
      query: "Some Shrine",
      displayName: "Some Shrine",
      businessStatus: "OPERATIONAL",
      resultLat: 44.5,
      resultLng: 141.35,
      centroidLat: 43.06,
      centroidLng: 141.35,
      type: null,
    });
    assertFalse(r.ok);
    assert(r.reason.includes("km from city centroid"));
  },
);

Deno.test(
  "validateGoogleResult passes when centroid is missing (skip dist check)",
  () => {
    const r = validateGoogleResult({
      query: "Some Random Place",
      displayName: "Some Random Place",
      businessStatus: "OPERATIONAL",
      resultLat: 10,
      resultLng: 10,
    });
    assert(r.ok);
  },
);
