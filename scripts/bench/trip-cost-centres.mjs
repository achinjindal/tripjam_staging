#!/usr/bin/env node
// Per-cost-centre breakdown across N trips, read from llm_usage rather than
// from any harness's own arithmetic.
//
//   node scripts/bench/trip-cost-centres.mjs <tripId> [tripId...]
//
// Rates are parsed from _shared/credits.ts via loadRates(), which THROWS when
// a model it is asked to price is missing — the silent fable-5 fallback has
// produced a wrong cost figure three times in one day (once reporting a trip
// at $1.23 against a true $0.09).
import {
  loadRates,
  loadSearchFees,
  rowCost,
  loadEnv,
  pad,
  fmtUsd,
} from "./lib.mjs";

const tripIds = process.argv.slice(2);
if (!tripIds.length) {
  console.error("usage: trip-cost-centres.mjs <tripId>...");
  process.exit(1);
}

const env = loadEnv();
const URL = env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
const rates = loadRates();
const fees = loadSearchFees();
const CREDIT_USD = 0.007; // _shared/credits.ts

const rows = [];
for (const id of tripIds) {
  const r = await fetch(
    `${URL}/rest/v1/llm_usage?trip_id=eq.${id}` +
      `&select=function_name,model,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens,web_search_count,duration_ms`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
  );
  if (!r.ok) {
    console.error(`llm_usage query failed (${r.status})`);
    process.exit(1);
  }
  const got = await r.json();
  if (!got.length) console.error(`  ! no usage rows for ${id} — excluded`);
  for (const row of got) rows.push({ ...row, trip: id });
}

// Normalise the :suffix variants into the cost centre a founder thinks in.
const CENTRE = (fn) => {
  const base = fn.split(":")[0];
  return (
    {
      "generate-brainstorm": "RG (routes)",
      "generate-itinerary": "IG (itinerary)",
      "city-deep-dive": "Magazine",
      "generate-destination-research": "Inspirations",
      "generate-todos": "Todos",
      "estimate-expenses": "Expenses",
      "extract-preferences": "Preferences",
      "generate-wishlist": "Wishlist",
      "generate-day-narratives": "Narratives",
      "places-proxy": "Places repair",
    }[base] || base
  );
};

const nTrips = new Set(rows.map((r) => r.trip)).size;
const g = new Map();
let unknownModel = false;
for (const r of rows) {
  const { usd, unknown } = rowCost(r, rates, fees);
  if (unknown) {
    unknownModel = true;
    console.error(`  ! model not in RATES: ${r.model}`);
  }
  const k = CENTRE(r.function_name);
  const e = g.get(k) || {
    calls: 0,
    usd: 0,
    inp: 0,
    out: 0,
    srch: 0,
    models: new Set(),
  };
  e.calls++;
  e.usd += usd;
  e.inp += r.input_tokens || 0;
  e.out += r.output_tokens || 0;
  e.srch += r.web_search_count || 0;
  e.models.add(r.model);
  g.set(k, e);
}
const total = [...g.values()].reduce((a, e) => a + e.usd, 0);

console.log(`\n  Cost centres averaged over ${nTrips} trip(s)\n`);
console.log(
  "  " +
    pad("cost centre", 17) +
    pad("calls/trip", 12) +
    pad("$/trip", 11) +
    pad("credits", 10) +
    pad("share", 8) +
    "model(s)",
);
console.log("  " + "-".repeat(94));
for (const [k, e] of [...g].sort((a, b) => b[1].usd - a[1].usd)) {
  const perTrip = e.usd / nTrips;
  console.log(
    "  " +
      pad(k, 17) +
      pad((e.calls / nTrips).toFixed(1), 12) +
      pad(fmtUsd(perTrip), 11) +
      pad((Math.ceil((perTrip / CREDIT_USD) * 100) / 100).toFixed(2), 10) +
      pad(((100 * e.usd) / total).toFixed(0) + "%", 8) +
      [...e.models].map((m) => m.replace("-20251001", "")).join(", "),
  );
}
console.log("  " + "-".repeat(94));
const perTrip = total / nTrips;
console.log(
  "  " +
    pad("TOTAL", 17) +
    pad("", 12) +
    pad(fmtUsd(perTrip), 11) +
    pad((Math.ceil((perTrip / CREDIT_USD) * 100) / 100).toFixed(2), 10) +
    "100%",
);
const searches = rows.reduce((a, r) => a + (r.web_search_count || 0), 0);
console.log(
  `\n  web searches: ${(searches / nTrips).toFixed(1)}/trip ` +
    `($${((searches / nTrips) * fees.anthropic).toFixed(4)} in per-search fees)`,
);
if (unknownModel)
  console.log(
    "\n  WARNING: a model was missing from RATES — figures above are inflated.",
  );
