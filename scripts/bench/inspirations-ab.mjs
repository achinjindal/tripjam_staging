#!/usr/bin/env node
// Inspirations A/B: Anthropic web_search (control) vs Gemini Search grounding.
//
//   node scripts/bench/inspirations-ab.mjs            # both arms, all dests
//   node scripts/bench/inspirations-ab.mjs --arm grounded
//
// Why this exists: the grounded path is built but flag-OFF, because a smoke
// test showed it answering WITHOUT searching and inventing a misattributed
// video. Cost alone cannot decide this — so the scorer below measures
// TRUTHFULNESS, not just yield:
//   * every URL is fetched (dead link = fabricated or rotted)
//   * every YouTube link goes through oEmbed, which 400s on a nonexistent id
//     and returns the CANONICAL title/author
//   * the claimed author is compared against oEmbed's ground truth, so
//     "attributed to Mark Wiens but actually someone else" is caught
// A cheaper arm that invents sources is not cheaper, it is broken.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  loadEnv,
  accessToken,
  signIn,
  STAGING_REF,
  loadRates,
  loadSearchFees,
  rowCost,
  sleep,
  fmtUsd,
  pad,
} from "./lib.mjs";

const argv = process.argv.slice(2);
const pick = (f) => {
  const i = argv.indexOf(f);
  return i < 0 ? null : argv[i + 1];
};
const ONLY_ARM = pick("--arm");
const KEY = "INSPIRATIONS_SEARCH";

const ARMS = [
  // flag unset => the Anthropic web_search agentic loop (today's behaviour)
  { id: "anthropic", env: {} },
  // self-served: Brave search + ONE synthesis pass over snippets
  { id: "brave", env: { [KEY]: "brave" } },
];

// Deliberately mixed: two heavily-covered destinations where any approach
// should succeed, and two thin ones that historically triggered escalation.
const DESTS = [
  { id: "porto", destinations: ["Porto"], startDate: "2026-11-12" },
  { id: "osaka", destinations: ["Osaka"], startDate: "2026-11-12" },
  { id: "tbilisi", destinations: ["Tbilisi"], startDate: "2026-11-12" },
  { id: "kazbegi", destinations: ["Stepantsminda"], startDate: "2026-11-12" },
];

const log = (s) => console.log(s);
const supa = (args) =>
  execFileSync("supabase", [...args, "--project-ref", STAGING_REF], {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: accessToken() },
  });

async function applyArm(arm) {
  try {
    supa(["secrets", "unset", KEY]);
  } catch (e) {
    const m = `${e.stderr ?? ""}${e.stdout ?? ""}${e.message ?? ""}`;
    if (!/Secret not found/i.test(m)) throw e;
  }
  const pairs = Object.entries(arm.env).map(([k, v]) => `${k}=${v}`);
  if (pairs.length) supa(["secrets", "set", ...pairs]);
  log(`  secrets: ${pairs.length ? `set ${pairs.join(" ")}` : `unset ${KEY}`}`);
  await sleep(12000); // secret writes restart workers
}

const VIDEO_HOST = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/i;

async function headOrGet(url) {
  // Many CDNs reject HEAD; fall back to a ranged GET rather than scoring a
  // live page as dead.
  try {
    const r = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0", Range: "bytes=0-2048" },
    });
    return r.status;
  } catch {
    return 0;
  }
}

async function oembed(url) {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
    );
    if (!r.ok) return { ok: false, status: r.status };
    const d = await r.json();
    return { ok: true, status: 200, title: d.title, author: d.author_name };
  } catch {
    return { ok: false, status: 0 };
  }
}

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function scoreItems(items) {
  const out = {
    n: items.length,
    blocked: 0,
    videos: 0,
    articles: 0,
    dead: 0,
    fabricated: 0,
    misattributed: 0,
    authors: new Set(),
    detail: [],
  };
  for (const it of items) {
    const url = it.url || "";
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {}
    const isVideo = VIDEO_HOST.test(host);
    if (isVideo) out.videos++;
    else out.articles++;
    if (it.author) out.authors.add(norm(it.author));
    const row = { url, type: it.type, claimed: it.author || "—" };
    if (/youtube|youtu\.be/i.test(host)) {
      const e = await oembed(url);
      row.status = e.status;
      if (!e.ok) {
        out.dead++;
        out.fabricated++;
        row.verdict = "FABRICATED/DEAD";
      } else {
        row.actual = e.author;
        // Substring either way: "Mark Wiens" vs "Mark Wiens Travel" is a match.
        const a = norm(it.author),
          b = norm(e.author);
        const match = a && b && (a.includes(b) || b.includes(a));
        if (!match) {
          out.misattributed++;
          row.verdict = "MISATTRIBUTED";
        } else row.verdict = "ok";
      }
    } else {
      const st = await headOrGet(url);
      row.status = st;
      // Only 404/410 prove absence. 403/406/429 are bot blocks — publishers
      // reject this scorer's UA while serving browsers fine. Counting those
      // as dead invented a 4-vs-1 "regression" that did not exist:
      // bridgesandballoons.com 403s here and is demonstrably live.
      if (st === 404 || st === 410) {
        out.dead++;
        row.verdict = "DEAD";
      } else if (st === 0 || st >= 400) {
        out.blocked++;
        row.verdict = `BLOCKED(${st})`;
      } else row.verdict = "ok";
    }
    out.detail.push(row);
  }
  return out;
}

const env = loadEnv();
const SB_URL = env.VITE_SUPABASE_URL,
  ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
const rates = loadRates();
const fees = loadSearchFees();

async function usageSince(ts) {
  const r = await fetch(
    `${SB_URL}/rest/v1/llm_usage?created_at=gte.${encodeURIComponent(ts)}` +
      `&function_name=like.generate-destination-research*` +
      `&select=function_name,model,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens,web_search_count,created_at`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
  );
  if (!r.ok) {
    // A silent [] here is how the first run reported "$0.0000, no usage rows"
    // for all 8 calls: the select named a column that does not exist
    // (web_search_requests vs web_search_count) and PostgREST 400'd.
    // Never let a broken measurement read as a free arm.
    throw new Error(
      `llm_usage query failed (HTTP ${r.status}): ` +
        `${(await r.text()).slice(0, 200)}`,
    );
  }
  return await r.json();
}

const outDir = `scripts/bench/out/insp-ab-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
mkdirSync(outDir, { recursive: true });

// signIn returns {jwt, userId} — destructure it. Assigning the whole object
// made every Authorization header "Bearer [object Object]", and all 8 calls
// 401'd while the scorer dutifully reported "0 items, 0 videos" for both arms.
// That is indistinguishable from a real quality collapse, so PREFLIGHT below
// proves auth works before any arm is scored: a broken harness must fail
// loudly, never masquerade as a result.
const { jwt } = await signIn({
  url: SB_URL,
  anon: ANON,
  email: "qa-tester@tripjam.app",
  password: "qaTest123!",
});

{
  const r = await fetch(`${SB_URL}/rest/v1/profiles?select=id&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) {
    console.error(
      `PREFLIGHT FAILED: auth is broken (HTTP ${r.status}: ` +
        `${(await r.text()).slice(0, 200)}). Aborting before spending money.`,
    );
    process.exit(1);
  }
  log(`preflight ok — authenticated as qa-tester`);
}

const rows = [];
try {
  for (const arm of ARMS) {
    if (ONLY_ARM && arm.id !== ONLY_ARM) continue;
    log(`\n══ arm ${arm.id} ${"═".repeat(50 - arm.id.length)}`);
    await applyArm(arm);
    for (const d of DESTS) {
      const t0 = Date.now();
      const stamp = new Date(Date.now() - 2000).toISOString();
      let res,
        err = null;
      try {
        const r = await fetch(
          `${SB_URL}/functions/v1/generate-destination-research`,
          {
            method: "POST",
            headers: {
              apikey: ANON,
              Authorization: `Bearer ${jwt}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              destinations: d.destinations,
              startDate: d.startDate,
              bypass_cache: true,
            }),
            signal: AbortSignal.timeout(180000),
          },
        );
        res = r.ok
          ? await r.json()
          : { error: `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };
        if (res.error) err = res.error;
      } catch (e) {
        err = e.message;
        res = {};
      }
      const ms = Date.now() - t0;

      const items = res?.digest?.inspirations ?? res?.inspirations ?? [];
      const sc = await scoreItems(Array.isArray(items) ? items : []);
      await sleep(3000); // let fire-and-forget usage rows land
      const usage = await usageSince(stamp);
      const cost = usage.reduce((a, u) => a + rowCost(u, rates, fees).usd, 0);
      const models = [...new Set(usage.map((u) => u.model))];
      const searches = usage.reduce((a, u) => a + (u.web_search_count || 0), 0);

      if (err && sc.n === 0)
        log(`  ! ${d.id}: call FAILED — this row is not a quality signal`);
      rows.push({
        arm: arm.id,
        dest: d.id,
        ms,
        cost,
        models,
        searches,
        err,
        ...sc,
        authors: sc.authors.size,
      });
      log(
        `  ${pad(d.id, 12)} items=${pad(sc.n, 3)} vid=${pad(sc.videos, 2)} ` +
          `auth=${pad(sc.authors.size, 2)} dead=${pad(sc.dead, 2)} ` +
          `fab=${pad(sc.fabricated, 2)} misattr=${pad(sc.misattributed, 2)} ` +
          `searches=${pad(searches, 2)} ${pad(fmtUsd(cost), 9)} ${ms}ms` +
          (err ? `  ERR ${String(err).slice(0, 80)}` : "") +
          `  [${models.join(",") || "no usage rows"}]`,
      );
      writeFileSync(
        `${outDir}/${arm.id}-${d.id}.json`,
        JSON.stringify(
          { arm: arm.id, dest: d, ms, cost, usage, score: sc, raw: res },
          null,
          2,
        ),
      );
    }
  }
} finally {
  log(`\nRestoring: unsetting ${KEY} (back to Anthropic default)`);
  try {
    supa(["secrets", "unset", KEY]);
    log("  restored");
  } catch (e) {
    const m = `${e.stderr ?? ""}${e.stdout ?? ""}${e.message ?? ""}`;
    if (/Secret not found/i.test(m)) log("  already unset");
    else
      log(
        `  ! FAILED — run: supabase secrets unset ${KEY} --project-ref ${STAGING_REF}`,
      );
  }
}

log(
  `\n${pad("arm", 10)}${pad("items", 7)}${pad("videos", 8)}${pad("authors", 9)}` +
    `${pad("dead", 6)}${pad("fabric", 8)}${pad("misattr", 9)}${pad("searches", 10)}` +
    `${pad("$/call", 10)}${pad("ms", 8)}`,
);
for (const arm of [...new Set(rows.map((r) => r.arm))]) {
  // Only successful calls are averaged; failures are counted separately so a
  // harness or provider error cannot be read as a quality number.
  const all = rows.filter((r) => r.arm === arm);
  const rs = all.filter((r) => !r.err);
  const failed = all.length - rs.length;
  if (!rs.length) {
    log(`${pad(arm, 10)}ALL ${all.length} CALLS FAILED — no signal`);
    continue;
  }
  if (failed)
    log(`${pad(arm, 10)}(${failed}/${all.length} calls failed, excluded)`);
  const sum = (k) => rs.reduce((a, r) => a + (r[k] || 0), 0);
  const avg = (k) => sum(k) / rs.length;
  log(
    pad(arm, 10) +
      pad(avg("n").toFixed(1), 7) +
      pad(avg("videos").toFixed(1), 8) +
      pad(avg("authors").toFixed(1), 9) +
      pad(sum("dead"), 6) +
      pad(sum("fabricated"), 8) +
      pad(sum("misattributed"), 9) +
      pad(avg("searches").toFixed(1), 10) +
      pad(fmtUsd(avg("cost")), 10) +
      pad(Math.round(avg("ms")), 8),
  );
}
writeFileSync(`${outDir}/summary.json`, JSON.stringify(rows, null, 2));
log(`\nRecords: ${outDir}`);
