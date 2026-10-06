// Independent re-verification of Phase 0 (billing + adapter), run with:
//   deno run -A scripts/bench/verify-phase0.ts
// Checks the four rate tables agree, that computeLLMCost is arithmetically
// right, and that the adapter's trait/cap logic matches what was measured.
import {
  computeLLMCost,
  costToCredits,
  RATES,
} from "../../supabase/functions/_shared/credits.ts";
import {
  traitsOf,
  suggestCap,
  parseLLMJson,
  providerOf,
} from "../../supabase/functions/_shared/llm.ts";

let fails = 0;
const ok = (c: boolean, label: string, detail = "") => {
  if (!c) fails++;
  console.log(
    `${c ? "  ok  " : "FAIL  "}${label}${detail ? "  — " + detail : ""}`,
  );
};

// ── 1. Rate-table parity across all four copies ─────────────────────────────
const read = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));
function parseJsRates(
  src: string,
  startRe: RegExp,
): Record<string, { input: number; output: number }> {
  const m = src.match(startRe);
  if (!m) throw new Error(`table not found: ${startRe}`);
  const body = src.slice(m.index! + m[0].length);
  const end = body.indexOf("\n};");
  const chunk = body.slice(0, end);
  const out: Record<string, { input: number; output: number }> = {};
  const re =
    /"([^"]+)":\s*\{\s*input:\s*([0-9.]+)\s*(?:\/\s*1_?e?6?[0_]*)?\s*,\s*output:\s*([0-9.]+)\s*(?:\/\s*1_?e?6?[0_]*)?\s*,?\s*\}/g;
  for (const mm of chunk.matchAll(re))
    out[mm[1]] = { input: +mm[2], output: +mm[3] };
  return out;
}
const admin = parseJsRates(
  read("../../src/Admin.jsx"),
  /const COST_RATES = \{/,
);
const script = parseJsRates(
  read("../../scripts/trip-cost.cjs"),
  /const RATES = \{/,
);
const credits = RATES;

console.log("\n── rate-table parity ───────────────────────────────────────");
const allModels = new Set([
  ...Object.keys(credits),
  ...Object.keys(admin),
  ...Object.keys(script),
]);
for (const m of [...allModels].sort()) {
  const c = credits[m],
    a = admin[m],
    s = script[m];
  const same =
    c &&
    a &&
    s &&
    c.input === a.input &&
    c.input === s.input &&
    c.output === a.output &&
    c.output === s.output;
  ok(
    !!same,
    m.padEnd(28),
    `credits ${c ? `${c.input}/${c.output}` : "MISSING"} · admin ${a ? `${a.input}/${a.output}` : "MISSING"} · script ${s ? `${s.input}/${s.output}` : "MISSING"}`,
  );
}

// CLAUDE.md is the fourth copy of the table, written in human names rather
// than model ids — so check the documented PRICES, not just a name mention.
// claude-sonnet-4-6 is deliberately undocumented: legacy rows only.
const md = read("../../CLAUDE.md");
const DOC_NAME: Record<string, string> = {
  "claude-fable-5": "Fable 5",
  "claude-opus-4-8": "Opus 4.8",
  "claude-sonnet-5": "Sonnet 5",
  "claude-sonnet-5-5": "Sonnet 5.5",
  "claude-opus-5-5": "Opus 5.5",
  "claude-haiku-4-5": "Haiku 4.5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
  "gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite",
  "gpt-6-luna": "GPT-6 Luna",
  "gpt-5.6-luna": "GPT-5.6 Luna",
  "gpt-5.4-nano": "GPT-5.4 Nano",
};
console.log(
  "\n── CLAUDE.md documents every billable model at the right price ─",
);
for (const m of Object.keys(credits).sort()) {
  if (m === "claude-sonnet-4-6") {
    console.log(`  --  ${m} (legacy rows only, intentionally undocumented)`);
    continue;
  }
  const name = DOC_NAME[m];
  if (!name) {
    ok(false, `no doc-name mapping for ${m}`);
    continue;
  }
  // "Sonnet 5 $2/$10" — allow Flash-Lite's $0.30 style trailing zeros.
  const re = new RegExp(
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "\\s*\\$([0-9.]+)/\\$([0-9.]+)",
  );
  const hit = md.match(re);
  const good =
    !!hit &&
    Math.abs(+hit[1] - credits[m].input) < 1e-9 &&
    Math.abs(+hit[2] - credits[m].output) < 1e-9;
  ok(
    good,
    `${m.padEnd(28)} documented as "${name}"`,
    hit
      ? `$${hit[1]}/$${hit[2]} vs table ${credits[m].input}/${credits[m].output}`
      : "NOT FOUND in CLAUDE.md",
  );
}

// ── 2. computeLLMCost arithmetic ─────────────────────────────────────────────
console.log("\n── cost arithmetic (measured IG day-fill 3545 in / 2770 out) ─");
const cases: [string, number][] = [
  ["claude-sonnet-5", (3545 * 2) / 1e6 + (2770 * 10) / 1e6],
  ["gpt-6-luna", (3545 * 0.1) / 1e6 + (2770 * 0.5) / 1e6],
  ["gemini-3.8-flash", (3545 * 0.75) / 1e6 + (2770 * 3.75) / 1e6],
  ["claude-haiku-4-5-20251001", (3545 * 1) / 1e6 + (2770 * 5) / 1e6],
];
for (const [model, expect] of cases) {
  const got = computeLLMCost(model, 3545, 2770);
  ok(
    Math.abs(got - expect) < 1e-12,
    `${model.padEnd(28)} $${got.toFixed(6)}`,
    `credits ${costToCredits(got).toFixed(2)}`,
  );
}
const unknown = computeLLMCost("totally-made-up-model", 3545, 2770);
const fable = (3545 * 10) / 1e6 + (2770 * 50) / 1e6;
ok(
  Math.abs(unknown - fable) < 1e-12,
  "unknown model bills at fable-5",
  `$${unknown.toFixed(6)} = ${costToCredits(unknown).toFixed(2)} credits`,
);

console.log("\n── cache multipliers (write 1.25x, read 0.10x of input) ─────");
const cw = computeLLMCost("claude-sonnet-5", 0, 0, 1_000_000, 0);
const cr = computeLLMCost("claude-sonnet-5", 0, 0, 0, 1_000_000);
ok(Math.abs(cw - 2.5) < 1e-9, "1M cache-write tokens on sonnet-5", `$${cw}`);
ok(Math.abs(cr - 0.2) < 1e-9, "1M cache-read tokens on sonnet-5", `$${cr}`);

console.log("\n── credit conversion ceil((usd/0.007)*100)/100 ──────────────");
ok(
  costToCredits(0.007) === 1,
  "exactly $0.007 → 1.00 credit",
  String(costToCredits(0.007)),
);
ok(
  costToCredits(0.00001) === 0.01,
  "tiny cost → 0.01 credit floor",
  String(costToCredits(0.00001)),
);
ok(costToCredits(0) === 0, "zero cost → 0 credits", String(costToCredits(0)));

// ── 3. Adapter traits ────────────────────────────────────────────────────────
console.log("\n── provider routing + traits ────────────────────────────────");
const expectProvider: Record<string, string> = {
  "claude-sonnet-5": "anthropic",
  "claude-haiku-4-5-20251001": "anthropic",
  "gemini-3.8-flash": "google",
  "gemini-3.5-flash-lite": "google",
  "gpt-6-luna": "openai",
  "gpt-5.6-luna": "openai",
};
for (const [m, p] of Object.entries(expectProvider))
  ok(providerOf(m) === p, `${m.padEnd(28)} → ${providerOf(m)}`);

// The quirk that matters most: who gets thinkingBudget:0.
const budgetZero: Record<string, boolean> = {
  "gemini-3.8-flash": true, // NEEDS it (else thought tokens truncate output)
  "gemini-3.1-flash-lite": true, // accepts it
  "gemini-3.5-flash-lite": false, // 400 INVALID_ARGUMENT
  "gemini-flash-lite-latest": false, // 400
};
for (const [m, want] of Object.entries(budgetZero))
  ok(
    traitsOf(m).thinkingBudgetZero === want,
    `thinkingBudgetZero(${m.padEnd(24)}) = ${traitsOf(m).thinkingBudgetZero}`,
    `want ${want}`,
  );

// The thinking off-switch is model-specific and the wrong shape is a hard 400.
// Verified against platform.claude.com 2026-10-05.
console.log("\n-- thinking off-switch shape (wrong shape = 400) ------------");
const thinkShape: Record<string, string | null> = {
  "claude-sonnet-5": "disabled",
  "claude-opus-5": "disabled",
  // Omitting already means no thinking on Opus 4.7/4.8.
  "claude-opus-4-8": null,
  "claude-opus-4-7": null,
  // Sonnet 5.5 returns 400 invalid_request_error for "disabled".
  "claude-sonnet-5-5": "between_tools",
  // Documented "Adaptive (always on)" — the field must be omitted entirely.
  "claude-opus-5-5": null,
  "claude-fable-5": null,
  // Pre-Claude-5: no thinking by default, and temperature IS accepted.
  "claude-haiku-4-5-20251001": null,
  "claude-sonnet-4-6": null,
};
for (const [m, want] of Object.entries(thinkShape)) {
  const got = traitsOf(m).thinkingBody?.type ?? null;
  ok(
    got === want,
    `${m.padEnd(28)} thinking -> ${got ?? "omitted"}`,
    `want ${want ?? "omitted"}`,
  );
}
ok(
  !traitsOf("claude-sonnet-5").allowTemperature,
  "claude-5: temperature rejected",
);
ok(
  traitsOf("claude-sonnet-4-6").allowTemperature,
  "pre-claude-5: temperature allowed",
);
ok(
  traitsOf("claude-haiku-4-5-20251001").allowTemperature,
  "haiku 4.5: temperature allowed",
);
// temperature is rejected on Opus 4.7 and LATER, not just the Claude 5 family.
for (const m of ["claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-5-5"])
  ok(!traitsOf(m).allowTemperature, `${m.padEnd(28)} rejects temperature`);
for (const m of ["claude-opus-4-6", "claude-sonnet-4-6"])
  ok(traitsOf(m).allowTemperature, `${m.padEnd(28)} accepts temperature`);
ok(
  traitsOf("gpt-6-luna").jsonModeBlocksArrays &&
    !traitsOf("gemini-3.8-flash").jsonModeBlocksArrays,
  "json-mode array restriction is OpenAI-only",
);

// ── 4. suggestCap vs the measured peaks ──────────────────────────────────────
console.log("\n── suggestCap vs measured output peaks ──────────────────────");
const sites: [string, number, number][] = [
  // [call site, baseline cap, measured gpt-6-luna peak]
  ["places-proxy repair", 300, 553],
  ["city-deep-dive", 2048, 2048],
  ["IG day fill", 4500, 4043],
  ["RG", 9000, 8710],
];
for (const [site, base, peak] of sites) {
  const cap = suggestCap("gpt-6-luna", base);
  ok(
    cap > peak,
    `${site.padEnd(22)} base ${String(base).padStart(5)} → cap ${String(cap).padStart(5)}`,
    `measured peak ${peak}`,
  );
}
ok(
  suggestCap("claude-sonnet-5", 4500) === 4500,
  "anthropic caps unchanged",
  String(suggestCap("claude-sonnet-5", 4500)),
);

// ── 5. parseLLMJson ──────────────────────────────────────────────────────────
// ── 4b. Minimum cacheable prefix — SILENT failure when unmet ────────────────
// Verified 2026-10-05: Haiku 4.5 needs 4096 tokens, Sonnet 5 needs 1024,
// Sonnet 5.5 / Opus 5 / Opus 5.5 need 512. Below the minimum, cache_control is
// ignored and NO error is returned (both cache_* usage fields come back 0), so
// a prompt edit that crosses a threshold can only be caught statically.
console.log("\n── cacheable? static prompts vs per-model minimums ──────────");
const CACHE_MIN: Record<string, number> = {
  "claude-haiku-4-5-20251001": 4096,
  "claude-sonnet-5": 1024,
  "claude-sonnet-5-5": 512,
};
function promptTokens(fn: string, varName: string): number {
  const src = read(`../../supabase/functions/${fn}/index.ts`);
  const m = src.match(new RegExp("const " + varName + "\\s*=\\s*`"));
  if (!m) return -1;
  let j = m.index! + m[0].length;
  const start = j;
  while (j < src.length) {
    if (src[j] === "\\") {
      j += 2;
      continue;
    }
    if (src[j] === "`") break;
    j++;
  }
  return Math.round((j - start) / 3.7);
}
// [function, const, model it runs on, do we MARK it with cache_control?]
const cacheSites: [string, string, string, boolean][] = [
  ["generate-brainstorm", "SYSTEM_PROMPT", "claude-sonnet-5-5", true],
  ["generate-itinerary", "SYSTEM_PROMPT", "claude-sonnet-5-5", true],
  ["generate-itinerary", "PLAN_SYSTEM", "claude-sonnet-5-5", true],
  ["city-deep-dive", "SYSTEM_PROMPT", "claude-haiku-4-5-20251001", false],
  [
    "generate-destination-research",
    "SYSTEM_PROMPT",
    "claude-haiku-4-5-20251001",
    false,
  ],
];
for (const [fn, v, model, marked] of cacheSites) {
  const toks = promptTokens(fn, v);
  const min = CACHE_MIN[model];
  const willCache = toks >= min;
  // Only a FAILURE when we mark a prefix cacheable that cannot be: that is a
  // silent no-op masquerading as working caching.
  ok(
    !marked || willCache,
    `${(fn + ":" + v).padEnd(44)} ~${toks} tok / ${min} min`,
    marked
      ? willCache
        ? "marked, caches"
        : "MARKED BUT NEVER CACHES"
      : willCache
        ? "unmarked (could cache)"
        : "unmarked, under minimum anyway",
  );
}

console.log("\n── parseLLMJson (fence-safe, array-aware) ───────────────────");
ok(
  JSON.stringify(parseLLMJson('```json\n[{"a":1}]\n```')) === '[{"a":1}]',
  "fenced top-level array",
);
ok(
  JSON.stringify(parseLLMJson('Sure! {"a":[1,2]} hope that helps')) ===
    '{"a":[1,2]}',
  "object with prose around it",
);
ok(parseLLMJson("no json here") === null, "unparseable → null");
ok(
  JSON.stringify(parseLLMJson('{"s":"a [bracket] in a string"}')) ===
    '{"s":"a [bracket] in a string"}',
  "bracket inside a string",
);

console.log(
  `\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} CHECK(S) FAILED`}`,
);
if (fails) Deno.exit(1);
