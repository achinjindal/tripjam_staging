#!/usr/bin/env node
// Gross profit: real money in vs real money out.
//
// Usage:
//   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/gross-profit.cjs [--days N]
//
// Needs the SERVICE ROLE key (both tables are admin-RLS-gated; an anon key
// returns nothing at all rather than erroring — same trap as trip-cost.cjs).
//
// WHY THIS IS NOT just `SUM(credit_transactions.llm_cost_usd)`:
//
//   1. Deliberately unbilled paths (extract-preferences, inbound-email) write
//      an llm_usage row and NO credit_transactions row. They are real spend.
//      Summing the ledger alone therefore understates cost.
//   2. Free credits are the whole story at this stage: every signup gets 100
//      on the house, so most spend is serving credits nobody paid for. A
//      "credits charged" figure looks like revenue and is not.
//
// So COST comes from llm_usage (the authoritative token record, recomputed
// through llm-rates.json exactly as the billing path does) plus any
// pass-through external-API rows from the ledger. REVENUE comes only from
// transactions carrying a provider_session_id — i.e. money actually received.

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error(
    "Missing env. Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg > -1 ? Number(process.argv[daysArg + 1]) : null;
const since = DAYS
  ? new Date(Date.now() - DAYS * 86400_000).toISOString()
  : null;

// What a credit is sold for, used only when a purchase row carries no USD
// amount in its metadata. Flagged as an estimate wherever it is applied.
const CREDIT_PRICE_USD = Number(process.env.CREDIT_PRICE_USD || 0.01);

// ── rates: the ONE table, same as the billing path ──────────────────────────
const rateData = require("../supabase/functions/_shared/llm-rates.json");
const resolveRate = (r) =>
  r.from && r.then && Date.now() >= Date.parse(r.from + "T00:00:00Z")
    ? r.then
    : r;
const RATES = Object.fromEntries(
  Object.entries(rateData.models).map(([k, v]) => {
    const r = resolveRate(v);
    return [k, { input: r.input / 1e6, output: r.output / 1e6 }];
  }),
);
const {
  cacheWrite: CW,
  cacheRead: CR,
  cacheReadGoogle: CRG,
} = rateData.multipliers;

function rowCost(r) {
  const known = RATES[r.model];
  const rate = known || RATES[rateData.fallbackModel];
  const isGoogle = String(r.model || "").startsWith("gemini");
  const cost =
    (r.input_tokens || 0) * rate.input +
    (r.cache_creation_tokens || 0) * rate.input * CW +
    (r.cache_read_tokens || 0) * rate.input * (isGoogle ? CRG : CR) +
    (r.output_tokens || 0) * rate.output +
    (r.web_search_count || 0) *
      (isGoogle
        ? rateData.perSearchUsd.google
        : rateData.perSearchUsd.anthropic);
  return { cost, unknownModel: !known };
}

async function fetchAll(table, select, extra = "") {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const q =
      `${URL}/rest/v1/${table}?select=${select}${extra}` +
      (since ? `&created_at=gte.${since}` : "");
    const res = await fetch(q, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${from}-${from + PAGE - 1}`,
        Prefer: "count=none",
      },
    });
    if (!res.ok) {
      console.error(`${table}: HTTP ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const usd = (n) => `$${n.toFixed(n >= 100 ? 2 : 4)}`;
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

(async () => {
  const [usage, ledger] = await Promise.all([
    fetchAll(
      "llm_usage",
      "trip_id,function_name,model,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens,web_search_count,created_at",
    ),
    fetchAll(
      "credit_transactions",
      "amount,reason,function_name,trip_id,llm_cost_usd,metadata,provider_session_id,created_at",
    ),
  ]);

  // ── COST ────────────────────────────────────────────────────────────────
  const byTask = new Map();
  let costLLM = 0;
  let unknownModels = new Set();
  for (const r of usage) {
    const { cost, unknownModel } = rowCost(r);
    if (unknownModel) unknownModels.add(r.model);
    costLLM += cost;
    const k = r.function_name || "(unknown)";
    const e = byTask.get(k) || { calls: 0, cost: 0 };
    e.calls++;
    e.cost += cost;
    byTask.set(k, e);
  }

  // External pass-through (Brave today). Its USD sits in the ledger, not in
  // llm_usage, because it is not a token cost.
  let costExternal = 0;
  for (const t of ledger) {
    if (t.amount < 0 && t.metadata?.pricing === "passthrough") {
      costExternal += Number(t.llm_cost_usd || 0);
      const k = t.reason || "(passthrough)";
      const e = byTask.get(k) || { calls: 0, cost: 0 };
      e.calls++;
      e.cost += Number(t.llm_cost_usd || 0);
      byTask.set(k, e);
    }
  }
  const cost = costLLM + costExternal;

  // ── REVENUE: only rows that represent money actually received ───────────
  let revenue = 0;
  let revenueEstimated = 0;
  let creditsSold = 0;
  let creditsFree = 0;
  const purchases = [];
  for (const t of ledger) {
    if (t.amount <= 0) continue;
    if (!t.provider_session_id) {
      creditsFree += t.amount; // signup grant, coupon, manual top-up
      continue;
    }
    creditsSold += t.amount;
    const m = t.metadata || {};
    // Lemon Squeezy stores order totals in CENTS.
    const cents =
      m.ls_order_attributes?.total_usd ?? m.ls_order_attributes?.total ?? null;
    if (cents != null && Number.isFinite(Number(cents))) {
      revenue += Number(cents) / 100;
    } else {
      const est = t.amount * CREDIT_PRICE_USD;
      revenue += est;
      revenueEstimated += est;
    }
    purchases.push(t);
  }

  const creditsCharged = ledger
    .filter((t) => t.amount < 0)
    .reduce((a, t) => a - t.amount, 0);

  // ── report ──────────────────────────────────────────────────────────────
  const window = DAYS ? `last ${DAYS} days` : "all time";
  console.log(`\n═══ TripJam gross profit — ${window} ═══\n`);

  console.log("REVENUE (money received)");
  console.log(`  purchases                 ${rpad(purchases.length, 10)}`);
  console.log(
    `  credits sold              ${rpad(creditsSold.toFixed(2), 10)}`,
  );
  console.log(`  revenue                   ${rpad(usd(revenue), 10)}`);
  if (revenueEstimated > 0)
    console.log(
      `    of which ESTIMATED      ${rpad(usd(revenueEstimated), 10)}  (no USD in metadata; @ $${CREDIT_PRICE_USD}/credit)`,
    );

  console.log("\nCOST (what we actually paid providers)");
  console.log(`  LLM (from llm_usage)      ${rpad(usd(costLLM), 10)}`);
  console.log(`  external pass-through     ${rpad(usd(costExternal), 10)}`);
  console.log(`  TOTAL COST                ${rpad(usd(cost), 10)}`);

  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : null;
  console.log("\nGROSS PROFIT");
  console.log(`  revenue - cost            ${rpad(usd(profit), 10)}`);
  console.log(
    `  gross margin              ${rpad(margin === null ? "n/a" : margin.toFixed(1) + "%", 10)}`,
  );

  console.log("\nFREE-CREDIT EXPOSURE (why margin looks the way it does)");
  console.log(
    `  credits granted free      ${rpad(creditsFree.toFixed(2), 10)}`,
  );
  console.log(
    `  credits charged (spent)   ${rpad(creditsCharged.toFixed(2), 10)}`,
  );
  const paidShare =
    creditsSold + creditsFree > 0
      ? (creditsSold / (creditsSold + creditsFree)) * 100
      : 0;
  console.log(
    `  share of credits PAID for ${rpad(paidShare.toFixed(1) + "%", 10)}`,
  );

  console.log("\nCOST BY TASK");
  const rows = [...byTask.entries()].sort((a, b) => b[1].cost - a[1].cost);
  console.log(
    `  ${pad("task", 46)}${rpad("calls", 7)}${rpad("cost", 12)}${rpad("share", 8)}`,
  );
  for (const [k, v] of rows) {
    const share = cost > 0 ? ((v.cost / cost) * 100).toFixed(1) + "%" : "-";
    console.log(
      `  ${pad(k.slice(0, 45), 46)}${rpad(v.calls, 7)}${rpad(usd(v.cost), 12)}${rpad(share, 8)}`,
    );
  }

  const trips = new Set(usage.map((r) => r.trip_id).filter(Boolean)).size;
  if (trips)
    console.log(
      `\n  ${trips} trips with usage · avg cost/trip ${usd(cost / trips)}`,
    );

  if (unknownModels.size)
    console.log(
      `\n  ⚠ BILLING ALARM: model(s) absent from llm-rates.json, costed at the ` +
        `${rateData.fallbackModel} fallback (over-states): ${[...unknownModels].join(", ")}`,
    );
  console.log("");
})();
