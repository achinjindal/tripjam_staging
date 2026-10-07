// Bench arms + trip fixtures, shared by run-trips.mjs and score-trips.mjs.
//
// An "arm" is a whole-stack model configuration expressed purely as staging
// secrets. Every LLM step of a trip runs on the arm's model, so a trip is
// directly attributable to one configuration.

// Every per-function key modelFor() understands, so an arm can be cleared
// completely before the next one is applied. Missing one leaks the previous
// arm's model into the next trip.
export const ALL_MODEL_ENV_KEYS = [
  "LLM_MODEL_DEFAULT",
  "LLM_MODEL_RG",
  "LLM_MODEL_IG",
  "LLM_MODEL_IG_PLAN",
  "LLM_MODEL_IG_FILL",
  "LLM_MODEL_DEEPDIVE",
  "LLM_MODEL_PREFS",
  "LLM_MODEL_TODOS",
  "LLM_MODEL_EXPENSES",
  "LLM_MODEL_NARRATIVES",
  "LLM_MODEL_WISHLIST",
  "LLM_MODEL_REPAIR",
  // Legacy names still honoured by modelFor — unset them too, or a stale
  // RG_MODEL on staging silently overrides LLM_MODEL_DEFAULT for RG only.
  // (IG_MODEL really is set on staging today, so this is load-bearing: without
  // it the "prod-baseline" arm would measure that stale value instead of the
  // deployed code default.)
  "RG_MODEL",
  "IG_MODEL",
  "IG_FILL_MODEL",
  // CHAT_MODEL is deliberately NOT in this list. The bench never calls chat,
  // and Supabase secret values are write-only — unsetting it would change
  // staging's chat configuration with no way to read the old value back and
  // restore it. Leave it alone.
];

const GPT6 = "gpt-6-luna";

export const ARMS = [
  {
    id: "prod-baseline",
    // The control: no overrides at all, i.e. whatever the deployed defaults
    // are. As of 2026-10-06 that is gemini-3.8-flash for RG and IG,
    // gpt-6-luna for Magazine deep-dives, Haiku 4.5 for todos/expenses/
    // preferences/wishlist/narratives, and Haiku + Sonnet-5.5 escalation +
    // YouTube video discovery for Inspirations.
    // "Sonnet everywhere" is deliberately NOT an arm: nobody would ship
    // Sonnet for todo generation, so it would be a control for no decision.
    env: {},
    expect: {
      "generate-brainstorm": "claude-sonnet-5-5",
      "generate-itinerary": "claude-sonnet-5-5",
      "city-deep-dive": "claude-haiku-4-5-20251001",
    },
  },
  {
    id: "gpt-6-luna",
    env: { LLM_MODEL_DEFAULT: GPT6 },
  },
  {
    id: "gemini-3.8-flash",
    env: { LLM_MODEL_DEFAULT: "gemini-3.8-flash" },
  },
  {
    id: "gpt-5.6-luna",
    env: { LLM_MODEL_DEFAULT: "gpt-5.6-luna" },
  },
  {
    id: "haiku-4.5",
    env: { LLM_MODEL_DEFAULT: "claude-haiku-4-5-20251001" },
  },
  {
    id: "gemini-3.5-flash-lite",
    // Expected to be the least format-reliable arm (1/4 IG parse failures,
    // 1/3 RG shape failures in the 2026-10-03 matrix). Included so the
    // failure rate is measured rather than assumed.
    env: { LLM_MODEL_DEFAULT: "gemini-3.5-flash-lite" },
  },
  {
    id: "recommended-mix",
    // What the migration plan actually proposes to ship: Gemini where the
    // user is watching a stream (RG latency), gpt-6-luna everywhere the cost
    // is concentrated or the call is invisible.
    env: {
      LLM_MODEL_RG: "gemini-3.8-flash",
      LLM_MODEL_IG_PLAN: "gemini-3.8-flash",
      LLM_MODEL_IG_FILL: GPT6,
      LLM_MODEL_IG: GPT6,
      LLM_MODEL_DEEPDIVE: GPT6,
      LLM_MODEL_PREFS: GPT6,
      LLM_MODEL_TODOS: GPT6,
      LLM_MODEL_EXPENSES: GPT6,
      LLM_MODEL_NARRATIVES: GPT6,
      LLM_MODEL_WISHLIST: GPT6,
      LLM_MODEL_REPAIR: GPT6,
    },
    expect: {
      "generate-brainstorm": "gemini-3.8-flash",
      "city-deep-dive": GPT6,
    },
  },
];

// Dates are generated relative to a fixed offset so reruns are comparable and
// always in the future (past dates change how the models reason about season).
const daysFromNow = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const TRIPS = [
  {
    id: "thailand",
    // Country-level destination: RG must invent the route itself (which
    // cities, how many nights in each), which is the part of RG that actually
    // differs between models.
    destinations: ["Thailand"],
    numDays: 7,
    startOffset: 60,
    travelers: "2",
    styles: ["Food & Culinary", "History & Culture"],
    budget: "mid",
    pace: "active",
    morningStart: "early",
    notes:
      "First time in Thailand. We love street food and markets, want at least one quiet beach or island day, and would rather not spend every day in cities.",
  },
  {
    id: "tbilisi-kazbegi",
    // Long-tail, pinned two-city route with a mountain leg: the inter-city
    // transit card fields and the hotel-invention failure mode both bite here,
    // and Georgia is thin enough in training data to separate the models.
    destinations: ["Tbilisi", "Kazbegi"],
    numDays: 4,
    startOffset: 75,
    travelers: "2",
    styles: ["History & Culture", "Photography & Scenery"],
    budget: "mid",
    pace: "active",
    morningStart: "early",
    notes:
      "Want Georgian wine and food, the Gergeti Trinity church, and good mountain views. No early-morning hikes.",
  },
  // ── Cost-analysis set (2026-10-06): three trips, 5-10 days, deliberately
  // spanning the axes that move cost — trip length (drives IG day-fill count),
  // city count (drives Magazine deep-dives) and destination popularity (drives
  // whether Inspirations escalates).
  {
    id: "portugal-5d",
    destinations: ["Lisbon", "Porto"],
    numDays: 5,
    startOffset: 65,
    travelers: "2",
    styles: ["Food & Culinary", "History & Culture"],
    budget: "mid",
    pace: "moderate",
    morningStart: "mid",
    notes:
      "Second trip to Portugal. Want pastelarias, a fado night, and a day in the Douro. Not interested in queuing for the big museums.",
  },
  {
    id: "japan-10d",
    destinations: ["Japan"],
    numDays: 10,
    startOffset: 95,
    travelers: "2",
    styles: ["Food & Culinary", "History & Culture", "Photography & Scenery"],
    budget: "mid",
    pace: "active",
    morningStart: "early",
    notes:
      "First time in Japan, flying into Tokyo and out of Osaka. Want ramen and izakayas, at least one onsen night, and to use the rail pass properly.",
  },
  {
    id: "peru-8d",
    destinations: ["Peru"],
    numDays: 8,
    startOffset: 80,
    travelers: "2",
    styles: ["History & Culture", "Nature & Outdoors"],
    budget: "mid",
    pace: "active",
    morningStart: "early",
    notes:
      "Cusco, the Sacred Valley and Machu Picchu. Need altitude acclimatisation built in. Would like one food-focused day in Lima.",
  },
].map((t) => ({
  ...t,
  startDate: daysFromNow(t.startOffset),
  endDate: daysFromNow(t.startOffset + t.numDays - 1),
  travelMonth: new Date(
    Date.now() + t.startOffset * 86400000,
  ).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
}));
