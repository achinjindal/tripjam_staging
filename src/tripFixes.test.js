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
  // Day 2's 22 km hop gets 60 minutes for a ~72-minute drive, so it now
  // reports as "tight" (unmakeable) rather than "long_hop" (merely long) —
  // a strictly better diagnosis of the same fixture.
  assertEquals(kinds(findTripFixes({}, days)), ["overlap", "tight"]);
  const dismissed = new Set([findTripFixes({}, days)[0].id]);
  assertEquals(kinds(findTripFixes({}, days, dismissed)), ["tight"]);
});

// ── Detectors added after the 2026-10-23 trip review ────────────────────────
// Every fixture below is a REAL failure from the five generated trips, not an
// invented one — these are the shapes a traveller actually received.

Deno.test("repeatedGeocodes catches a place renamed between days", () => {
  // bali-10d: same spa, two names, identical geocode. The title-based check
  // saw two different places AND skipped it for not being food.
  const g = "the spa at the legian seminyak, jalan kayu aya, seminyak";
  const fixes = findTripFixes({}, [
    day("Day 6", "2027-06-19", [
      act("The Spa at The Legian", "15:00", { geocode: g }),
    ]),
    day("Day 9", "2027-06-22", [
      act("The Legian Luxury Ayurveda Couples Ritual", "14:00", { geocode: g }),
    ]),
  ]);
  assertEquals(kinds(fixes).includes("repeat"), true);
});

Deno.test(
  "repeatedGeocodes ignores hotels — returning to a base is correct",
  () => {
    // peru-9d checks into the same hostel on Day 1 and Day 8 because the trip
    // goes Cusco -> Machu Picchu -> Cusco. That is the behaviour we ask for.
    const g = "Kokopelli Hostel Cusco, Peru";
    const fixes = findTripFixes({}, [
      day("Day 1", "2027-10-03", [
        act("Check in at Kokopelli Hostel Cusco", "10:30", {
          type: "hotel",
          geocode: g,
        }),
      ]),
      day("Day 8", "2027-10-10", [
        act("Check in at Kokopelli Hostel Cusco", "16:00", {
          type: "hotel",
          geocode: g,
        }),
      ]),
    ]);
    assertEquals(kinds(fixes).includes("repeat"), false);
  },
);

Deno.test("tightConnections catches a drive that cannot be made", () => {
  // bali-10d Day 4: Kintamani -> Tegenungan, ~1h30 of driving, 45 min given.
  const fixes = findTripFixes({}, [
    day("Day 4", "2027-06-17", [
      act("Mount Batur Sunrise", "05:30", {
        duration: "1.75h",
        lat: -8.2423,
        lng: 115.375,
      }),
      act("Tegenungan Waterfall", "08:00", { lat: -8.5755, lng: 115.2878 }),
    ]),
  ]);
  assertEquals(kinds(fixes).includes("tight"), true);
});

Deno.test("tightConnections allows a gap that genuinely fits", () => {
  const fixes = findTripFixes({}, [
    day("Day 1", "2027-06-14", [
      act("Seminyak Beach", "09:00", { lat: -8.6905, lng: 115.1662 }),
      act("Potato Head Beach Club", "13:00", { lat: -8.6786, lng: 115.1588 }),
    ]),
  ]);
  assertEquals(kinds(fixes).includes("tight"), false);
});

Deno.test("stackedMeals catches two dinners back to back", () => {
  // bali-10d Day 1: charcuterie ends 19:10, tasting menu starts 19:30.
  const fixes = findTripFixes({}, [
    day("Day 1", "2027-06-14", [
      act("Locavore To Go Charcuterie", "18:10", {
        type: "food",
        duration: "1h",
      }),
      act("Mozaic Tasting Menu", "19:30", { type: "food", duration: "2h" }),
    ]),
  ]);
  assertEquals(kinds(fixes).includes("meal_stack"), true);
});

Deno.test("stackedMeals leaves a normal lunch and dinner alone", () => {
  const fixes = findTripFixes({}, [
    day("Day 1", "2027-06-14", [
      act("Warung Babi Guling", "12:30", { type: "food", duration: "1h" }),
      act("Mozaic Tasting Menu", "19:30", { type: "food", duration: "2h" }),
    ]),
  ]);
  assertEquals(kinds(fixes).includes("meal_stack"), false);
});

Deno.test(
  "noteContradictions catches a booking past its own closing time",
  () => {
    // iceland-4d: Maritime Museum booked 17:15-18:30 under a note saying it
    // closes at 17:00. The model had both facts in one object.
    const fixes = findTripFixes({}, [
      day("Day 1", "2027-09-18", [
        act("Reykjavik Maritime Museum", "17:15", {
          duration: "1.25h",
          note: "Closes at 17:00",
        }),
      ]),
    ]);
    assertEquals(kinds(fixes).includes("hours"), true);
  },
);

Deno.test("noteContradictions does not fire on a seasonal note", () => {
  // "Closes at 17:00 in winter; 18:00 summer" describes two regimes — the
  // schedule can be correct for one of them.
  const fixes = findTripFixes({}, [
    day("Day 1", "2027-09-18", [
      act("Reykjavik Maritime Museum", "17:15", {
        duration: "0.5h",
        note: "Closes at 17:00 in winter; 18:00 summer",
      }),
    ]),
  ]);
  assertEquals(kinds(fixes).includes("hours"), false);
});

Deno.test("noteContradictions catches a start before stated opening", () => {
  const fixes = findTripFixes({}, [
    day("Day 2", "2027-04-06", [
      act("Tenryu-ji Garden", "07:45", { note: "Opens at 08:30" }),
    ]),
  ]);
  assertEquals(kinds(fixes).includes("hours"), true);
});
