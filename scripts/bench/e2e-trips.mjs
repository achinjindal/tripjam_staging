// End-to-end funnel exercise: real trips through every LLM step, scored for
// the things a USER would notice rather than for structural validity alone.
//
// Deliberately varied fixtures — a region destination (where base-splitting
// goes wrong), a multi-city route, a long trip, a short single-base trip, and
// an altitude/logistics trip — because every bug found this session showed up
// on one fixture shape and not the others.
//
//   node scripts/bench/e2e-trips.mjs            # all 5, staging
//   TRIPS=japan-7d node scripts/bench/e2e-trips.mjs
//
// Writes full artefacts to scripts/bench/out/e2e-<stamp>/ for review.

import fs from "node:fs";
import path from "node:path";

const env = (() => {
  const o = {};
  for (const l of fs.readFileSync(".env", "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
    if (m) o[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return o;
})();
const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;

const FIXTURES = [
  {
    id: "japan-7d",
    destinations: ["Tokyo, Japan", "Kyoto, Japan"],
    numDays: 7,
    styles: ["History & Culture", "Food & Culinary"],
    pace: "active",
    budget: "mid",
    startDate: "2027-04-05",
    notes: "First time in Japan. We love ramen and old temples.",
  },
  {
    id: "portugal-5d",
    destinations: ["Lisbon, Portugal", "Porto, Portugal"],
    numDays: 5,
    styles: ["Food & Culinary"],
    pace: "relaxed",
    budget: "mid",
    startDate: "2027-05-02",
    notes: "Wine and seafood. We hate early mornings.",
  },
  {
    id: "bali-10d",
    destinations: ["Bali, Indonesia"],
    numDays: 10,
    styles: ["Beaches", "Nature & Outdoors"],
    pace: "relaxed",
    budget: "luxury",
    startDate: "2027-06-14",
    notes: "Honeymoon. Want rice terraces and good spas.",
  },
  {
    id: "iceland-4d",
    destinations: ["Reykjavik, Iceland"],
    numDays: 4,
    styles: ["Nature & Outdoors"],
    pace: "active",
    budget: "mid",
    startDate: "2027-09-18",
    notes: "Northern lights if possible.",
  },
  {
    id: "peru-9d",
    destinations: ["Cusco, Peru", "Machu Picchu, Peru"],
    numDays: 9,
    styles: ["History & Culture", "Nature & Outdoors"],
    pace: "active",
    budget: "budget",
    startDate: "2027-10-03",
    notes: "Worried about altitude. Want to hike.",
  },
];

const only = process.env.TRIPS?.split(",").filter(Boolean);
const RUN = only ? FIXTURES.filter((f) => only.includes(f.id)) : FIXTURES;

const stamp = process.env.STAMP || "run";
const outDir = path.join("scripts", "bench", "out", `e2e-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });

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
  if (!d.access_token) throw new Error("sign-in failed");
  return { token: d.access_token, userId: d.user.id };
}

/** Call an edge function; returns {ms, json|text, status}. Handles SSE. */
async function call(fn, body, token, { stream = false } = {}) {
  const t0 = Date.now();
  const res = await fetch(`${URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ms: Date.now() - t0, status: res.status, error: t.slice(0, 300) };
  }
  if (!stream) {
    const j = await res.json().catch(() => null);
    return { ms: Date.now() - t0, status: res.status, json: j };
  }
  let firstByte = null;
  let acc = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
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
        acc += JSON.parse(p);
      } catch {
        /* partial */
      }
    }
  }
  let json = null;
  try {
    json = JSON.parse(acc);
  } catch {
    /* unparseable */
  }
  return { ms: Date.now() - t0, firstByte, status: res.status, json, raw: acc };
}

const db = (p, init = {}) =>
  fetch(`${URL}/rest/v1/${p}`, {
    ...init,
    headers: {
      apikey: SVC,
      Authorization: `Bearer ${SVC}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

const results = [];
const { token, userId } = await jwt();

for (const f of RUN) {
  const t0 = Date.now();
  const rec = { id: f.id, fixture: f, steps: {}, issues: [] };
  const note = (s) => {
    rec.issues.push(s);
    console.log(`      ! ${s}`);
  };
  console.log(`\n══ ${f.id} — ${f.destinations.join(" + ")}, ${f.numDays}d ══`);

  // 1 ── trip row (so chat and persistence have a real target)
  const tripId = crypto.randomUUID();
  const end = new Date(
    new Date(f.startDate).getTime() + (f.numDays - 1) * 864e5,
  )
    .toISOString()
    .slice(0, 10);
  const ins = await db("trips", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      id: tripId,
      name: `E2E ${f.id}`,
      destination: f.destinations.join(" → "),
      start_date: f.startDate,
      end_date: end,
      created_by: userId,
      owner_id: userId,
    }),
  });
  if (!ins.ok) {
    note(
      `trip insert failed: ${ins.status} ${(await ins.text()).slice(0, 120)}`,
    );
    results.push(rec);
    continue;
  }
  await db("trip_members", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ trip_id: tripId, user_id: userId, role: "edit" }),
  });
  rec.tripId = tripId;

  // 2 ── RG
  const rg = await call(
    "generate-brainstorm",
    { ...f, tripId, travelers: 2 },
    token,
    { stream: true },
  );
  const routes = Array.isArray(rg.json) ? rg.json : [];
  rec.steps.rg = { ms: rg.ms, routes: routes.length, error: rg.error };
  console.log(`  RG       ${rg.ms}ms  routes=${routes.length}`);
  if (rg.error) note(`RG failed: ${rg.error}`);
  if (!rg.error && routes.length < 4)
    note(`RG returned ${routes.length} routes, expected 4`);
  const titles = routes.map((r) => r.title);
  if (new Set(titles).size !== titles.length)
    note(`RG duplicate route titles: ${titles.join(" | ")}`);
  rec.routes = routes;

  // 3 ── IG
  const ig = await call(
    "generate-itinerary",
    {
      destinations: f.destinations,
      numDays: f.numDays,
      travelers: 2,
      budget: f.budget,
      pace: f.pace,
      morningStart: "early",
      styles: f.styles,
      startDate: f.startDate,
      notes: f.notes,
      tripId,
    },
    token,
    { stream: true },
  );
  const days = ig.json?.days || [];
  rec.steps.ig = {
    ms: ig.ms,
    firstByte: ig.firstByte,
    days: days.length,
    error: ig.error,
  };
  console.log(
    `  IG       ${ig.ms}ms (first byte ${ig.firstByte}ms)  days=${days.length}/${f.numDays}`,
  );
  if (ig.error) note(`IG failed: ${ig.error}`);
  rec.itinerary = ig.json;

  // ── user-visible quality checks ──
  if (days.length && days.length !== f.numDays)
    note(`IG produced ${days.length} days, asked for ${f.numDays}`);
  const empty = days.filter((d) => !(d.activities || []).length);
  if (empty.length) note(`${empty.length} day(s) with no activities`);
  const bases = [...new Set(days.map((d) => d.city).filter(Boolean))];
  const cap = Math.ceil(f.numDays / 2);
  if (bases.length > cap)
    note(
      `${bases.length} bases across ${f.numDays} days (rule caps at ${cap}): ${bases.join(", ")}`,
    );
  const region = f.destinations.map((d) =>
    d.split(",")[0].trim().toLowerCase(),
  );
  // A destination that IS a city (Reykjavik, Lisbon) is a perfectly good base —
  // only flag a base that is a REGION or touring route, where "stay in
  // <region>" leaves the hotel and map steps nothing bookable to resolve.
  const REGIONY =
    /\b(goa|bali|tuscany|provence|algarve|kerala|rajasthan|andalusia|patagonia|coast|circle|valley|islands?|region|province)\b/i;
  const unbookable = bases.filter(
    (b) => REGIONY.test(b) || region.includes(b.trim().toLowerCase()),
  );
  if (unbookable.length)
    note(
      `unbookable base(s) — region/route, not a town: ${unbookable.join(", ")}`,
    );
  const allActs = days.flatMap((d) => d.activities || []);
  const noGeo = allActs.filter((a) => !a.geocode);
  if (noGeo.length)
    note(`${noGeo.length}/${allActs.length} activities missing geocode`);
  const generic = allActs.filter((a) =>
    /^(lunch|dinner|breakfast|free time|explore|relax|shopping)$/i.test(
      (a.title || "").trim(),
    ),
  );
  if (generic.length)
    note(
      `${generic.length} generic activity titles: ${generic.map((a) => a.title).join(", ")}`,
    );
  // repeats across days — the rule the prompt calls NO REPEATS
  const seen = new Map();
  for (const d of days)
    for (const a of d.activities || []) {
      const k = (a.title || "").trim().toLowerCase();
      if (!k) continue;
      // Hotel check-ins are SUPPOSED to repeat: returning to the same base
      // after a side trip (Cusco -> Machu Picchu -> Cusco) is exactly what
      // the prompt asks for, not a NO REPEATS violation.
      if (a.type === "hotel" || /^check in at /i.test(k)) continue;
      if (seen.has(k) && seen.get(k) !== d.label)
        note(
          `repeated venue across days: "${a.title}" (${seen.get(k)} and ${d.label})`,
        );
      seen.set(k, d.label);
    }
  const noStory = days.filter((d) => !d.story_title || !d.narrative);
  if (noStory.length)
    note(`${noStory.length} day(s) missing story_title/narrative`);
  const perDay = days.map((d) => (d.activities || []).length);
  if (perDay.some((n) => n > 0 && n < 3))
    note(`thin day(s) with <3 activities: ${perDay.join(",")}`);
  rec.steps.ig.bases = bases;
  rec.steps.ig.activities = allActs.length;

  // 4 ── Inspirations
  const insp = await call(
    "generate-destination-research",
    { destinations: f.destinations, startDate: f.startDate, tripId },
    token,
  );
  const items = insp.json?.digest?.inspirations || [];
  rec.steps.inspirations = {
    ms: insp.ms,
    items: items.length,
    model: insp.json?.model,
    error: insp.error,
  };
  console.log(`  Insp     ${insp.ms}ms  items=${items.length}`);
  if (insp.error) note(`Inspirations failed: ${insp.error}`);
  if (!insp.error && items.length < 5)
    note(
      `Inspirations returned only ${items.length} items (escalation threshold is <5)`,
    );
  const noAuthor = items.filter((i) => !i.author);
  if (noAuthor.length)
    note(`${noAuthor.length} inspiration(s) with no named author`);
  rec.inspirations = items;

  // 5 ── Magazine deep dive (first city)
  const city = (bases[0] || f.destinations[0].split(",")[0]).trim();
  const dd = await call(
    "city-deep-dive",
    { city, country: f.destinations[0].split(",").pop().trim(), tripId },
    token,
  );
  rec.steps.magazine = { ms: dd.ms, city, error: dd.error };
  console.log(`  Magazine ${dd.ms}ms  city=${city}`);
  if (dd.error) note(`Magazine failed for ${city}: ${dd.error}`);
  rec.magazine = dd.json;

  // 6 ── Chat: a question and an edit.
  // The chat function does NOT fetch the trip server-side — by design, the
  // CLIENT builds a slim context (slimChatContext in App.jsx) and sends it,
  // so a payload of just {tripId} leaves Trippy with nothing and it replies
  // "which trip are you planning?". Mirror the real client's shape or this
  // step tests nothing and looks like a product bug.
  const chatCtx = {
    screen: "itinerary",
    trip: {
      id: tripId,
      name: `E2E ${f.id}`,
      destination: f.destinations.join(" → "),
    },
    routes: routes.map((r) => ({
      id: r.id,
      title: r.title,
      city: r.city,
      tagline: r.tagline,
    })),
    days: days.map((d, di) => ({
      id: d.id || `d${di + 1}`,
      label: d.label,
      city: d.city,
      activities: (d.activities || []).map((a, ai) => ({
        id: a.id || `d${di + 1}a${ai + 1}`,
        position: ai,
        time: a.time,
        title: a.title,
        type: a.type,
        duration: a.duration,
      })),
    })),
    form: {},
  };
  const chats = [];
  for (const msg of [
    "What should I pack for this trip?",
    `Add a sunset viewpoint to day 2`,
    "Which day is the most packed?",
  ]) {
    const c = await call(
      "chat",
      { ...chatCtx, message: msg, protocol: 2 },
      token,
    );
    chats.push({
      msg,
      ms: c.ms,
      reply: (c.json?.message || "").slice(0, 400),
      actions: c.json?.actions?.length ?? 0,
      error: c.error,
    });
    console.log(
      `  Chat     ${c.ms}ms  "${msg.slice(0, 32)}…" actions=${c.json?.actions?.length ?? 0}`,
    );
    if (c.error) note(`chat failed: ${c.error}`);
    else if (!c.json?.message) note(`chat returned no message for "${msg}"`);
    else if (/which trip|more context|don't have access/i.test(c.json.message))
      note(
        `chat had no trip context for "${msg}" — client payload shape wrong?`,
      );
  }
  rec.steps.chat = chats;

  rec.totalMs = Date.now() - t0;
  console.log(
    `  TOTAL    ${(rec.totalMs / 1000).toFixed(1)}s   issues=${rec.issues.length}`,
  );
  results.push(rec);
  fs.writeFileSync(
    path.join(outDir, `${f.id}.json`),
    JSON.stringify(rec, null, 2),
  );
}

fs.writeFileSync(
  path.join(outDir, "summary.json"),
  JSON.stringify(results, null, 2),
);
console.log(`\n${"=".repeat(68)}\nSUMMARY`);
console.log(
  `${"trip".padEnd(14)}${"RG".padEnd(8)}${"IG".padEnd(10)}${"days".padEnd(7)}${"insp".padEnd(7)}${"issues"}`,
);
for (const r of results)
  console.log(
    `${r.id.padEnd(14)}${String(r.steps.rg?.routes ?? "-").padEnd(8)}` +
      `${((r.steps.ig?.ms ?? 0) / 1000).toFixed(1) + "s"}`.padEnd(10) +
      `${String(r.steps.ig?.days ?? "-")}/${r.fixture.numDays}`.padEnd(7) +
      `${String(r.steps.inspirations?.items ?? "-").padEnd(7)}${r.issues.length}`,
  );
const all = results.flatMap((r) => r.issues.map((i) => `[${r.id}] ${i}`));
console.log(`\nISSUES (${all.length}):`);
for (const i of all) console.log(`  · ${i}`);
console.log(`\nartefacts: ${outDir}`);
