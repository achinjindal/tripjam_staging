// Benchmark the IG PLAN model in isolation.
//
// generate-itinerary awaits the whole plan phase before opening its SSE
// stream, so plan latency IS the user's "nothing is happening" window —
// measured 19–52s on an 8-day trip (median ~24s), which is what made IG read
// as stuck. Only LLM_MODEL_IG_PLAN changes here; the day fills stay on the
// arm-independent default, so a difference in time-to-first-byte is
// attributable to the plan model alone.
//
// Quality matters as much as speed: the plan fixes route, anchors and hotels,
// so a faster-but-worse plan degrades every day that follows.
//
//   node scripts/bench/ig-plan-model.mjs            # staging, 2 runs/arm
//   RUNS=3 node scripts/bench/ig-plan-model.mjs
//
// Writes a JSON record to scripts/bench/out/.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const STAGING_REF = "wlrzvwjdrjpfqcwgmzch";
const RUNS = Number(process.env.RUNS || 2);
const KEY = "LLM_MODEL_IG_PLAN";

// null = leave unset, i.e. the code default (gemini-3.8-flash) — the control.
const ONLY = (process.env.ARMS || "").split(",").filter(Boolean);
const ALL_ARMS = [
  { name: "control (gemini-3.8-flash)", model: null },
  { name: "gemini-3.5-flash-lite", model: "gemini-3.5-flash-lite" },
  { name: "gpt-6-luna", model: "gpt-6-luna" },
  { name: "claude-haiku-4-5", model: "claude-haiku-4-5" },
];
const ARMS = ONLY.length
  ? ALL_ARMS.filter((a) => ONLY.some((o) => a.name.includes(o)))
  : ALL_ARMS;

// Deliberately varied: a single-region beach trip (where over-splitting the
// base is the risk), a multi-city route (where UNDER-splitting is), and a
// short trip (where a model can run out of distinct anchors).
const TRIPS = [
  {
    id: "goa-8d",
    destinations: ["South Goa, India"],
    numDays: 8,
    travelers: 2,
    budget: "mid",
    pace: "active",
    morningStart: "early",
    styles: ["Beaches"],
    startDate: "2027-01-10",
    notes: "",
  },
  {
    id: "japan-7d",
    destinations: ["Tokyo, Japan", "Kyoto, Japan"],
    numDays: 7,
    travelers: 2,
    budget: "mid",
    pace: "active",
    morningStart: "early",
    styles: ["History & Culture", "Food & Culinary"],
    startDate: "2027-04-05",
    notes: "",
  },
  {
    id: "lisbon-4d",
    destinations: ["Lisbon, Portugal"],
    numDays: 4,
    travelers: 2,
    budget: "mid",
    pace: "relaxed",
    morningStart: "late",
    styles: ["Food & Culinary"],
    startDate: "2027-05-02",
    notes: "",
  },
];

function env(file) {
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return out;
}

const e = env(".env");
const URL = e.VITE_SUPABASE_URL;
const ANON = e.VITE_SUPABASE_ANON_KEY;

async function jwt() {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "qa-tester@tripjam.app",
      password: "qaTest123!",
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error("sign-in failed: " + JSON.stringify(d));
  return d.access_token;
}

function setArm(model) {
  if (model) {
    execFileSync(
      "supabase",
      ["secrets", "set", `${KEY}=${model}`, "--project-ref", STAGING_REF],
      { stdio: "ignore" },
    );
  } else {
    try {
      execFileSync(
        "supabase",
        ["secrets", "unset", KEY, "--project-ref", STAGING_REF],
        { stdio: "ignore" },
      );
    } catch {
      /* already unset */
    }
  }
}

/** One IG call. Returns time-to-first-byte (the plan window) + the plan. */
async function runOnce(token, trip) {
  const t0 = Date.now();
  let firstByte = null;
  const res = await fetch(`${URL}/functions/v1/generate-itinerary`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(trip),
  });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstByte === null) firstByte = Date.now() - t0;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const l of lines) {
      if (!l.startsWith("data: ")) continue;
      const p = l.slice(6).trim();
      if (!p || p === "[DONE]" || p[0] !== '"') continue;
      try {
        text += JSON.parse(p);
      } catch {
        /* partial fragment */
      }
    }
  }
  const total = Date.now() - t0;
  let plan = null;
  try {
    plan = JSON.parse(text);
  } catch {
    /* truncated or non-JSON */
  }
  const days = plan?.days || [];
  return {
    firstByte,
    total,
    parsed: !!plan,
    days: days.length,
    // Quality signals the plan is responsible for.
    withHotel: days.filter((d) => d.hotel).length,
    withNarrative: days.filter((d) => d.story_title && d.narrative).length,
    cities: [...new Set(days.map((d) => d.city).filter(Boolean))],
    emptyDays: days.filter((d) => !(d.activities || []).length).length,
    // A plan that lists the REGION as a base ("South Goa") instead of a
    // real town is a quality smell: the hotel/anchor logic downstream has
    // nothing concrete to geocode.
    regionAsCity: [...new Set(days.map((d) => d.city).filter(Boolean))].some(
      (c) =>
        (trip.destinations || []).some(
          (dest) =>
            dest.split(",")[0].trim().toLowerCase() === c.trim().toLowerCase(),
        ),
    ),
  };
}

const token = await jwt();
const results = [];
for (const arm of ARMS) {
  setArm(arm.model);
  await new Promise((r) => setTimeout(r, 4000)); // let workers pick up the secret
  console.log(`\n══ ${arm.name} ═══════════════════════════`);
  const runs = [];
  for (const trip of TRIPS) {
    for (let i = 0; i < RUNS; i++) {
      const r = await runOnce(token, trip);
      r.trip = trip.id;
      r.expectedDays = trip.numDays;
      runs.push(r);
      if (r.error) console.log(`  ${trip.id} run${i + 1}: ERROR ${r.error}`);
      else
        console.log(
          `  ${trip.id.padEnd(10)} run${i + 1}: ` +
            `plan ${String(r.firstByte).padStart(6)}ms  ` +
            `total ${String(r.total).padStart(6)}ms  ` +
            `days ${r.days}/${trip.numDays}  ` +
            `bases ${r.cities.length}  empty ${r.emptyDays}  ` +
            `regionAsCity ${r.regionAsCity}`,
        );
    }
  }
  results.push({ arm: arm.name, model: arm.model, runs });
}
setArm(null);
console.log("\nrestored: LLM_MODEL_IG_PLAN unset (back to code default)\n");

const med = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};
console.log(
  "arm".padEnd(28) +
    "plan med".padEnd(11) +
    "total med".padEnd(12) +
    "dayShort".padEnd(10) +
    "bases med".padEnd(11) +
    "empty".padEnd(8) +
    "regionAsCity",
);
for (const r of results) {
  const g = r.runs.filter((x) => !x.error);
  if (!g.length) {
    console.log(r.arm.padEnd(28) + "ALL FAILED");
    continue;
  }
  console.log(
    r.arm.padEnd(28) +
      `${med(g.map((x) => x.firstByte))}ms`.padEnd(11) +
      `${med(g.map((x) => x.total))}ms`.padEnd(12) +
      `${g.filter((x) => x.days !== x.expectedDays).length}/${g.length}`.padEnd(
        10,
      ) +
      `${med(g.map((x) => x.cities.length))}`.padEnd(11) +
      `${g.reduce((a, x) => a + x.emptyDays, 0)}`.padEnd(8) +
      `${g.filter((x) => x.regionAsCity).length}/${g.length}`,
  );
}
console.log("\nper-fixture bases (route shape — eyeball these):");
for (const r of results)
  for (const t of TRIPS) {
    const g = r.runs.filter((x) => !x.error && x.trip === t.id);
    if (g.length)
      console.log(
        `  ${r.arm.padEnd(28)} ${t.id.padEnd(10)} ${JSON.stringify(g[0].cities)}`,
      );
  }

const outDir = path.join("scripts", "bench", "out");
fs.mkdirSync(outDir, { recursive: true });
const f = path.join(outDir, `ig-plan-model-${process.env.STAMP || "run"}.json`);
fs.writeFileSync(
  f,
  JSON.stringify({ trips: TRIPS, runs: RUNS, results }, null, 2),
);
console.log(`\nrecord: ${f}`);
