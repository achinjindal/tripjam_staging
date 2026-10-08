/* global Deno */
// Unit tests for the proactive-fix detectors. Run: npm run test:functions
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { durationMin, findTripFixes, placeKey } from "./tripFixes.js";

const act = (title, time, extra = {}) => ({
  title,
  time,
  type: "sight",
  duration: "1h",
  ...extra,
});
const day = (label, date, activities) => ({
  label,
  date,
  activities: activities.map((a, i) => ({ ...a, position: i })),
});
const kinds = (fixes) => fixes.map((f) => f.kind);

Deno.test("durations and place keys parse the shapes IG writes", () => {
  assertEquals(durationMin("1.5h"), 90);
  assertEquals(durationMin("45m"), 45);
  assertEquals(durationMin("1h 30m"), 90);
  assertEquals(durationMin("2 hours"), 120);
  assertEquals(durationMin("all day"), null);
  assertEquals(placeKey("Evening Dinner at Huen Phen"), "huen phen");
  assertEquals(placeKey("Lunch at Huen Muan Jai"), "huen muan jai");
  assertEquals(
    placeKey("Riverside Bar & Restaurant"),
    "riverside bar restaurant",
  );
});

Deno.test("a restaurant repeated on a later day is flagged once", () => {
  const days = [
    day("Day 1", "2026-11-01", [
      act("Huen Phen", "19:00", { type: "food" }),
      act("Breakfast at Guesthouse", "08:00", { type: "food" }),
    ]),
    day("Day 2", "2026-11-02", [
      act("Evening Dinner at Huen Phen", "19:00", { type: "food" }),
      act("Breakfast at Guesthouse", "08:00", { type: "food" }),
      act("Seminyak Beach", "10:00"),
    ]),
    day("Day 3", "2026-11-03", [act("Seminyak Beach", "10:00")]),
  ];
  const fixes = findTripFixes({}, days);
  assertEquals(kinds(fixes), ["repeat"]);
  assertEquals(fixes[0].dayIdx, 1);
  assertEquals(
    fixes[0].text,
    "Day 2 repeats Evening Dinner at Huen Phen from Day 1.",
  );
});

Deno.test(
  "arrival and departure clashes; placeholder times are ignored",
  () => {
    const days = [
      day("Day 1", "2026-11-01", [
        act("Airport transfer", "10:00", { type: "transit" }),
        act("City Palace", "10:30"),
      ]),
      day("Day 2", "2026-11-02", [act("Market", "16:00", { duration: "2h" })]),
    ];
    const real = {
      arrival_time: "2026-11-01T10:00:00",
      departure_time: "2026-11-02T19:30:00",
      arrival_mode: "flight",
      departure_mode: "flight",
    };
    assertEquals(kinds(findTripFixes(real, days)), ["arrival", "departure"]);
    const placeholder = {
      arrival_time: "2026-11-01T12:00:00",
      departure_time: "2026-11-02T19:00:00",
    };
    assertEquals(findTripFixes(placeholder, days), []);
    // A different date (trip dates moved since) is not a clash.
    assertEquals(
      findTripFixes({ ...real, arrival_time: "2026-10-30T10:00:00" }, days).map(
        (f) => f.kind,
      ),
      ["departure"],
    );
  },
);

Deno.test("a booked train overlapping an activity is flagged first", () => {
  const days = [
    day("Day 1", "2026-11-01", [act("Fort walk", "09:00")]),
    day("Day 2", "2026-11-02", [
      act("Tea factory", "10:00", { duration: "2h" }),
      act("Train to Ella", "11:00", { type: "transit" }),
    ]),
  ];
  const trip = {
    travel_data: [
      {
        kind: "train",
        number: "1015",
        date: "2026-11-02",
        depart_time: "11:00",
        arrive_time: "14:00",
        status: "booked",
      },
      {
        kind: "train",
        date: "2026-11-01",
        depart_time: "09:00",
        status: "cancelled",
      },
    ],
  };
  const fixes = findTripFixes(trip, days);
  assertEquals(kinds(fixes), ["booked_leg"]);
  assertEquals(fixes[0].dayIdx, 1);
});

Deno.test("overlaps and long rides; at most one fix per day, max three", () => {
  const days = [
    day("Day 1", "2026-11-01", [
      act("Boat tour", "08:30", { duration: "7h" }),
      act("Lake crossing", "09:00"),
    ]),
    day("Day 2", "2026-11-02", [
      act("A", "09:00", { lat: 0, lng: 0 }),
      act("B", "11:00", { lat: 0, lng: 0.2 }), // ~22 km → ~72 min by road
    ]),
    day("Day 3", "2026-11-03", [
      act("C", "09:00", { lat: 0, lng: 0 }),
      act("D", "11:00", { lat: 0, lng: 0.01 }), // ~1 km
    ]),
  ];
  assertEquals(kinds(findTripFixes({}, days)), ["overlap", "long_hop"]);
  const dismissed = new Set([findTripFixes({}, days)[0].id]);
  assertEquals(kinds(findTripFixes({}, days, dismissed)), ["long_hop"]);
});
