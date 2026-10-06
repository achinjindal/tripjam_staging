#!/usr/bin/env node
// Measures what the escalation gate is actually reacting to: the PRIMARY
// call's unaided article yield.
//
// The gate escalates on `items < 5 || distinctAuthors < 3`. Now that YouTube
// guarantees ~3 videos, `items < 5` effectively means "fewer than 2 articles",
// so the gate is really a judgement about ARTICLES. Tuning it without knowing
// the article distribution is guesswork — this runs with escalation disabled
// so every digest is Haiku's own output, and reports the distribution.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  loadEnv,
  accessToken,
  signIn,
  STAGING_REF,
  sleep,
  pad,
} from "./lib.mjs";

const KEY = "INSPIRATIONS_ESCALATION_ENABLED";
const DESTS = [
  "Porto",
  "Osaka",
  "Tbilisi",
  "Stepantsminda",
  "Lisbon",
  "Hanoi",
  "Ljubljana",
  "Oaxaca",
];

const supa = (args) =>
  execFileSync("supabase", [...args, "--project-ref", STAGING_REF], {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: accessToken() },
  });

const env = loadEnv();
const SB_URL = env.VITE_SUPABASE_URL,
  ANON = env.VITE_SUPABASE_ANON_KEY;
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
    console.error(`PREFLIGHT FAILED (${r.status})`);
    process.exit(1);
  }
  console.log("preflight ok");
}

const rows = [];
try {
  supa(["secrets", "set", `${KEY}=0`]);
  console.log(
    `escalation DISABLED on staging — measuring unaided primary yield`,
  );
  await sleep(12000);

  for (const d of DESTS) {
    const t0 = Date.now();
    let items = [],
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
            destinations: [d],
            startDate: "2026-11-12",
            bypass_cache: true,
          }),
          signal: AbortSignal.timeout(180000),
        },
      );
      const j = r.ok ? await r.json() : { error: `HTTP ${r.status}` };
      if (j.error) err = j.error;
      items = j?.digest?.inspirations ?? [];
    } catch (e) {
      err = e.message;
    }

    const articles = items.filter((i) => i.type !== "video");
    const videos = items.filter((i) => i.type === "video");
    const authors = new Set(
      items.map((i) => (i.author || "").toLowerCase().trim()),
    );
    // Replicates the live gate so we can see which rule would have fired.
    const wouldEscalate = items.length < 5 || authors.size < 3;
    rows.push({
      dest: d,
      items: items.length,
      articles: articles.length,
      videos: videos.length,
      authors: authors.size,
      wouldEscalate,
      err,
    });
    console.log(
      `  ${pad(d, 15)} items=${pad(items.length, 3)} ` +
        `articles=${pad(articles.length, 3)} videos=${pad(videos.length, 3)} ` +
        `authors=${pad(authors.size, 3)} ` +
        `${wouldEscalate ? "WOULD ESCALATE" : "ok"}` +
        `  ${Date.now() - t0}ms${err ? `  ERR ${err}` : ""}`,
    );
  }
} finally {
  try {
    supa(["secrets", "unset", KEY]);
    console.log("\nescalation re-enabled");
  } catch {
    console.log(
      `\n! re-enable manually: supabase secrets unset ${KEY} --project-ref ${STAGING_REF}`,
    );
  }
}

const ok = rows.filter((r) => !r.err);
const dist = {};
for (const r of ok) dist[r.articles] = (dist[r.articles] || 0) + 1;
console.log(
  `\narticle-count distribution (n=${ok.length}):`,
  Object.fromEntries(Object.entries(dist).sort((a, b) => a[0] - b[0])),
);
const esc = ok.filter((r) => r.wouldEscalate).length;
console.log(
  `gate as-is  (items<5 || authors<3) would escalate: ${esc}/${ok.length}`,
);
for (const t of [1, 2, 3]) {
  const n = ok.filter((r) => r.articles < t).length;
  console.log(
    `gate articles<${t}                  would escalate: ${n}/${ok.length}`,
  );
}
mkdirSync("scripts/bench/out", { recursive: true });
writeFileSync(
  "scripts/bench/out/escalation-yield.json",
  JSON.stringify(rows, null, 2),
);
