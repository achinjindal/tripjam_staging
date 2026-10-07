#!/usr/bin/env node
// Measures how DIVERSE the four RG route options actually are.
//
//   node scripts/bench/rg-diversity.mjs "Rajasthan" [--model claude-sonnet-5]
//
// The complaint this exists to measure: every route for Rajasthan came back
// centred on Jaipur + Udaipur. "Genuinely different" is one soft line in the
// prompt with nothing measurable behind it, so this counts what the routes
// actually contain: distinct overnight bases across all four, and how many
// routes each city appears in.
import { loadEnv, signIn, pad } from "./lib.mjs";

const dest = process.argv[2] || "Rajasthan";
const mi = process.argv.indexOf("--model");
const model = mi > 0 ? process.argv[mi + 1] : null;

const env = loadEnv();
const URL_ = env.VITE_SUPABASE_URL,
  ANON = env.VITE_SUPABASE_ANON_KEY;
const { jwt } = await signIn({
  url: URL_,
  anon: ANON,
  email: "qa-tester@tripjam.app",
  password: "qaTest123!",
});

const res = await fetch(`${URL_}/functions/v1/generate-brainstorm`, {
  method: "POST",
  headers: {
    apikey: ANON,
    Authorization: `Bearer ${jwt}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    destinations: [dest],
    numDays: 8,
    travelers: "2",
    styles: ["History & Culture", "Food & Culinary"],
    budget: "mid",
    pace: "active",
    startDate: new Date(Date.now() + 70 * 864e5).toISOString().slice(0, 10),
    notes: "",
  }),
  signal: AbortSignal.timeout(180000),
});
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}

let buf = "";
const reader = res.body.getReader();
const dec = new TextDecoder();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
}
// The endpoint streams SSE: each event is `data: "<json-string-chunk>"`.
// Concatenate the decoded chunks back into the original JSON array.
let text = "";
for (const line of buf.split("\n")) {
  if (!line.startsWith("data: ")) continue;
  const payload = line.slice(6).trim();
  if (!payload || payload === "[DONE]") continue;
  try {
    text += JSON.parse(payload);
  } catch {
    /* non-string event */
  }
}
if (!text) text = buf; // non-SSE fallback
const start = text.indexOf("["),
  end = text.lastIndexOf("]");
let routes = [];
try {
  routes = JSON.parse(text.slice(start, end + 1)).filter((r) => r.tier === 1);
} catch (e) {
  console.error("parse failed:", e.message, text.slice(0, 400));
  process.exit(1);
}

console.log(
  `\n  ${dest}  ·  ${model || "code default"}  ·  ${routes.length} tier-1 routes\n`,
);
const counts = new Map();
for (const r of routes) {
  const bases = (r.stops || [])
    .map((s) => (s.city || "").trim())
    .filter(Boolean);
  for (const b of bases) counts.set(b, (counts.get(b) || 0) + 1);
  console.log(
    "  " +
      pad(r.title?.slice(0, 30) || "?", 32) +
      bases.map((b, i) => `${b}(${r.stops[i]?.nights}n)`).join(" → "),
  );
}
const union = [...counts.keys()];
const everywhere = [...counts]
  .filter(([, n]) => n >= routes.length)
  .map(([c]) => c);
const mostRoutes = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4);
console.log(`\n  distinct bases across all routes : ${union.length}`);
console.log(
  `  appears in EVERY route           : ${everywhere.join(", ") || "none"}`,
);
console.log(
  `  most repeated                    : ${mostRoutes.map(([c, n]) => `${c} (${n}/${routes.length})`).join(", ")}`,
);
// A route set is "concentrated" when a couple of cities carry most of the nights.
const totalSlots = [...counts.values()].reduce((a, b) => a + b, 0);
const top2 = mostRoutes.slice(0, 2).reduce((a, [, n]) => a + n, 0);
console.log(
  `  top-2 cities' share of all stops : ${Math.round((100 * top2) / totalSlots)}%`,
);
