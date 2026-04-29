import { test, expect } from "@playwright/test";

const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpeXZkcXd3bmJicWp1d2l1emJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5ODgxNzcsImV4cCI6MjA4OTU2NDE3N30.yTPlrirndnDpIeN4PPr7qKqzc4IhDXrfj_1Uuxv_Zgs";
const PROXY_URL = "https://viyvdqwwnbbqjuwiuzbh.supabase.co/functions/v1/places-proxy?action=geocode";

async function geocode(q: string, city?: string) {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ q, city: city || null }),
  });
  return res.json();
}

function assertInRegion(result: any, name: string, expected: { latMin: number; latMax: number; lngMin: number; lngMax: number }) {
  expect(result.lat, `${name}: lat should be between ${expected.latMin}-${expected.latMax}`).toBeGreaterThan(expected.latMin);
  expect(result.lat, `${name}: lat should be between ${expected.latMin}-${expected.latMax}`).toBeLessThan(expected.latMax);
  expect(result.lng, `${name}: lng should be between ${expected.lngMin}-${expected.lngMax}`).toBeGreaterThan(expected.lngMin);
  expect(result.lng, `${name}: lng should be between ${expected.lngMin}-${expected.lngMax}`).toBeLessThan(expected.lngMax);
}

// Region bounding boxes
const INDIA = { latMin: 6, latMax: 37, lngMin: 68, lngMax: 98 };
const JAPAN = { latMin: 24, latMax: 46, lngMin: 123, lngMax: 146 };
const ITALY = { latMin: 36, latMax: 47, lngMin: 6, lngMax: 19 };
const SRI_LANKA = { latMin: 5, latMax: 10, lngMin: 79, lngMax: 82 };
const VIETNAM = { latMin: 8, latMax: 24, lngMin: 102, lngMax: 110 };
const THAILAND = { latMin: 5, latMax: 21, lngMin: 97, lngMax: 106 };
const BHUTAN = { latMin: 26, latMax: 29, lngMin: 88, lngMax: 93 };

test.describe("Geocoding — Photon accuracy", () => {

  test("Indian cities resolve correctly", async () => {
    const tests = [
      { q: "Shimla", city: "Himachal Pradesh", name: "Shimla" },
      { q: "Manali", city: "Himachal Pradesh", name: "Manali" },
      { q: "Jaipur", city: "Rajasthan", name: "Jaipur" },
      { q: "Varanasi", city: "Uttar Pradesh", name: "Varanasi" },
      { q: "Kochi", city: "Kerala", name: "Kochi" },
      { q: "Tabo", city: "Himachal Pradesh", name: "Tabo" },
      { q: "Sangla", city: "Himachal Pradesh", name: "Sangla" },
      { q: "Kalpa", city: "Himachal Pradesh", name: "Kalpa" },
    ];
    for (const t of tests) {
      const result = await geocode(t.q, t.city);
      console.log(`${t.name}: ${result.lat}, ${result.lng}`);
      assertInRegion(result, t.name, INDIA);
    }
  });

  test("Japanese cities resolve correctly", async () => {
    const tests = [
      { q: "Shibuya", city: "Tokyo", name: "Shibuya" },
      { q: "Kiyomizu-dera", city: "Kyoto", name: "Kiyomizu-dera" },
      { q: "Fushimi Inari", city: "Kyoto", name: "Fushimi Inari" },
      { q: "Senso-ji", city: "Tokyo", name: "Senso-ji" },
      { q: "Nara", city: "Japan", name: "Nara" },
      { q: "Osaka", city: "Japan", name: "Osaka" },
    ];
    for (const t of tests) {
      const result = await geocode(t.q, t.city);
      console.log(`${t.name}: ${result.lat}, ${result.lng}`);
      assertInRegion(result, t.name, JAPAN);
    }
  });

  test("Bhutan/Himachal places don't land in Europe", async () => {
    const tests = [
      { q: "Tabo", city: "Spiti Valley", name: "Tabo (Spiti)" },
      { q: "Sangla", city: "Kinnaur", name: "Sangla (Kinnaur)" },
      { q: "Paro", city: "Bhutan", name: "Paro" },
      { q: "Thimphu", city: "Bhutan", name: "Thimphu" },
      { q: "Punakha", city: "Bhutan", name: "Punakha" },
    ];
    for (const t of tests) {
      const result = await geocode(t.q, t.city);
      console.log(`${t.name}: ${result.lat}, ${result.lng}`);
      // Must NOT be in Europe (lat 35-72, lng -25 to 45)
      const inEurope = result.lat > 35 && result.lat < 72 && result.lng > -25 && result.lng < 45;
      expect(inEurope, `${t.name} should NOT be in Europe`).toBe(false);
    }
  });

  test("Sri Lanka places resolve correctly", async () => {
    const tests = [
      { q: "Galle", city: "Sri Lanka", name: "Galle" },
      { q: "Ella", city: "Sri Lanka", name: "Ella" },
      { q: "Sigiriya", city: "Sri Lanka", name: "Sigiriya" },
      { q: "Mirissa", city: "Sri Lanka", name: "Mirissa" },
    ];
    for (const t of tests) {
      const result = await geocode(t.q, t.city);
      console.log(`${t.name}: ${result.lat}, ${result.lng}`);
      assertInRegion(result, t.name, SRI_LANKA);
    }
  });

  test("Southeast Asia places resolve correctly", async () => {
    const tests = [
      { q: "Hanoi Old Quarter", city: "Hanoi", name: "Hanoi Old Quarter" },
      { q: "Hoi An", city: "Vietnam", name: "Hoi An" },
      { q: "Chiang Mai", city: "Thailand", name: "Chiang Mai" },
      { q: "Khao San Road", city: "Bangkok", name: "Khao San Road" },
    ];
    for (const t of tests) {
      const result = await geocode(t.q, t.city);
      console.log(`${t.name}: ${result.lat}, ${result.lng}`);
      const inSEAsia = result.lat > 5 && result.lat < 24 && result.lng > 97 && result.lng < 110;
      expect(inSEAsia, `${t.name} should be in SE Asia`).toBe(true);
    }
  });

  test("European cities resolve correctly", async () => {
    const tests = [
      { q: "Colosseum", city: "Rome", name: "Colosseum" },
      { q: "Amalfi", city: "Italy", name: "Amalfi" },
      { q: "Santorini", city: "Greece", name: "Santorini" },
    ];
    for (const t of tests) {
      const result = await geocode(t.q, t.city);
      console.log(`${t.name}: ${result.lat}, ${result.lng}`);
      const inEurope = result.lat > 34 && result.lat < 72 && result.lng > -25 && result.lng < 45;
      expect(inEurope, `${t.name} should be in Europe`).toBe(true);
    }
  });

  test("Ambiguous place names resolve with city bias", async () => {
    // "Tabo" without city could go anywhere; with "Himachal Pradesh" it should be in India
    const withoutCity = await geocode("Tabo");
    const withCity = await geocode("Tabo", "Himachal Pradesh");
    console.log(`Tabo (no city): ${withoutCity.lat}, ${withoutCity.lng}`);
    console.log(`Tabo (Himachal): ${withCity.lat}, ${withCity.lng}`);
    assertInRegion(withCity, "Tabo with city bias", INDIA);
  });
});
