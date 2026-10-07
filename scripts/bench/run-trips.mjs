#!/usr/bin/env node
// End-to-end model bench: builds REAL, VIEWABLE trips on staging, one per
// (model arm x destination), through the production endpoints.
//
//   node scripts/bench/run-trips.mjs                  # every arm, every trip
//   node scripts/bench/run-trips.mjs --arm gpt-6-luna --trip thailand
//   node scripts/bench/run-trips.mjs --dry-run        # no API calls, no spend
//
// Needs: a Supabase management token (env SUPABASE_ACCESS_TOKEN or the
// "Supabase CLI" keychain entry) to flip staging secrets, and
// SUPABASE_SERVICE_ROLE_KEY to read llm_usage for true per-trip cost.
//
// It drives the same sequence a human does — draft trip -> RG -> pick the
// route the model itself recommends -> extract-preferences -> IG -> persist
// days/activities -> deep dives -> todos -> expenses — and writes the same
// rows App.jsx writes, so every bench trip opens normally in the app.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  loadEnv,
  accessToken,
  signIn,
  Rest,
  streamFunction,
  callFunction,
  extractJson,
  repairJson,
  loadRates,
  rowCost,
  sleep,
  pad,
  STAGING_REF,
} from "./lib.mjs";
import { ARMS, TRIPS, ALL_MODEL_ENV_KEYS } from "./arms.mjs";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1]?.startsWith("--") ? true : argv[i + 1]) : null;
};
const DRY = argv.includes("--dry-run");
const ONLY_ARM = flag("arm");
const ONLY_TRIP = flag("trip");
const KEEP_SECRETS = argv.includes("--keep-secrets");

const env = loadEnv();
const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
if (!URL?.includes(STAGING_REF))
  throw new Error(
    `.env does not point at staging (${STAGING_REF}) — refusing to run a ` +
      `paid benchmark against ${URL}`,
  );

const RATES = loadRates();
const OUT = `scripts/bench/out/${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
const log = (...a) => console.log(...a);

// ── staging secret management ────────────────────────────────────────────────
function supa(args) {
  const token = accessToken();
  if (!token)
    throw new Error(
      "SUPABASE_ACCESS_TOKEN is not set. Source the bench env file " +
        "(. ~/.config/tripjam-bench/env) — the keychain is deliberately not " +
        "consulted because reading it blocks on a GUI prompt.",
    );
  // The global `supabase` binary, never `npx supabase`: npx tries to resolve
  // the package first and hangs for minutes when it is not a local dependency.
  return execFileSync("supabase", [...args, "--project-ref", STAGING_REF], {
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: token,
      SUPABASE_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function applyArm(arm) {
  const setPairs = Object.entries(arm.env).map(([k, v]) => `${k}=${v}`);
  const toUnset = ALL_MODEL_ENV_KEYS.filter((k) => !(k in arm.env));
  log(
    `  secrets: unset ${toUnset.length} key(s)` +
      (setPairs.length ? `, set ${setPairs.join(" ")}` : " (no overrides)"),
  );
  if (DRY) return;
  // Unset first so a key the arm does not define can never leak in from the
  // previous arm. One key per call, tolerating failure: `supabase secrets
  // unset` EXITS 1 with "Secret not found with given name" for a key that
  // isn't set, and a batch call fails the whole batch. Unsetting an absent key
  // is exactly the normal case here, so a throw would abort the run on arm 1.
  for (const key of toUnset) {
    try {
      supa(["secrets", "unset", key]);
    } catch (e) {
      const msg = `${e.stderr ?? ""}${e.stdout ?? ""}${e.message ?? ""}`;
      if (!/Secret not found/i.test(msg)) throw e;
    }
  }
  if (setPairs.length) supa(["secrets", "set", ...setPairs]);
  // Secret writes restart the function workers; give them a beat to come up
  // with the new env before the first call. Propagation is then VERIFIED from
  // llm_usage (see verifyArm) rather than trusted.
  await sleep(12000);
}

/**
 * A warm isolate keeps the env it booted with, so a secret flip is not
 * instantly visible. Rather than trust the sleep above, make one cheap call
 * and read back which model actually ran from llm_usage — the authoritative
 * record, since every function logs the model id it used.
 */
async function verifyArm(arm, ctx) {
  if (DRY || !ctx.service) return { verified: false, reason: "no service key" };
  const expectDefault = arm.env.LLM_MODEL_PREFS || arm.env.LLM_MODEL_DEFAULT;
  const want =
    arm.id === "prod-baseline" ? "claude-haiku-4-5-20251001" : expectDefault;
  if (!want) return { verified: false, reason: "nothing to verify" };
  for (let attempt = 1; attempt <= 6; attempt++) {
    // extract-preferences is the right canary: it is unbilled by design, so
    // the check itself costs the user nothing.
    //
    // tripId MUST be null. llm_usage.trip_id is FK-constrained to trips(id),
    // so a synthetic probe id makes the (fire-and-forget, error-swallowing)
    // usage insert fail silently and the canary never shows up — which reads
    // as "propagation never happened" when the arm was in fact applied.
    const probeAt = new Date(Date.now() - 5000).toISOString();
    await callFunction({
      url: URL,
      jwt: ctx.jwt,
      fn: "extract-preferences",
      body: {
        notes: "we want a luxury trip with late starts and a relaxed pace",
        chatHistory: [],
        tripId: null,
      },
    });
    await sleep(2500);
    const rows = await ctx.serviceSelect(
      `llm_usage?select=model,created_at&function_name=eq.extract-preferences` +
        `&created_at=gte.${probeAt}&order=created_at.desc&limit=1`,
    );
    const got = rows[0]?.model;
    if (got === want) {
      log(`  ✓ arm verified live (extract-preferences ran ${got})`);
      return { verified: true, model: got };
    }
    log(
      `  … propagation attempt ${attempt}/6: saw ${got || "no row"}, want ${want}`,
    );
    await sleep(10000);
  }
  return { verified: false, reason: `never saw ${want}` };
}

// ── the trip pipeline ────────────────────────────────────────────────────────
async function buildTrip(arm, fixture, ctx) {
  const tripId = randomUUID();
  const started = Date.now();
  // Declared up front because finish() closes over both, and the early-return
  // failure paths call it before the happy-path declarations would run.
  let itinerary = null;
  let routes = [];
  const digest = {};
  const steps = {};
  const problems = [];
  const name = `BENCH ${arm.id} · ${fixture.destinations.join("+")}`;

  const igRequest = {
    destinations: fixture.destinations,
    numDays: fixture.numDays,
    travelers: fixture.travelers,
    styles: fixture.styles,
    budget: fixture.budget,
    pace: fixture.pace,
    morningStart: fixture.morningStart,
    notes: fixture.notes,
    startDate: fixture.startDate,
    endDate: fixture.endDate,
  };

  log(`\n── ${arm.id} / ${fixture.id} ───────────────────────────────`);
  log(`   trip ${tripId}`);
  if (DRY) return { arm: arm.id, trip: fixture.id, tripId, dryRun: true };

  const creditsBefore = (
    await ctx.rest.select(`profiles?select=credits&id=eq.${ctx.userId}`)
  )[0].credits;

  // 1. Draft trip row + organizer membership (what doSetupComplete writes).
  await ctx.rest.insert(
    "trips",
    {
      id: tripId,
      name,
      destination: fixture.destinations.join(" → "),
      start_date: fixture.startDate,
      end_date: fixture.endDate,
      created_by: ctx.userId,
      owner_id: ctx.userId,
      ig_request: igRequest,
      notes: fixture.notes,
    },
    false,
  );
  await ctx.rest.insert(
    "trip_members",
    { trip_id: tripId, user_id: ctx.userId, role: "edit" },
    false,
  );

  // 2. Route Generation.
  try {
    const rg = await streamFunction({
      url: URL,
      jwt: ctx.jwt,
      fn: "generate-brainstorm",
      body: {
        destinations: fixture.destinations,
        styles: fixture.styles,
        budget: fixture.budget,
        travelMonth: fixture.travelMonth,
        numDays: fixture.numDays,
        arrivalCity: null,
        departureCity: null,
        notes: fixture.notes,
        existingPlans: null,
        baseLocation: null,
        numPlans: 4,
        travellerStyles: null,
        tripId,
      },
    });
    const parsed = extractJson(rg.text);
    routes = Array.isArray(parsed) ? parsed : [];
    steps.rg = {
      totalMs: rg.totalMs,
      firstByteMs: rg.firstByteMs,
      firstRouteMs: rg.objectMs[0] ?? null,
      routeCount: routes.length,
      chars: rg.text.length,
      parsed: routes.length > 0,
    };
    if (!routes.length) problems.push("RG returned no parseable routes");
    log(
      `   RG  ${rg.totalMs}ms (first card ${steps.rg.firstRouteMs}ms) → ${routes.length} routes`,
    );
  } catch (e) {
    steps.rg = { error: e.message };
    problems.push(`RG failed: ${e.message}`);
    log(`   RG  FAILED: ${e.message}`);
    return finish();
  }

  const tier1 = routes.filter((r) => (r.tier ?? 1) === 1);
  // Pick the route the MODEL recommends — this is itself part of what is
  // being compared, and it keeps selection out of my hands.
  const chosen = tier1.find((r) => r.recommended) || tier1[0];
  if (!chosen) {
    problems.push("no tier-1 route to select");
    return finish();
  }
  steps.rg.chosenTitle = chosen.title;
  steps.rg.chosenByRecommendation = !!chosen.recommended;
  steps.rg.routeCities = chosen.city || null;

  await ctx.rest.insert(
    "brainstorm_items",
    tier1.map((it, i) => ({
      trip_id: tripId,
      title: it.title,
      city: it.city || null,
      category: it.category || "Route",
      note: it.tagline || null,
      icon: it.icon || null,
      position: i,
      tier: 1,
      selected: it === chosen,
      data: {
        tagline: it.tagline || null,
        days: it.days || null,
        bestFor: it.bestFor || null,
        warning: it.warning || null,
        recommended: !!it.recommended,
        points: it.points || null,
        routeLabel: `P${i + 1}`,
      },
    })),
    false,
  );

  // 3. Pre-IG preference extraction (unbilled, but part of the real flow).
  const prefs = await callFunction({
    url: URL,
    jwt: ctx.jwt,
    fn: "extract-preferences",
    body: { notes: fixture.notes, chatHistory: [], tripId },
  });
  steps.prefs = { ms: prefs.ms, ok: prefs.ok, value: prefs.json };

  // 4. Itinerary Generation. Destinations come from the chosen route's city
  //    list, exactly as handleGenerate derives them.
  const igDestinations = chosen.city
    ? chosen.city
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : fixture.destinations;
  const votedItems = tier1.map((it) => ({
    ...it,
    tier: 1,
    vote: it === chosen ? 1 : 0,
  }));
  try {
    const ig = await streamFunction({
      url: URL,
      jwt: ctx.jwt,
      fn: "generate-itinerary",
      // IG streams ONE object: {name, summary, cities:[...], days:[{...}]}.
      // A day object closes to depth 1, and the marker skips the cities[]
      // objects that sit at the same depth earlier in the payload.
      closeDepth: 1,
      afterMarker: '"days":[',
      body: {
        destinations: igDestinations.length
          ? igDestinations
          : fixture.destinations,
        numDays: fixture.numDays,
        travelers: fixture.travelers,
        styles: fixture.styles,
        budget: fixture.budget,
        pace: fixture.pace,
        morningStart: fixture.morningStart,
        notes: fixture.notes,
        startDate: fixture.startDate,
        arrivalCity: null,
        departureCity: null,
        arrivalTime: "09:00",
        departureTime: "22:00",
        arrivalMode: "flight",
        departureMode: "flight",
        votedItems,
        travellerStyles: null,
        tripId,
      },
    });
    const { value, repaired } = repairJson(ig.text);
    itinerary = value;
    const dayObjects = ig.objectMs;
    steps.ig = {
      totalMs: ig.totalMs,
      firstByteMs: ig.firstByteMs,
      // The header streams first, then one object per day, so the first
      // object boundary is the first day the user could read.
      firstDayMs: dayObjects[0] ?? null,
      lastDayMs: dayObjects[dayObjects.length - 1] ?? null,
      chars: ig.text.length,
      repaired,
      parsed: !!itinerary,
      days: itinerary?.days?.length ?? 0,
      emptyDays:
        itinerary?.days?.filter((d) => !d.activities?.length).length ?? null,
    };
    if (!itinerary) problems.push("IG output unparseable even after repair");
    if (repaired) problems.push("IG output needed truncation repair");
    if (steps.ig.days && steps.ig.days !== fixture.numDays)
      problems.push(`IG returned ${steps.ig.days}/${fixture.numDays} days`);
    if (steps.ig.emptyDays)
      problems.push(
        `${steps.ig.emptyDays} day(s) came back with no activities`,
      );
    log(
      `   IG  ${ig.totalMs}ms (first day ${steps.ig.firstDayMs}ms) → ` +
        `${steps.ig.days} days${repaired ? " [repaired]" : ""}`,
    );
  } catch (e) {
    steps.ig = { error: e.message };
    problems.push(`IG failed: ${e.message}`);
    log(`   IG  FAILED: ${e.message}`);
  }

  // 5. Persist the itinerary the way the client does, so it is viewable.
  if (itinerary?.days?.length) {
    const nowIso = new Date().toISOString();
    await ctx.rest.update("trips", `id=eq.${tripId}`, {
      name: `${itinerary.name || name} · ${arm.id}`,
      generation_started_at: new Date(started).toISOString(),
      generation_completed_at: nowIso,
      detailed_ready_at: nowIso,
      ig_request: igRequest,
      ig_response: itinerary,
      ig_count: 1,
      ...(itinerary.summary ? { summary: itinerary.summary } : {}),
      arrival_time: `${fixture.startDate}T09:00:00`,
      departure_time: `${fixture.endDate}T22:00:00`,
    });
    const start = new Date(fixture.startDate);
    for (let i = 0; i < itinerary.days.length; i++) {
      const day = itinerary.days[i];
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const [dayRow] = await ctx.rest.insert("days", {
        trip_id: tripId,
        label: day.label || `Day ${i + 1}`,
        date: d.toISOString().slice(0, 10),
        city: day.city || null,
        position: i,
        description: day.description || null,
        story_title: day.story_title || null,
        narrative: day.narrative || null,
        wishlist: day.wishlist?.length ? day.wishlist : null,
        hotel_options: day.hotelOptions?.length ? day.hotelOptions : null,
        hotel_check_in_time: day.hotelCheckInTime || null,
        transit_tip: day.transit_tip || null,
      });
      const acts = (day.activities || []).map((act, j) => ({
        day_id: dayRow.id,
        // EVERY key needs an explicit null fallback. JSON.stringify DROPS keys
        // whose value is undefined, so one activity missing `duration` yields a
        // row with a different key set, and PostgREST rejects the entire batch
        // with PGRST102 "All object keys must match" — losing the whole trip.
        // (App.jsx escapes this only because it inserts activities one by one.)
        time: act.time ?? null,
        title: act.title ?? null,
        geocode: act.geocode || null,
        geocode_end: act.geocodeEnd || null,
        type: act.type ?? null,
        duration: act.duration ?? null,
        note: act.note ?? null,
        gloss: act.gloss || null,
        photo_query: act.photo_query || null,
        confirmed: act.confirmed ?? false,
        icon: act.icon ?? null,
        package: act.package || null,
        position: j,
        added_by: ctx.userId,
        transition_data: act.transition || null,
      }));
      if (acts.length) {
        try {
          await ctx.rest.insert("activities", acts, false);
        } catch (e) {
          // Never lose a whole trip to one malformed activity: fall back to
          // row-at-a-time and record which ones the model made unusable.
          problems.push(
            `activity batch insert failed (${e.message.slice(0, 80)}) — retried per row`,
          );
          let dropped = 0;
          for (const a of acts) {
            try {
              await ctx.rest.insert("activities", a, false);
            } catch {
              dropped++;
            }
          }
          if (dropped)
            problems.push(
              `${dropped} activity row(s) rejected on ${day.label}`,
            );
        }
      }
    }
    log(`   saved ${itinerary.days.length} days`);
  }

  // 6. Magazine deep dives — destination + first two route cities, which is
  //    what the app loads when the routes screen renders.
  const ddTargets = [fixture.destinations[0], ...igDestinations.slice(0, 2)]
    .filter((c, i, a) => c && a.indexOf(c) === i)
    .slice(0, 3);
  steps.deepDives = [];
  for (const city of ddTargets) {
    const r = await callFunction({
      url: URL,
      jwt: ctx.jwt,
      fn: "city-deep-dive",
      body: {
        city,
        country: fixture.destinations.join(" → "),
        travelMonth: fixture.travelMonth,
        styles: fixture.styles,
        budget: fixture.budget,
        notes: fixture.notes,
        tripDays: fixture.numDays,
        tripId,
      },
    });
    const ok = r.ok && r.json && !r.json.error;
    steps.deepDives.push({
      city,
      ms: r.ms,
      ok,
      sights: r.json?.moreSights?.length ?? 0,
      foods: r.json?.foodSpecialties?.length ?? 0,
      error: ok ? null : r.json?.error || `HTTP ${r.status}`,
    });
    if (ok) digest[city] = r.json;
    else
      problems.push(`deep-dive ${city} failed: ${r.json?.error || r.status}`);
  }
  if (Object.keys(digest).length)
    await ctx.rest.update("trips", `id=eq.${tripId}`, {
      magazine_digest: digest,
    });
  log(
    `   deep dives: ${steps.deepDives.filter((d) => d.ok).length}/${ddTargets.length} ok`,
  );

  // 7. Board: todos + expenses (both take the whole trip row).
  const tripRow = (await ctx.rest.select(`trips?select=*&id=eq.${tripId}`))[0];
  for (const [fn, key] of [
    ["generate-todos", "todos"],
    ["estimate-expenses", "expenses"],
  ]) {
    const r = await callFunction({
      url: URL,
      jwt: ctx.jwt,
      fn,
      body: { trip: { ...tripRow, travelers: fixture.travelers } },
    });
    const items = r.json?.items;
    steps[key] = {
      ms: r.ms,
      ok: r.ok && Array.isArray(items) && items.length > 0,
      count: Array.isArray(items) ? items.length : 0,
      error: r.ok ? null : r.json?.error || `HTTP ${r.status}`,
    };
    if (!steps[key].ok)
      problems.push(
        `${fn} returned ${steps[key].count} items${r.ok ? " (parse likely failed)" : `: ${steps[key].error}`}`,
      );
  }
  log(`   todos ${steps.todos.count} · expenses ${steps.expenses.count}`);

  // 8. Inspirations. Gated on IG in the app, so it runs last — and it is the
  // largest single cost centre, so omitting it (as this harness did until
  // 2026-10-06) understated a trip's true cost by roughly half.
  {
    const r = await callFunction({
      url: URL,
      jwt: ctx.jwt,
      fn: "generate-destination-research",
      body: {
        destinations: fixture.destinations,
        notes: fixture.notes,
        startDate: fixture.startDate,
        tripId,
      },
      timeoutMs: 180000,
    });
    const items = r.json?.digest?.inspirations;
    steps.inspirations = {
      ms: r.ms,
      ok: r.ok && Array.isArray(items) && items.length > 0,
      count: Array.isArray(items) ? items.length : 0,
      videos: Array.isArray(items)
        ? items.filter((i) => i.type === "video").length
        : 0,
      cached: !!r.json?.cached,
      error: r.ok ? null : r.json?.error || `HTTP ${r.status}`,
    };
    if (!steps.inspirations.ok)
      problems.push(
        `inspirations returned ${steps.inspirations.count} items${r.ok ? "" : `: ${steps.inspirations.error}`}`,
      );
    log(
      `   inspirations ${steps.inspirations.count} items ` +
        `(${steps.inspirations.videos} video)${steps.inspirations.cached ? " [cached]" : ""}`,
    );
  }

  return finish();

  async function finish() {
    // Usage rows land in background tasks after the response closes.
    await sleep(6000);
    let usage = [];
    if (ctx.service) {
      usage = await ctx.serviceSelect(
        `llm_usage?select=function_name,model,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens,duration_ms&trip_id=eq.${tripId}`,
      );
    }
    const byFn = {};
    let totalUsd = 0;
    let unknownModel = null;
    for (const row of usage) {
      const { usd, unknown } = rowCost(row, RATES);
      if (unknown) unknownModel = row.model;
      totalUsd += usd;
      const k = `${row.function_name}|${row.model}`;
      byFn[k] = byFn[k] || {
        function: row.function_name,
        model: row.model,
        calls: 0,
        input: 0,
        output: 0,
        cacheWrite: 0,
        cacheRead: 0,
        usd: 0,
      };
      const b = byFn[k];
      b.calls++;
      b.input += row.input_tokens || 0;
      b.output += row.output_tokens || 0;
      b.cacheWrite += row.cache_creation_tokens || 0;
      b.cacheRead += row.cache_read_tokens || 0;
      b.usd += usd;
    }
    if (unknownModel)
      problems.push(
        `BILLING: ${unknownModel} is not in RATES — billed at fable-5`,
      );
    const creditsAfter = (
      await ctx.rest.select(`profiles?select=credits&id=eq.${ctx.userId}`)
    )[0].credits;

    const result = {
      arm: arm.id,
      armEnv: arm.env,
      trip: fixture.id,
      tripId,
      url: `/trip/${tripId}`,
      destinations: fixture.destinations,
      numDays: fixture.numDays,
      wallMs: Date.now() - started,
      steps,
      cost: {
        usd: totalUsd,
        creditsCharged: +(creditsBefore - creditsAfter).toFixed(2),
        byFunction: Object.values(byFn).sort((a, b) => b.usd - a.usd),
        usageRows: usage.length,
      },
      problems,
    };
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      `${OUT}/${arm.id}__${fixture.id}.json`,
      JSON.stringify(
        { ...result, itinerary, routes, magazineDigest: digest },
        null,
        2,
      ),
    );
    log(
      `   cost $${totalUsd.toFixed(4)} · ${result.cost.creditsCharged} credits · ` +
        `${problems.length} problem(s)`,
    );
    return result;
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
const arms = ARMS.filter((a) => !ONLY_ARM || a.id === ONLY_ARM);
const trips = TRIPS.filter((t) => !ONLY_TRIP || t.id === ONLY_TRIP);
if (!arms.length) throw new Error(`no arm matches --arm ${ONLY_ARM}`);
if (!trips.length) throw new Error(`no trip matches --trip ${ONLY_TRIP}`);

const { jwt, userId } = DRY
  ? { jwt: "dry", userId: "dry" }
  : await signIn({
      url: URL,
      anon: ANON,
      email: process.env.BENCH_EMAIL || "qa-tester@tripjam.app",
      password: process.env.BENCH_PASSWORD || "qaTest123!",
    });

const service = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
const ctx = {
  jwt,
  userId,
  service,
  rest: new Rest({ url: URL, anon: ANON, jwt }),
  serviceSelect: async (path) => {
    const r = await fetch(`${URL}/rest/v1/${path}`, {
      headers: { apikey: service, Authorization: `Bearer ${service}` },
    });
    if (!r.ok) throw new Error(`service select → ${r.status}`);
    return r.json();
  },
};
if (!service)
  log(
    "! SUPABASE_SERVICE_ROLE_KEY not set — per-call llm_usage cost will be " +
      "blank; only the credit delta will be recorded.",
  );

log(
  `Bench: ${arms.length} arm(s) x ${trips.length} trip(s) = ` +
    `${arms.length * trips.length} trips on staging as ${userId}`,
);
log(`Output: ${OUT}`);

const results = [];
try {
  for (const arm of arms) {
    log(`\n══ arm ${arm.id} ══════════════════════════════════════════`);
    await applyArm(arm);
    const v = await verifyArm(arm, ctx);
    if (!v.verified)
      log(`  ! arm not verified (${v.reason}) — results will be flagged`);
    for (const fixture of trips) {
      try {
        const r = await buildTrip(arm, fixture, ctx);
        results.push({ ...r, armVerified: v.verified });
      } catch (e) {
        log(`   ABORTED: ${e.message}`);
        results.push({
          arm: arm.id,
          trip: fixture.id,
          fatal: e.message,
          armVerified: v.verified,
        });
      }
    }
  }
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(results, null, 2));
  if (!DRY && !KEEP_SECRETS) {
    log("\nRestoring staging to the default model configuration…");
    try {
      // Per key, tolerant: a batch unset fails as a unit the moment ONE key is
      // already absent, which is the normal end state — and a failed restore
      // leaves staging pinned to the LAST arm's models. That happened on the
      // 2026-10-05 run: staging was left on recommended-mix.
      let restored = 0;
      for (const key of ALL_MODEL_ENV_KEYS) {
        try {
          supa(["secrets", "unset", key]);
          restored++;
        } catch (e) {
          const msg = `${e.stderr ?? ""}${e.stdout ?? ""}${e.message ?? ""}`;
          if (!/Secret not found/i.test(msg))
            log(`  ! could not unset ${key}: ${msg.slice(0, 120)}`);
        }
      }
      log(
        `  ${restored} model secret(s) unset — staging is back on code defaults`,
      );
    } catch (e) {
      log(`  ! FAILED to restore secrets: ${e.message}`);
      log(
        `  ! run: supabase secrets unset ${ALL_MODEL_ENV_KEYS.join(" ")} --project-ref ${STAGING_REF}`,
      );
    }
  }
}

// ── summary table ────────────────────────────────────────────────────────────
log("\n");
log(
  pad("arm", 22) +
    pad("trip", 17) +
    pad("cost", 10) +
    pad("cr", 7) +
    pad("RG ms", 8) +
    pad("IG ms", 8) +
    pad("days", 6) +
    "problems",
);
for (const r of results) {
  if (r.fatal || r.dryRun) {
    log(
      pad(r.arm, 22) +
        pad(r.trip, 17) +
        (r.fatal ? `FATAL ${r.fatal}` : "dry-run"),
    );
    continue;
  }
  log(
    pad(r.arm + (r.armVerified ? "" : "?"), 22) +
      pad(r.trip, 17) +
      pad(`$${r.cost.usd.toFixed(4)}`, 10) +
      pad(r.cost.creditsCharged, 7) +
      pad(r.steps.rg?.totalMs ?? "-", 8) +
      pad(r.steps.ig?.totalMs ?? "-", 8) +
      pad(r.steps.ig?.days ?? "-", 6) +
      (r.problems.length ? r.problems.join("; ") : "none"),
  );
}
log(`\nFull records: ${OUT}`);
log(
  `View a trip: npm run dev, sign in as qa-tester, open ` +
    `http://localhost:5173/trip/<id>`,
);
