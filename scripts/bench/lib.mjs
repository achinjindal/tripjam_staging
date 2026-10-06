// Shared helpers for the model bench: staging auth, SSE consumption, the
// streaming-JSON timing scanner, and the REST writes that reproduce exactly
// what src/App.jsx persists after a real generation.
import { readFileSync } from "node:fs";

export const STAGING_REF = "wlrzvwjdrjpfqcwgmzch";

export function loadEnv(file = ".env") {
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * Supabase management token.
 *
 * Env var ONLY — deliberately no macOS keychain fallback. Reading the "Supabase
 * CLI" keychain item pops a GUI authorization dialog and BLOCKS the process
 * until someone answers it, which during an unattended multi-arm run means a
 * hung secret flip and a half-applied arm. Source an env file instead.
 */
export function accessToken() {
  return process.env.SUPABASE_ACCESS_TOKEN || null;
}

export class Rest {
  constructor({ url, anon, jwt }) {
    this.url = url;
    this.anon = anon;
    this.jwt = jwt;
  }
  headers(extra = {}) {
    return {
      apikey: this.anon,
      Authorization: `Bearer ${this.jwt}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }
  async select(path) {
    const r = await fetch(`${this.url}/rest/v1/${path}`, {
      headers: this.headers(),
    });
    if (!r.ok)
      throw new Error(`select ${path} → ${r.status} ${await r.text()}`);
    return r.json();
  }
  async insert(table, rows, returning = true) {
    const r = await fetch(`${this.url}/rest/v1/${table}`, {
      method: "POST",
      headers: this.headers({
        Prefer: returning ? "return=representation" : "return=minimal",
      }),
      body: JSON.stringify(rows),
    });
    if (!r.ok)
      throw new Error(`insert ${table} → ${r.status} ${await r.text()}`);
    return returning ? r.json() : null;
  }
  async update(table, filter, patch) {
    const r = await fetch(`${this.url}/rest/v1/${table}?${filter}`, {
      method: "PATCH",
      headers: this.headers({ Prefer: "return=minimal" }),
      body: JSON.stringify(patch),
    });
    if (!r.ok)
      throw new Error(`update ${table} → ${r.status} ${await r.text()}`);
  }
}

export async function signIn({ url, anon, email, password }) {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`sign-in failed: ${JSON.stringify(d)}`);
  return { jwt: d.access_token, userId: d.user.id };
}

/**
 * Timestamps JSON object boundaries inside a growing stream, so we can say when
 * the user would have seen their first route card / first itinerary day.
 * Mirrors the brace-depth parser in App.jsx (tryParseItem): depth counting must
 * ignore braces inside strings and escaped quotes, or a place name containing a
 * brace desynchronises it.
 *
 * `closeDepth` is which nesting level counts as one item, and it differs by
 * endpoint:
 *   RG streams a top-level ARRAY of route objects  → each route closes to 0.
 *   IG streams ONE object whose days are nested     → each day closes to 1.
 * Counting depth 0 on IG is why the first run reported first-day == total: the
 * only depth-0 close in that stream is the very last byte of the whole payload.
 *
 * `afterMarker` gates counting until a literal appears, because IG also emits
 * `"cities":[{...}]` at the same depth as days, BEFORE the days array. The
 * marker is matched across chunk boundaries via a small rolling tail.
 */
export function makeObjectScanner(onObject, opts = {}) {
  const { closeDepth = 0, afterMarker = null } = opts;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let count = 0;
  let armed = !afterMarker;
  let tail = "";
  return (chunk) => {
    // Arming must be POSITION-aware inside the chunk, not chunk-granular.
    // IG's header — {"name":…,"cities":[{…},{…}],"days":[ — usually arrives as
    // ONE fragment, and the cities objects close to the same depth as days. An
    // `armed = true` set before the loop therefore counted a *city* as the
    // first day, which made firstDayMs identical to firstByteMs.
    let armAt = armed ? 0 : Infinity;
    if (!armed) {
      const carry = tail.length;
      tail = (tail + chunk).slice(-(afterMarker.length * 2));
      const hit = (carry > 0 ? tail : chunk).indexOf(afterMarker);
      if (hit >= 0) {
        armed = true;
        // Position within THIS chunk, after which closes may be counted.
        armAt =
          carry > 0
            ? Math.max(
                0,
                hit + afterMarker.length - (tail.length - chunk.length),
              )
            : hit + afterMarker.length;
      }
    }
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (armed && i >= armAt && depth === closeDepth) {
          count++;
          onObject(count);
        }
      }
    }
  };
}

/**
 * POSTs to an edge function and consumes its SSE stream (`data: "<json
 * string>"` events, terminated by `data: [DONE]`), returning the accumulated
 * text plus latency milestones.
 */
export async function streamFunction({
  url,
  jwt,
  fn,
  body,
  timeoutMs = 240000,
  label = "",
  closeDepth = 0,
  afterMarker = null,
}) {
  const t0 = Date.now();
  const marks = { firstByteMs: null, objectMs: [] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${url}/functions/v1/${fn}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`${fn} fetch failed: ${e.message}`);
  }
  if (!res.ok) {
    clearTimeout(timer);
    const text = await res.text();
    const err = new Error(`${fn} → HTTP ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const scan = makeObjectScanner(() => marks.objectMs.push(Date.now() - t0), {
    closeDepth,
    afterMarker,
  });
  let accumulated = "";
  let buf = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        let piece;
        try {
          piece = JSON.parse(raw);
        } catch {
          continue;
        }
        if (typeof piece !== "string") continue;
        if (marks.firstByteMs === null) marks.firstByteMs = Date.now() - t0;
        accumulated += piece;
        scan(piece);
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return {
    text: accumulated,
    totalMs: Date.now() - t0,
    firstByteMs: marks.firstByteMs,
    objectMs: marks.objectMs,
    label,
  };
}

export async function callFunction({ url, jwt, fn, body, timeoutMs = 120000 }) {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/functions/v1/${fn}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body kept as text */
    }
    return { ok: res.ok, status: res.status, json, text, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Fence-safe JSON extraction, array-aware (same rule as _shared/llm.ts). */
export function extractJson(text) {
  if (!text) return null;
  const t = text.trim();
  const ob = t.indexOf("{");
  const ar = t.indexOf("[");
  const start = ar >= 0 && (ar < ob || ob < 0) ? ar : ob;
  if (start < 0) return null;
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * The client's two-step repair for a truncated IG stream: strip trailing
 * commas / escape raw newlines, then close any open containers. Reproduced
 * here so a partial arm result is salvaged the same way a real user's would
 * be, instead of counting as a total failure.
 */
export function repairJson(raw) {
  let t = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const direct = extractJson(t);
  if (direct) return { value: direct, repaired: false };

  let fixed = t.replace(/,(\s*[}\]])/g, "$1");
  let v = extractJson(fixed);
  if (v) return { value: v, repaired: true };

  // Truncation repair: walk the string tracking quote/bracket state, back out
  // of an unterminated string, drop a dangling key or comma, then close.
  const stack = [];
  let inStr = false;
  let esc = false;
  let lastSafe = 0;
  for (let i = 0; i < fixed.length; i++) {
    const c = fixed[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") {
      stack.pop();
      lastSafe = i + 1;
    } else if (c === ",") lastSafe = i;
  }
  let tail = fixed.slice(0, lastSafe).replace(/,\s*$/, "");
  const open = [];
  inStr = false;
  esc = false;
  for (let i = 0; i < tail.length; i++) {
    const c = tail[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{" || c === "[") open.push(c);
    else if (c === "}" || c === "]") open.pop();
  }
  while (open.length) tail += open.pop() === "{" ? "}" : "]";
  v = extractJson(tail);
  return v ? { value: v, repaired: true } : { value: null, repaired: true };
}

/**
 * Reads the billing table out of _shared/credits.ts at runtime rather than
 * keeping a fifth copy. CLAUDE.md already calls a missing RATES entry a
 * billing incident; a bench script with its own hardcoded prices would be a
 * new place for that drift to hide.
 */
export function loadRates(path = "supabase/functions/_shared/credits.ts") {
  const src = readFileSync(path, "utf8");
  const body = src.slice(src.indexOf("export const RATES"));
  const table = body.slice(0, body.indexOf("\n};"));
  const rates = {};
  // Plain form:  "model": { input: N, output: N },
  const re =
    /"([^"]+)":\s*\{\s*input:\s*([0-9.]+)\s*,\s*output:\s*([0-9.]+)\s*,?\s*\}/g;
  for (const m of table.matchAll(re))
    rates[m[1]] = { input: +m[2] / 1e6, output: +m[3] / 1e6 };

  // Date-conditional form, used for promotional rates that step up on a known
  // date:
  //   "model": Date.now() >= Date.UTC(Y, M, D)
  //     ? { input: A, output: B }
  //     : { input: C, output: D },
  // Scraping source with a regex is inherently brittle — adding the ternary to
  // credits.ts silently dropped gemini-3.8-flash from this table and the bench
  // reported a 15x inflated trip cost off the fable-5 fallback. Parse the
  // ternary too, and resolve the SAME date condition the runtime resolves so
  // the two can't disagree.
  const ternary =
    /"([^"]+)":\s*Date\.now\(\)\s*>=\s*Date\.UTC\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*\?\s*\{\s*input:\s*([0-9.]+)\s*,\s*output:\s*([0-9.]+)\s*,?\s*\}\s*:\s*\{\s*input:\s*([0-9.]+)\s*,\s*output:\s*([0-9.]+)\s*,?\s*\}/g;
  for (const m of table.matchAll(ternary)) {
    const after = Date.now() >= Date.UTC(+m[2], +m[3], +m[4]);
    const [inp, outp] = after ? [+m[5], +m[6]] : [+m[7], +m[8]];
    rates[m[1]] = { input: inp / 1e6, output: outp / 1e6 };
  }

  if (!Object.keys(rates).length) throw new Error("could not parse RATES");
  // Fail loudly if a model the bench actually drives is unparseable, rather
  // than letting rowCost quietly fall back to fable-5 ($10/$50) and report a
  // cost that is wrong by up to 100x.
  for (const must of ["gemini-3.8-flash", "gpt-6-luna", "claude-sonnet-5"])
    if (!rates[must])
      throw new Error(
        `loadRates could not parse "${must}" from ${path} — the RATES entry ` +
          `shape changed and every cost number here would be wrong`,
      );
  return rates;
}

export const CACHE_WRITE_MULT = 1.25;
export const CACHE_READ_MULT = 0.1;
export const CREDIT_LLM_BUDGET_USD = 0.007;

/**
 * Per-search fees, parsed from credits.ts so this helper cannot drift from
 * what users are actually billed. These matter more than they look: at
 * $0.01/search an Inspirations call doing 3 searches pays $0.03 in fees —
 * frequently MORE than its token cost. rowCost used to omit them entirely,
 * which made every search-using arm look free.
 */
export function loadSearchFees(path = "supabase/functions/_shared/credits.ts") {
  const src = readFileSync(path, "utf8");
  const grab = (name) => {
    const m = src.match(new RegExp(`${name}\\s*=\\s*([0-9.]+)`));
    if (!m) throw new Error(`could not parse ${name}`);
    return +m[1];
  };
  return {
    anthropic: grab("WEB_SEARCH_COST_USD"),
    google: grab("GOOGLE_GROUNDING_COST_USD"),
  };
}

/** Same arithmetic as computeLLMCost in _shared/credits.ts. */
export function rowCost(row, rates, fees) {
  const r = rates[row.model] || rates["claude-fable-5"];
  const unknown = !rates[row.model];
  // Provider-specific, derived from the model id exactly as credits.ts does.
  const perSearch = fees
    ? /^gemini/.test(row.model || "")
      ? fees.google
      : fees.anthropic
    : 0;
  const usd =
    (row.input_tokens || 0) * r.input +
    (row.cache_creation_tokens || 0) * r.input * CACHE_WRITE_MULT +
    (row.cache_read_tokens || 0) * r.input * CACHE_READ_MULT +
    (row.output_tokens || 0) * r.output +
    (row.web_search_count || 0) * perSearch;
  return { usd, unknown };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const fmtUsd = (n) => `$${n.toFixed(4)}`;
export const pad = (s, n) => String(s).padEnd(n);
