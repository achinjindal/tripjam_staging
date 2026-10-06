#!/usr/bin/env node
// Scores the trips produced by run-trips.mjs on two axes:
//
//   1. STRUCTURE — compliance with the itinerary prompt's own hard rules
//      (every rule below is quoted from supabase/functions/generate-itinerary
//      SYSTEM_PROMPT, so this is conformance checking, not taste).
//   2. VENUE REALITY — does each named place exist, is it operating, and is it
//      actually in the city the model put it in. Oracle: Google Places
//      searchText via the already-deployed model-bench rig (BENCH_SECRET),
//      which keeps the check off the user's credit balance and out of
//      llm_usage.
//
//   node scripts/bench/score-trips.mjs scripts/bench/out/<run-dir>
//   node scripts/bench/score-trips.mjs <run-dir> --no-oracle   # structure only
//
// Google answers are cached to <run-dir>/../places-cache.json, so reruns and
// overlapping arms do not re-bill the same lookups.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { loadEnv, sleep, pad, STAGING_REF } from "./lib.mjs";

const dir = process.argv[2];
if (!dir) throw new Error("usage: score-trips.mjs <run-dir> [--no-oracle]");
const NO_ORACLE = process.argv.includes("--no-oracle");
const env = loadEnv();
const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const BENCH_SECRET = process.env.BENCH_SECRET;
const CACHE_PATH = `${dir}/../places-cache.json`;
const cache = existsSync(CACHE_PATH)
  ? JSON.parse(readFileSync(CACHE_PATH, "utf8"))
  : {};

if (!NO_ORACLE && !BENCH_SECRET)
  throw new Error(
    "BENCH_SECRET not set — needed to reach the model-bench verify oracle on " +
      `${STAGING_REF}. Pass --no-oracle to score structure only.`,
  );

// ── oracle ───────────────────────────────────────────────────────────────────
async function verifyPlaces(places) {
  const out = {};
  const todo = [];
  for (const p of places) {
    const key = `${p.name}|${p.city}`.toLowerCase();
    if (cache[key]) out[key] = cache[key];
    else if (!todo.some((t) => `${t.name}|${t.city}`.toLowerCase() === key))
      todo.push(p);
  }
  if (NO_ORACLE || !todo.length) return { out, fetched: 0 };
  // The rig caps at 120 per request and sleeps between Nominatim centroid
  // lookups, so batch small enough to stay inside the edge wall-clock limit.
  for (let i = 0; i < todo.length; i += 35) {
    const batch = todo.slice(i, i + 35);
    const r = await fetch(`${URL}/functions/v1/model-bench?action=verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // model-bench gates on x-bench-secret, but Supabase's own JWT check
        // runs FIRST and rejects the request outright without an auth header.
        Authorization: `Bearer ${ANON}`,
        apikey: ANON,
        "x-bench-secret": BENCH_SECRET,
      },
      body: JSON.stringify({ places: batch }),
    });
    if (!r.ok) {
      console.error(
        `  oracle HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`,
      );
      break;
    }
    const d = await r.json();
    for (const res of d.results || []) {
      const key = `${res.name}|${res.city}`.toLowerCase();
      cache[key] = res;
      out[key] = res;
    }
    process.stdout.write(
      `  oracle ${Math.min(i + 35, todo.length)}/${todo.length}\r`,
    );
    await sleep(500);
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
  return { out, fetched: todo.length };
}

// ── name-match adjudication ──────────────────────────────────────────────────
// Google Places searchText ALWAYS returns its best match — it never answers
// "no such place". Probed 2026-10-05:
//   "Totally Invented Restaurant Xyzzy", Tbilisi → "OtsY • ოცი"        ok
//   "Veshmarkt", Tbilisi (a known Haiku hallucination) → "Dezerter Bazaar" ok
// So the rig's `ok` means "something plausible exists near that city", not
// "this venue is real". Taking it at face value is what produces a 100%
// venue-reality score for every model. The real signal is whether the name
// Google resolved RESEMBLES the name the model invented.
const normalise = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(the|a|an|de|la|le|el|at|in|of|and|cafe|restaurant|hotel|bar|museum|market|bazaar)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

/** Token-overlap similarity (Dice) between the queried and resolved names. */
function nameSimilarity(queried, resolved) {
  const a = new Set(normalise(queried).split(" ").filter(Boolean));
  const b = new Set(normalise(resolved).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/**
 * Re-grade one oracle verdict. Returns a bucket:
 *   real          — Google resolved a name that matches what the model said
 *   alias         — partial match: transliteration, shortened or extended form.
 *                   Needs a human glance but is usually legitimate.
 *   substituted   — Google returned a DIFFERENT place. The model's name does
 *                   not exist as written; this is the hallucination signal.
 *   closed / far / not_found — the rig's own negative verdicts, kept as-is.
 */
function adjudicate(v) {
  if (!v) return "unchecked";
  if (v.reason === "not_found") return "not_found";
  if (v.reason?.startsWith("closed")) return "closed";
  if (v.reason?.endsWith("km_away")) return "far";
  const sim = nameSimilarity(v.name, v.resolved_name);
  if (sim >= 0.6) return "real";
  if (sim >= 0.3) return "alias";
  return "substituted";
}

// ── structural rubric ────────────────────────────────────────────────────────
const NIGHT_WORDS =
  /(night market|night bazaar|rooftop|nightlife|night safari|bar crawl|live music)/i;
const VAGUE_TITLE =
  /^(lunch|dinner|breakfast|free time|explore|city walk|beach day|shopping|relax|optional)\b|^(lunch|dinner|breakfast)\s+(near|at a|in a)\b|\b(a family|a local|a traditional|a seafood)\s+(tavern|taverna|restaurant|bakery|cafe)\b/i;
const GENERIC_HOTEL =
  /^check in(?: at (?:the )?(?:hotel|your hotel|accommodation))?$/i;

const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || "");
  return m ? +m[1] * 60 + +m[2] : null;
};

function scoreStructure(trip) {
  const it = trip.itinerary;
  const issues = [];
  const add = (sev, rule, detail) => issues.push({ sev, rule, detail });
  if (!it?.days?.length) {
    add("fatal", "output", "no itinerary days");
    return { issues, checks: 0 };
  }
  const days = it.days;
  let checks = 0;

  const expect = trip.numDays;
  checks++;
  if (days.length !== expect)
    add("fatal", "day-count", `${days.length} days, asked for ${expect}`);

  if (!it.summary) add("minor", "summary", "top-level summary missing");
  if (!it.cities?.length) add("minor", "cities", "top-level cities[] missing");
  checks += 2;

  const seenTitles = new Map();
  const seenGeocodes = new Map();

  days.forEach((d, i) => {
    const isLast = i === days.length - 1;
    const acts = d.activities || [];
    checks += 6;
    if (!acts.length) {
      add("fatal", "empty-day", `${d.label}: no activities`);
      return;
    }
    if (!d.description) add("minor", "day-description", `${d.label}`);
    if (!d.story_title) add("minor", "story-title", `${d.label}`);
    else if (/^day \d|\b(arrival|departure|return)\b/i.test(d.story_title))
      add(
        "minor",
        "story-title",
        `${d.label}: "${d.story_title}" uses a banned word`,
      );
    if (!d.narrative) add("minor", "narrative", `${d.label}`);
    else if ((d.narrative.match(/[.!?](\s|$)/g) || []).length < 2)
      add("minor", "narrative", `${d.label}: single sentence`);
    if (!d.transit_tip) add("minor", "transit-tip", `${d.label}`);

    let notes = 0;
    acts.forEach((a) => {
      checks += 4;
      const title = (a.title || "").trim();
      if (!title) {
        add("major", "activity-title", `${d.label}: empty title`);
        return;
      }
      // "NO REPEATS: Never schedule the same named venue twice in the whole trip"
      const tkey = title.toLowerCase().replace(/^check in at /i, "");
      if (seenTitles.has(tkey))
        add(
          "major",
          "no-repeats",
          `"${title}" also on ${seenTitles.get(tkey)}`,
        );
      else seenTitles.set(tkey, d.label);

      // "Each activity MUST have a DIFFERENT geocode"
      if (a.geocode) {
        const gkey = a.geocode.toLowerCase();
        if (seenGeocodes.has(gkey))
          add(
            "major",
            "duplicate-geocode",
            `"${a.geocode}" reused (${seenGeocodes.get(gkey)} → ${d.label})`,
          );
        else seenGeocodes.set(gkey, d.label);
        // "geocode = [Specific Place], [neighborhood], [city], [country]"
        if ((a.geocode.match(/,/g) || []).length < 2)
          add("minor", "geocode-unqualified", `"${a.geocode}"`);
      } else if (a.type !== "transit") {
        add("major", "geocode-missing", `${d.label}: ${title}`);
      }

      if (a.type === "hotel") {
        if (GENERIC_HOTEL.test(title) || !/check in at .+/i.test(title))
          add("major", "hotel-title", `"${title}" is not "Check in at <name>"`);
        const m = toMin(a.time);
        // "Any check-in before 14:00 MUST carry the note 'Drop bags…'"
        if (m != null && m < 14 * 60 && !/drop bags/i.test(a.note || ""))
          add("minor", "hotel-dropbags", `${d.label} ${a.time} check-in`);
      } else {
        if (VAGUE_TITLE.test(title))
          add("major", "vague-title", `${d.label}: "${title}"`);
        // "Each activity except transit MUST include gloss / photo_query"
        if (!a.gloss) add("minor", "gloss-missing", `${d.label}: ${title}`);
        if (!a.photo_query)
          add("minor", "photoquery-missing", `${d.label}: ${title}`);
      }

      // "Venues with 'night' in their nature MUST be scheduled 18:00 or later"
      const m = toMin(a.time);
      if (NIGHT_WORDS.test(title) && m != null && m < 18 * 60)
        add("major", "night-venue-daytime", `${d.label} ${a.time}: "${title}"`);

      if (a.note) notes++;
    });

    // "HARD CAP: at most 1 in 4 activities per day may carry a note"
    if (notes > Math.ceil(acts.length / 4))
      add(
        "minor",
        "note-cap",
        `${d.label}: ${notes} notes on ${acts.length} activities`,
      );

    // "Every day MUST include dinner unless the traveler departs before dinner"
    const hasEvening = acts.some((a) => {
      const m = toMin(a.time);
      return m != null && m >= 18 * 60;
    });
    if (!hasEvening && !isLast)
      add("major", "no-dinner", `${d.label}: nothing scheduled after 18:00`);

    // Day 1: arrival 09:00 by flight → 90min buffer, rounded → 10:30 earliest.
    if (i === 0) {
      const first = acts.find((a) => a.type !== "transit");
      const m = toMin(first?.time);
      if (m != null && m < 10 * 60 + 30)
        add(
          "major",
          "day1-arrival",
          `first activity ${first.time} precedes the 10:30 ready time`,
        );
    }
    // Last day must end with transit to the airport/station.
    if (isLast) {
      const hasOut = acts.some(
        (a) =>
          a.type === "transit" &&
          /airport|station|pier|terminal/i.test(
            `${a.title} ${a.geocode} ${a.geocodeEnd || ""}`,
          ),
      );
      if (!hasOut)
        add("major", "departure-transit", "no transit to airport/station");
    }
  });

  return { issues, checks };
}

// ── venue extraction ─────────────────────────────────────────────────────────
function extractPlaces(trip) {
  const out = [];
  const seen = new Set();
  const push = (kind, name, city) => {
    if (!name || !city) return;
    const k = `${kind}|${name}|${city}`.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ kind, name, city });
  };
  for (const d of trip.itinerary?.days || []) {
    const city = d.city || trip.destinations?.[0];
    for (const a of d.activities || []) {
      if (a.type === "transit") continue;
      // Query the bare venue name + city rather than the model's fully
      // qualified geocode: the geocode's own neighbourhood guess can be wrong
      // in a way that makes a REAL place look unfindable.
      const name = (a.title || "").replace(/^check in at /i, "").trim();
      push(a.type === "hotel" ? "hotel" : "activity", name, city);
    }
    for (const w of d.wishlist || []) push("wishlist", w.title, city);
  }
  for (const [city, dd] of Object.entries(trip.magazineDigest || {}))
    for (const s of dd.moreSights || []) push("deepdive-sight", s.title, city);
  return out;
}

// ── run ──────────────────────────────────────────────────────────────────────
const files = readdirSync(dir).filter(
  (f) => f.endsWith(".json") && f !== "summary.json" && f !== "scores.json",
);
const scored = [];
for (const f of files) {
  const trip = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const { issues, checks } = scoreStructure(trip);
  const places = extractPlaces(trip);
  console.log(
    `\n${f}: ${places.length} named places, ${checks} structural checks`,
  );
  const { out: verdicts } = await verifyPlaces(places);

  const byKind = {};
  for (const p of places) {
    const v = verdicts[`${p.name}|${p.city}`.toLowerCase()];
    const b = (byKind[p.kind] = byKind[p.kind] || {
      total: 0,
      real: 0,
      alias: 0,
      substituted: 0,
      not_found: 0,
      closed: 0,
      far: 0,
      unchecked: 0,
      bad: [],
    });
    b.total++;
    const verdict = adjudicate(v);
    b[verdict] = (b[verdict] ?? 0) + 1;
    if (verdict !== "real") {
      b.bad.push({
        name: p.name,
        city: p.city,
        verdict,
        resolved: v?.resolved_name ?? null,
        reason: v?.reason ?? null,
        km: v?.km ?? null,
      });
    }
  }

  const sev = (s) => issues.filter((i) => i.sev === s).length;
  const routesReturned = trip.steps?.rg?.routeCount ?? null;
  if (routesReturned !== null && routesReturned !== 4) {
    issues.push({
      sev: routesReturned === 0 ? "fatal" : "major",
      rule: "rg-route-count",
      detail:
        `RG returned ${routesReturned} items, expected exactly 4 tier-1 ` +
        `routes (the prompt ends "Do NOT generate tier 2 experiences")`,
    });
  }

  scored.push({
    arm: trip.arm,
    trip: trip.trip,
    tripId: trip.tripId,
    costUsd: trip.cost?.usd ?? null,
    days: trip.steps?.ig?.days ?? 0,
    routes: routesReturned,
    rgMs: trip.steps?.rg?.totalMs ?? null,
    firstRouteMs: trip.steps?.rg?.firstRouteMs ?? null,
    igMs: trip.steps?.ig?.totalMs ?? null,
    firstDayMs: trip.steps?.ig?.firstDayMs ?? null,
    repaired: !!trip.steps?.ig?.repaired,
    structure: {
      checks,
      fatal: sev("fatal"),
      major: sev("major"),
      minor: sev("minor"),
      issues,
    },
    venues: byKind,
    problems: trip.problems || [],
  });
}

writeFileSync(`${dir}/scores.json`, JSON.stringify(scored, null, 2));

// ── report ───────────────────────────────────────────────────────────────────
const vt = (v) =>
  Object.values(v).reduce(
    (a, b) => ({
      total: a.total + b.total,
      real: a.real + (b.real ?? 0),
      alias: a.alias + (b.alias ?? 0),
      substituted: a.substituted + (b.substituted ?? 0),
      not_found: a.not_found + (b.not_found ?? 0),
      closed: a.closed + (b.closed ?? 0),
      far: a.far + (b.far ?? 0),
    }),
    {
      total: 0,
      real: 0,
      alias: 0,
      substituted: 0,
      not_found: 0,
      closed: 0,
      far: 0,
    },
  );

console.log("\n\n══ per-trip scorecard ══════════════════════════════════════");
console.log(
  pad("arm", 22) +
    pad("trip", 17) +
    pad("cost", 10) +
    pad("real", 11) +
    pad("alias", 7) +
    pad("SUBST", 7) +
    pad("closed", 7) +
    pad("hotels", 9) +
    pad("fatal", 7) +
    pad("major", 7) +
    "minor",
);
for (const s of scored.sort((a, b) => (a.costUsd ?? 9) - (b.costUsd ?? 9))) {
  const v = vt(s.venues);
  const h = s.venues.hotel;
  console.log(
    pad(s.arm, 22) +
      pad(s.trip, 17) +
      pad(s.costUsd == null ? "-" : `$${s.costUsd.toFixed(4)}`, 10) +
      pad(
        v.total
          ? `${v.real}/${v.total} ${Math.round((100 * v.real) / v.total)}%`
          : "-",
        11,
      ) +
      pad(v.alias, 7) +
      pad(v.substituted, 7) +
      pad(v.closed, 7) +
      pad(h ? `${h.real}/${h.total}` : "-", 9) +
      pad(s.structure.fatal, 7) +
      pad(s.structure.major, 7) +
      s.structure.minor,
  );
}

console.log(
  "\n══ venues needing adjudication ═════════════════════════════\n" +
    "   SUBSTITUTED = Google returned a different place, i.e. the name as\n" +
    "   written does not exist. ALIAS = partial match (transliteration or\n" +
    "   short form), usually legitimate — glance at these.",
);
for (const s of scored) {
  const bad = Object.entries(s.venues).flatMap(([k, v]) =>
    v.bad.map((b) => ({ kind: k, ...b })),
  );
  if (!bad.length) continue;
  console.log(`\n${s.arm} / ${s.trip}:`);
  for (const b of bad.sort((x, y) => (x.verdict < y.verdict ? -1 : 1)))
    console.log(
      `  ${pad(b.verdict, 13)}${pad(b.kind, 15)} ${b.name} (${b.city})` +
        (b.resolved && b.resolved !== b.name ? `  ->  ${b.resolved}` : "") +
        (b.reason && b.reason !== "ok" ? `  [${b.reason}]` : ""),
    );
}
console.log(`\nScores: ${dir}/scores.json`);
