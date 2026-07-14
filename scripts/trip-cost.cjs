#!/usr/bin/env node
// Print actual per-function LLM cost for one trip from the `llm_usage` table.
//
// Usage:
//   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/trip-cost.cjs [tripId]
//
// - Reads VITE_SUPABASE_URL as a fallback for the URL.
// - Needs the SERVICE ROLE key (llm_usage is admin-RLS-gated; the anon key
//   returns nothing).
// - Omit tripId to auto-pick the most recent trip that has usage rows.
//
// Cost model mirrors supabase/functions/_shared/credits.ts:
//   cost = in*rIn + cacheWrite*rIn*1.25 + cacheRead*rIn*0.10 + out*rOut
//   credits_charged = ceil((cost / 0.007) * 100) / 100   (LLM-budget scale)

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error(
    "Missing env. Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

// $ per token. Cache write = 1.25x input, cache read = 0.10x input.
const RATES = {
  "claude-sonnet-4-6": { input: 3 / 1e6, output: 15 / 1e6 },
  "claude-haiku-4-5": { input: 0.8 / 1e6, output: 4 / 1e6 },
  "claude-haiku-4-5-20251001": { input: 0.8 / 1e6, output: 4 / 1e6 },
};
const CACHE_WRITE = 1.25;
const CACHE_READ = 0.1;
const CREDIT_LLM_BUDGET_USD = 0.007;

function rowCost(r) {
  const rate = RATES[r.model] || RATES["claude-sonnet-4-6"];
  const inTok = r.input_tokens || 0;
  const outTok = r.output_tokens || 0;
  const cw = r.cache_creation_tokens || 0;
  const cr = r.cache_read_tokens || 0;
  return (
    inTok * rate.input +
    cw * rate.input * CACHE_WRITE +
    cr * rate.input * CACHE_READ +
    outTok * rate.output
  );
}

const toCredits = (usd) =>
  usd > 0 ? Math.ceil((usd / CREDIT_LLM_BUDGET_USD) * 100) / 100 : 0;

async function rest(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) {
    throw new Error(`REST ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  let tripId = process.argv[2];

  if (!tripId) {
    const recent = await rest(
      "llm_usage?select=trip_id,created_at&trip_id=not.is.null&order=created_at.desc&limit=1",
    );
    if (!recent.length) {
      console.error("No llm_usage rows with a trip_id found.");
      process.exit(1);
    }
    tripId = recent[0].trip_id;
    console.log(`No tripId given — using most recent: ${tripId}\n`);
  }

  const rows = await rest(
    `llm_usage?trip_id=eq.${tripId}&select=*&order=created_at.asc`,
  );
  if (!rows.length) {
    console.error(`No usage rows for trip ${tripId}.`);
    process.exit(1);
  }

  // Aggregate per function.
  const byFn = {};
  for (const r of rows) {
    const k = r.function_name || "(unknown)";
    if (!byFn[k]) {
      byFn[k] = { calls: 0, in: 0, out: 0, cw: 0, cr: 0, cost: 0 };
    }
    const g = byFn[k];
    g.calls += 1;
    g.in += r.input_tokens || 0;
    g.out += r.output_tokens || 0;
    g.cw += r.cache_creation_tokens || 0;
    g.cr += r.cache_read_tokens || 0;
    g.cost += rowCost(r);
  }

  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log(`Trip: ${tripId}   (${rows.length} calls)\n`);
  console.log(
    pad("function", 30) +
      padL("calls", 6) +
      padL("in", 9) +
      padL("out", 9) +
      padL("cacheW", 9) +
      padL("cacheR", 9) +
      padL("cost $", 11) +
      padL("credits", 9),
  );
  console.log("-".repeat(92));

  let totalCost = 0;
  const fns = Object.entries(byFn).sort((a, b) => b[1].cost - a[1].cost);
  for (const [name, g] of fns) {
    totalCost += g.cost;
    console.log(
      pad(name, 30) +
        padL(g.calls, 6) +
        padL(g.in.toLocaleString(), 9) +
        padL(g.out.toLocaleString(), 9) +
        padL(g.cw.toLocaleString(), 9) +
        padL(g.cr.toLocaleString(), 9) +
        padL("$" + g.cost.toFixed(4), 11) +
        padL(toCredits(g.cost).toFixed(2), 9),
    );
  }
  console.log("-".repeat(92));
  console.log(
    pad("TOTAL", 30) +
      padL("", 36) +
      padL("$" + totalCost.toFixed(4), 11) +
      padL(toCredits(totalCost).toFixed(2), 9),
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
