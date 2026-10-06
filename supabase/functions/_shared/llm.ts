import { captureException } from "./errortrack.ts";
// ─────────────────────────────────────────────────────────────────────────────
// Shared multi-provider LLM adapter.
//
// Every edge function calls LLMs through here so that:
//   1. Each function picks its OWN model independently (per-function env var),
//      and any function can run any supported model.
//   2. Provider idiosyncrasies live in ONE place instead of being rediscovered
//      per function. Each quirk below cost a real debugging session — see
//      TRAITS and the per-provider notes.
//   3. Usage is normalised to Anthropic's DISJOINT {input, cache_read,
//      cache_write, output} shape, which is what _shared/credits.ts bills on.
//      Getting this wrong double-bills users.
//
// Anthropic remains the default path. A model id without a gemini-/gpt- prefix
// behaves exactly as before this file existed.
// ─────────────────────────────────────────────────────────────────────────────

export type Provider = "anthropic" | "google" | "openai";

/** System prompt as cacheable blocks (Anthropic) or plain text. */
export type SystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};
export type SystemInput = string | SystemBlock[];

/**
 * Normalised usage. Mirrors Anthropic's reporting, where the four token
 * buckets are DISJOINT and sum to the billable total. Other providers are
 * converted into this shape (see normalisation notes per provider).
 */
export type LLMUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  web_search_requests?: number;
};

export type LLMResult = {
  text: string;
  usage: LLMUsage;
  /** True when the model stopped because it hit maxTokens (output is partial). */
  truncated: boolean;
  model: string;
  provider: Provider;
  ms: number;
  /** Set when a truncation retry at a larger cap was performed. */
  retriedAtCap?: number;
  /** Populated when `schema` was supplied and honoured: the parsed, correctly
   *  shaped value. Array prompts get the array back even on OpenAI, where it
   *  travelled wrapped. */
  parsed?: unknown;
  /** Set when the provider refused the schema and the call fell back to
   *  prompt-only JSON, so the caller knows the shape is not guaranteed. */
  schemaUnsupported?: boolean;
};

// ── Model traits ─────────────────────────────────────────────────────────────
// Each flag encodes a quirk that silently corrupts output if mishandled.
type Traits = {
  provider: Provider;
  /** The exact `thinking` body to send, or null to omit the field entirely.
   *  The Claude 5 family has thinking ON by default and it eats max_tokens, so
   *  these calls (short structured JSON, no tools) want it off — but HOW you
   *  turn it off differs per model and the wrong shape is a hard 400:
   *    sonnet-5 / opus-5 / opus-4-8 → {type:"disabled"}
   *    sonnet-5-5                   → {type:"between_tools"}  (disabled 400s)
   *    fable-5* / mythos-5*         → omit (thinking always on; disabled 400s)
   *  Pre-Claude-5 Anthropic models omit it and get no thinking by default. */
  thinkingBody: Record<string, string> | null;
  /** Only pre-Claude-5 Anthropic models accept `temperature`. */
  allowTemperature: boolean;
  /** Gemini 3.x (older): needs thinkingConfig.thinkingBudget=0 or thought
   *  tokens eat maxOutputTokens and the body returns truncated to a few chars.
   *  Newer tiers (3.5-flash-lite, *-latest) REJECT it with INVALID_ARGUMENT,
   *  so the call retries once without it. */
  thinkingBudgetZero: boolean;
  /** OpenAI: response_format:{type:"json_object"} CANNOT emit a top-level
   *  JSON array. Prompts that return arrays (RG, todos, expenses) must not
   *  set json mode — gpt-6-luna otherwise replies
   *  {"error":"I must return a raw JSON array..."}. */
  jsonModeBlocksArrays: boolean;
  /** Anthropic prompt caching via cache_control blocks. */
  supportsPromptCache: boolean;
  /** Typical output-token multiplier vs Haiku on the same prompt, measured
   *  2026-10-03. Used by suggestCap() so a verbose model does not silently
   *  truncate at a cap tuned for a terse one. */
  verbosity: number;
};

const CLAUDE5 = /^claude-(opus|sonnet|haiku|fable)-5/;

/**
 * Fire-and-forget PostHog signal for DEGRADED paths. Every fallback in this
 * file used to be console-only, so a provider tightening schema validation
 * would quietly drop every call site to prompt-only JSON and the sole
 * evidence would be an un-grepped edge log line. credits.ts already proved
 * the right pattern with its BILLING ALARM; this is the same idea for
 * quality degradation.
 */
function alarm(kind: string, model: string, detail: string): void {
  console.error(
    `[llm] DEGRADED (${kind}) on ${model}: ${detail.slice(0, 300)}`,
  );
  void captureException(new Error(`llm_degraded:${kind}`), {
    functionName: "_shared/llm",
    model,
    detail: detail.slice(0, 900),
  });
}

export function providerOf(model: string): Provider {
  if (model.startsWith("gemini")) return "google";
  if (model.startsWith("gpt") || /^o[0-9]/.test(model)) return "openai";
  return "anthropic";
}

export function traitsOf(model: string): Traits {
  const provider = providerOf(model);
  if (provider === "anthropic") {
    // Two SEPARATE rules that the old single `isV5` flag conflated:
    //
    // 1. temperature/top_p/top_k are rejected (400) on Claude Opus 4.7 and
    //    LATER — which includes Opus 4.8 and the whole Claude 5 family, but
    //    NOT Opus 4.6, Sonnet 4.6 or Haiku 4.5, where they still work. IG and
    //    generate-wishlist both pass temperature, so getting this wrong is a
    //    hard 400 rather than a silent quality change.
    // 2. How to turn thinking OFF, which differs per model:
    //      sonnet-5 / opus-5          → {type:"disabled"}
    //      sonnet-5-5                 → {type:"between_tools"} ("disabled" 400s)
    //      opus-5-5 / fable-5 / mythos-5 → omit (adaptive always on)
    //      opus-4-8 / opus-4-7        → omit (omitting already means no
    //                                   thinking; "disabled" is also accepted)
    //      opus-4-6 and older         → omit (no thinking by default)
    // Verified against platform.claude.com 2026-10-05.
    const rejectsSampling =
      CLAUDE5.test(model) || /^claude-opus-4-(7|8)/.test(model);
    const thinkingAlwaysOn =
      /^claude-(fable|mythos)-5/.test(model) || /^claude-opus-5-5/.test(model);
    const betweenTools = /^claude-sonnet-5-5/.test(model);
    const needsExplicitOff =
      CLAUDE5.test(model) && !thinkingAlwaysOn && !betweenTools;
    return {
      provider,
      thinkingBody: betweenTools
        ? { type: "between_tools" }
        : needsExplicitOff
          ? { type: "disabled" }
          : null,
      allowTemperature: !rejectsSampling,
      thinkingBudgetZero: false,
      jsonModeBlocksArrays: false,
      supportsPromptCache: true,
      verbosity: 1.0,
    };
  }
  if (provider === "google") {
    // Measured 2026-10-03, and it is NOT a simple version cutoff:
    //   gemini-3.1-flash-lite  → accepts thinkingBudget:0
    //   gemini-3.8-flash       → accepts (and NEEDS it, else output truncates)
    //   gemini-3.5-flash-lite  → REJECTS with 400 INVALID_ARGUMENT
    //   gemini-flash-lite-latest → REJECTS
    // So the reject set is flash-lite at >= 3.5, plus the floating *-latest
    // aliases. Sending it to 3.8-flash is required; sending it to
    // 3.5-flash-lite is a hard 400. callGemini also retries without it on a
    // 400, so a misclassification costs one round trip rather than an outage.
    const ver = parseFloat(model.match(/gemini-(\d+\.?\d*)/)?.[1] ?? "0");
    const rejectsBudgetZero =
      /latest/.test(model) || (/flash-lite/.test(model) && ver >= 3.5);
    return {
      provider,
      thinkingBody: null,
      allowTemperature: false,
      thinkingBudgetZero: !rejectsBudgetZero,
      jsonModeBlocksArrays: false,
      supportsPromptCache: false,
      verbosity: 0.7,
    };
  }
  return {
    provider,
    thinkingBody: null,
    allowTemperature: false,
    thinkingBudgetZero: false,
    jsonModeBlocksArrays: true,
    // Measured output-token ratios vs the Sonnet/Haiku baseline on the SAME
    // prompts (reasoning tokens are billed and counted as output):
    //   IG fill   gpt-6-luna 2770-4043 vs sonnet 1463-2206  (~1.8x)
    //   RG        gpt-6-luna up to 8710 at a 9000 cap        (~1.8x)
    //   repair    gpt-6-luna 160 avg vs haiku 32             (high, but tiny)
    // 1.6x is enough headroom without producing absurd caps; the
    // retry-at-1.5x in callLLM covers the tail.
    verbosity: /gpt-6/.test(model) ? 1.6 : 1.4,
    supportsPromptCache: false,
  };
}

/**
 * Suggested max_tokens for a model, given a cap tuned on Haiku/Sonnet.
 *
 * A single multiplier is not enough: reasoning models carry a roughly FIXED
 * overhead that dominates on small-output tasks. Measured on verify-place
 * repair, gpt-6-luna averaged 160 output tokens against Haiku's 32 (5x) and
 * peaked at 553 — a 1.6x multiplier on the 300 cap would still truncate. On
 * the large IG fill prompt the same model is only ~1.8x. So take the greater
 * of the multiplier and a flat additive headroom.
 */
export function suggestCap(model: string, baselineCap: number): number {
  const t = traitsOf(model);
  if (t.provider === "anthropic")
    return Math.ceil((baselineCap * t.verbosity) / 100) * 100;
  const scaled = baselineCap * t.verbosity;
  const additive = baselineCap + 600;
  return Math.ceil(Math.max(scaled, additive) / 100) * 100;
}

// ── Per-function model selection ─────────────────────────────────────────────
// Precedence: LLM_MODEL_<KEY> → legacy env name → LLM_MODEL_DEFAULT → the
// caller's hardcoded default. This is what lets each function sit on a
// different model independently.
const LEGACY_ENV: Record<string, string[]> = {
  IG: ["IG_MODEL"],
  IG_FILL: ["IG_FILL_MODEL", "IG_MODEL"],
  RG: ["RG_MODEL"],
  CHAT: ["CHAT_MODEL"],
};

/**
 * LLM_MODEL_DEFAULT moves EVERY modelFor() call site at once. It exists so a
 * whole-stack benchmark arm is one secret flip instead of eight, and so a
 * provider outage can be routed around in one move. It is a blunt instrument:
 * per-function vars always win, and any function that depends on a
 * provider-specific server tool (generate-destination-research needs
 * Anthropic's web_search) must NOT read modelFor at all, or this var would
 * point it at a provider that cannot honour the request.
 */
/**
 * Model ids come from free-text Supabase secrets with no validation, and
 * LLM_MODEL_DEFAULT makes one typo global. traitsOf()'s detection is
 * case- and dash-sensitive: "Claude-Sonnet-5-5" would miss the CLAUDE5
 * test, send `temperature` to a model that rejects it (hard 400), AND miss
 * RATES (billing at the fable-5 fallback). Trim + lowercase closes the
 * casing half of that; a dash/dot typo still fails, but loudly and at the
 * provider rather than silently in the trait table.
 */
function normaliseModelId(v: string): string {
  return v.trim().toLowerCase();
}

export function modelFor(key: string, fallback: string): string {
  const k = key.toUpperCase();
  const candidates = [
    `LLM_MODEL_${k}`,
    ...(LEGACY_ENV[k] ?? []),
    "LLM_MODEL_DEFAULT",
  ];
  for (const name of candidates) {
    const v = Deno.env.get(name);
    if (v && v.trim()) return normaliseModelId(v.trim());
  }
  return normaliseModelId(fallback);
}

// ── JSON parsing ─────────────────────────────────────────────────────────────
export type JSONSchema = Record<string, unknown>;

/**
 * Per-provider schema normalisation.
 *
 * Structured outputs (schema-constrained decoding) make a malformed or
 * wrong-shaped response impossible, but the three providers accept DIFFERENT
 * subsets of JSON Schema. Probed against the live APIs 2026-10-05:
 *
 *                            Anthropic   OpenAI   Google
 *   object root                  yes       yes      yes
 *   ARRAY root                   yes       400      yes
 *   property absent from
 *     `required`                 yes       400      yes
 *   minItems > 1                 400       yes      yes
 *   maxItems                     400       yes      yes
 *   minimum / maximum            400       yes      yes
 *   minLength/maxLength/pattern/
 *     format/enum/description/
 *     nullable unions/nesting    yes       yes      yes
 *
 * Call sites therefore write ONE schema in full JSON Schema and this function
 * reshapes it per provider, so pointing a function at a different model stays
 * a string change — the same reason every provider quirk lives in this file.
 */
function normaliseSchema(schema: JSONSchema, provider: Provider): JSONSchema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const n = { ...(node as JSONSchema) };

    if (provider === "anthropic") {
      // Hard 400s, not warnings. minItems:0|1 is allowed, anything above is
      // not; maxItems and numeric bounds are unsupported outright. Dropping
      // them only loosens validation — the prompt still states the intent.
      if (typeof n.minItems === "number" && n.minItems > 1) n.minItems = 1;
      delete n.maxItems;
      if (n.type === "number" || n.type === "integer") {
        delete n.minimum;
        delete n.maximum;
      }
    }

    // Keyed off `properties` rather than type === "object": a nullable
    // nested object carries type ["object","null"], and matching on the
    // string alone would skip OpenAI's required-promotion inside it.
    if (n.properties && typeof n.properties === "object") {
      const props = n.properties as JSONSchema;
      if (provider === "openai") {
        // Strict mode demands every key in `required` AND an explicit
        // additionalProperties:false. An intentionally optional field would
        // 400, so widen its type to include null and require it — the
        // model can then answer "absent" as null rather than by omission.
        const required = new Set(
          Array.isArray(n.required) ? (n.required as string[]) : [],
        );
        // COPY before widening. Writing `pv.type = …` through to `v` mutated
        // the CALLER's schema, and every call site passes a module-level
        // constant — so one OpenAI call would permanently rewrite the shared
        // object for the isolate's life, silently loosening the schema for
        // every later Anthropic/Google call in the same worker.
        const widened: JSONSchema = {};
        for (const [k, v] of Object.entries(props)) {
          const pv = v as JSONSchema;
          if (required.has(k)) {
            widened[k] = pv;
            continue;
          }
          const ty = pv.type;
          widened[k] =
            typeof ty === "string" && ty !== "null"
              ? { ...pv, type: [ty, "null"] }
              : Array.isArray(ty) && !ty.includes("null")
                ? { ...pv, type: [...ty, "null"] }
                : pv;
          required.add(k);
        }
        n.properties = widened;
        n.required = [...required];
        n.additionalProperties = false;
      }
      n.properties = Object.fromEntries(
        Object.entries(n.properties as JSONSchema).map(([k, v]) => [
          k,
          walk(v),
        ]),
      );
    }
    for (const k of [
      "items",
      "anyOf",
      "oneOf",
      "allOf",
      "$defs",
      "definitions",
    ])
      if (k in n) n[k] = walk(n[k]);
    return n;
  };
  return walk(schema) as JSONSchema;
}

/** Test-only export. The per-provider rewriting above is currently dead on
 *  every live schema (all of them list every property as required and use no
 *  clamped keywords), so without a test it would rot unnoticed until the
 *  first genuinely optional field trips it. See _shared/llm.test.ts. */
export const normaliseSchemaForTest = normaliseSchema;

/** OpenAI rejects an array-rooted schema, so array prompts are wrapped as
 *  {items:[...]} on the wire and unwrapped again in callLLM. Every other
 *  provider takes the array root directly. */
function wrapArrayRoot(schema: JSONSchema): JSONSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: { items: schema },
  };
}

/** True when the 400 is the provider refusing our schema rather than
 *  rejecting the request for an unrelated reason. Drives the one-shot retry
 *  without the schema, so an unsupported model degrades to prompt-only JSON
 *  instead of failing the user's request outright. */
function isSchemaRejection(msg: string): boolean {
  return (
    /output_config|response_format|responseJsonSchema|json_schema|responseSchema/i.test(
      msg,
    ) && /not supported|unsupported|invalid|unrecognized|unknown/i.test(msg)
  );
}

/**
 * Fence-safe, array-aware JSON extraction. Models wrap output in ```json
 * fences despite explicit instructions not to, and several prompts (RG,
 * generate-todos, estimate-expenses) return a TOP-LEVEL ARRAY — slicing only
 * between the first "{" and last "}" silently broke all of those.
 */
export function parseLLMJson<T = unknown>(text: string): T | null {
  if (!text) return null;
  const t = text.trim();
  const ob = t.indexOf("{");
  const ar = t.indexOf("[");
  const start = ar >= 0 && (ar < ob || ob < 0) ? ar : ob;
  if (start < 0) return null;
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

const asBlocks = (s: SystemInput): SystemBlock[] =>
  typeof s === "string" ? [{ type: "text", text: s }] : s;
const asText = (s: SystemInput): string =>
  typeof s === "string" ? s : s.map((b) => b.text).join("\n\n");

const emptyUsage = (): LLMUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
});

export type CallOpts = {
  model: string;
  system: SystemInput;
  user: string;
  maxTokens: number;
  /** Ask the provider to guarantee JSON. Ignored when expectArray is true on
   *  a provider whose JSON mode forbids top-level arrays. */
  json?: boolean;
  /** Set when the prompt returns a top-level JSON array. */
  expectArray?: boolean;
  /** JSON Schema for schema-constrained decoding. Write it once in full JSON
   *  Schema; normaliseSchema() reshapes it per provider. When set, the
   *  response cannot be malformed or wrong-shaped, so `parsed` is populated
   *  and the prompt no longer has to beg for clean JSON. */
  schema?: JSONSchema;
  temperature?: number;
  /** Retry once at ceil(1.5x) when the model hits the cap. Default true. */
  retryOnTruncation?: boolean;
  signal?: AbortSignal;
};

// ── Anthropic ────────────────────────────────────────────────────────────────
async function callAnthropic(o: CallOpts, t: Traits): Promise<LLMResult> {
  const body: Record<string, unknown> = {
    model: o.model,
    max_tokens: o.maxTokens,
    stream: false,
    system: asBlocks(o.system),
    messages: [{ role: "user", content: o.user }],
  };
  if (t.thinkingBody) body.thinking = t.thinkingBody;
  else if (t.allowTemperature && o.temperature !== undefined)
    body.temperature = o.temperature;
  if (o.schema)
    body.output_config = {
      format: {
        type: "json_schema",
        schema: normaliseSchema(o.schema, "anthropic"),
      },
    };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: o.signal,
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const d = await res.json();
  const text = (d.content || [])
    .filter((b: { type?: string }) => b.type === "text")
    .map((b: { text?: string }) => b.text || "")
    .join("");
  const u = d.usage || {};
  return {
    text,
    usage: {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      web_search_requests: u.server_tool_use?.web_search_requests,
    },
    truncated: d.stop_reason === "max_tokens",
    model: o.model,
    provider: "anthropic",
    ms: 0,
  };
}

// ── Google Gemini ────────────────────────────────────────────────────────────
async function callGemini(o: CallOpts, t: Traits): Promise<LLMResult> {
  const mk = (withBudgetZero: boolean) => ({
    systemInstruction: { parts: [{ text: asText(o.system) }] },
    contents: [{ role: "user", parts: [{ text: o.user }] }],
    generationConfig: {
      maxOutputTokens: o.maxTokens,
      ...(o.json || o.schema ? { responseMimeType: "application/json" } : {}),
      ...(o.schema
        ? { responseJsonSchema: normaliseSchema(o.schema, "google") }
        : {}),
      ...(withBudgetZero ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });
  const post = (b: unknown) =>
    fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${o.model}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": Deno.env.get("GEMINI_API_KEY") ?? "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(b),
        signal: o.signal,
      },
    );

  let res = await post(mk(t.thinkingBudgetZero));
  // Newer tiers reject thinkingBudget:0 with 400 INVALID_ARGUMENT.
  if (res.status === 400 && t.thinkingBudgetZero) res = await post(mk(false));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);

  const d = await res.json();
  const cand = d?.candidates?.[0];
  const text = (cand?.content?.parts || [])
    .map((p: { text?: string }) => p.text || "")
    .join("");
  const m = d?.usageMetadata || {};
  return {
    text,
    usage: {
      input_tokens: m.promptTokenCount ?? 0,
      // thoughtsTokenCount is billed as OUTPUT; folding it in keeps cost
      // tracking honest (omitting it under-reports spend).
      output_tokens:
        (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: m.cachedContentTokenCount ?? 0,
    },
    truncated: cand?.finishReason === "MAX_TOKENS",
    model: o.model,
    provider: "google",
    ms: 0,
  };
}

// ── OpenAI ───────────────────────────────────────────────────────────────────
async function callOpenAI(o: CallOpts, t: Traits): Promise<LLMResult> {
  // json_object mode cannot produce a top-level array, so skip it for
  // array-returning prompts and rely on prompt compliance instead.
  const useJsonMode = !!o.json && !(o.expectArray && t.jsonModeBlocksArrays);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY") ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: o.model,
      // GPT-5+/o-series use max_completion_tokens; max_tokens is rejected.
      max_completion_tokens: o.maxTokens,
      ...(o.schema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "response",
                strict: true,
                // Array roots are a 400 here, so they ride wrapped and
                // callLLM unwraps them back to a bare array.
                schema: normaliseSchema(
                  o.expectArray ? wrapArrayRoot(o.schema) : o.schema,
                  "openai",
                ),
              },
            },
          }
        : useJsonMode
          ? { response_format: { type: "json_object" } }
          : {}),
      messages: [
        { role: "system", content: asText(o.system) },
        { role: "user", content: o.user },
      ],
    }),
    signal: o.signal,
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const d = await res.json();
  const u = d?.usage || {};
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const choice = d?.choices?.[0];
  return {
    text: choice?.message?.content || "",
    usage: {
      // OpenAI's prompt_tokens INCLUDES cached tokens, whereas the billing
      // model treats the buckets as disjoint. Subtract, or cached input gets
      // charged twice (once at full rate, once at the cache rate).
      input_tokens: Math.max(0, (u.prompt_tokens ?? 0) - cached),
      // completion_tokens includes reasoning tokens, which are billed as output.
      output_tokens: u.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: cached,
    },
    truncated: choice?.finish_reason === "length",
    model: o.model,
    provider: "openai",
    ms: 0,
  };
}

// ── Public entry point ───────────────────────────────────────────────────────
/**
 * Single non-streamed completion, provider-routed by model id.
 *
 * Retries ONCE at 1.5x the cap on truncation. Without this, a verbose model
 * (gpt-6-luna runs 2-5x Haiku's output) silently returns partial JSON at a cap
 * tuned for a terse one — 4 of 12 verify-repair cases failed exactly this way,
 * and they were all the hard judgement cases.
 */
export async function callLLM(opts: CallOpts): Promise<LLMResult> {
  const t = traitsOf(opts.model);
  const run = async (o: CallOpts): Promise<LLMResult> => {
    const t0 = Date.now();
    const r =
      t.provider === "anthropic"
        ? await callAnthropic(o, t)
        : t.provider === "google"
          ? await callGemini(o, t)
          : await callOpenAI(o, t);
    return { ...r, ms: Date.now() - t0 };
  };

  let out: LLMResult;
  try {
    out = await run(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A model that does not implement structured outputs should degrade, not
    // fail the user's request. Retry prompt-only and flag the result so the
    // caller knows the shape is no longer guaranteed.
    if (opts.schema && isSchemaRejection(msg)) {
      alarm("schema_rejected", opts.model, msg);
      out = await run({ ...opts, schema: undefined, json: true });
      out.schemaUnsupported = true;
    } else throw err;
  }
  if (out.truncated && opts.retryOnTruncation !== false) {
    const biggerCap = Math.ceil((opts.maxTokens * 1.5) / 100) * 100;
    console.warn(
      `[llm] ${opts.model} truncated at max_tokens=${opts.maxTokens} — ` +
        `retrying at ${biggerCap}`,
    );
    // Carry the degradation forward. Re-sending a schema the provider just
    // rejected turns the "degrade, don't fail" guarantee into a hard 500 on
    // exactly the path it exists for: schema 400 → prompt-only → truncated →
    // retry WITH the schema again → same 400, thrown outside the catch above.
    const retry = await run(
      out.schemaUnsupported
        ? { ...opts, schema: undefined, json: true, maxTokens: biggerCap }
        : { ...opts, maxTokens: biggerCap },
    );
    // Bill BOTH attempts: the truncated call consumed tokens too.
    retry.usage = mergeUsage(out.usage, retry.usage);
    // Total latency, not just the retry's — this lands in llm_usage.duration_ms
    // and Admin's IG-timing stats under-reported every retried call.
    retry.ms = (out.ms ?? 0) + (retry.ms ?? 0);
    retry.retriedAtCap = biggerCap;
    retry.schemaUnsupported = out.schemaUnsupported;
    out = retry;
  }

  if (opts.schema) {
    // Schema-constrained decoding guarantees well-formed JSON of the right
    // shape — EXCEPT when the response was cut off at max_tokens, where even
    // a schema cannot close the braces. parseLLMJson stays as the fallback
    // for the degraded prompt-only path.
    let value: unknown = null;
    try {
      value = JSON.parse(out.text);
    } catch {
      value = parseLLMJson(out.text);
    }
    // OpenAI array prompts travelled wrapped as {items:[...]}; hand the
    // caller the bare array it asked for, whatever the provider.
    if (
      opts.expectArray &&
      value &&
      !Array.isArray(value) &&
      Array.isArray((value as { items?: unknown }).items)
    )
      value = (value as { items: unknown[] }).items;
    if (value === null)
      alarm(
        "unparseable_under_schema",
        opts.model,
        `truncated=${out.truncated} len=${out.text.length} ${out.text.slice(0, 200)}`,
      );
    out.parsed = value;
  }
  return out;
}

export function mergeUsage(...parts: (LLMUsage | undefined)[]): LLMUsage {
  const acc = emptyUsage();
  for (const p of parts) {
    if (!p) continue;
    acc.input_tokens += p.input_tokens ?? 0;
    acc.output_tokens += p.output_tokens ?? 0;
    acc.cache_creation_input_tokens += p.cache_creation_input_tokens ?? 0;
    acc.cache_read_input_tokens += p.cache_read_input_tokens ?? 0;
    if (p.web_search_requests)
      acc.web_search_requests =
        (acc.web_search_requests ?? 0) + p.web_search_requests;
  }
  return acc;
}

// ── Streaming ────────────────────────────────────────────────────────────────
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; usage: LLMUsage; truncated: boolean };

/**
 * Streamed completion as an async iterator of text deltas, ending with a
 * `done` event carrying normalised usage. Needed by RG / chat / the IG
 * compact phase, which stream to the client.
 */
export async function* streamLLM(
  opts: CallOpts,
): AsyncGenerator<StreamEvent, void, unknown> {
  const t = traitsOf(opts.model);
  // An array-rooted schema has to ride wrapped as {items:[...]} on OpenAI,
  // which 400s on an array root. callLLM can unwrap that on the way out, but
  // a STREAM has no unwrap point — the wrapped object would reach the consumer
  // byte by byte and break every parser expecting a bare array (RG's
  // progressive route scanner, and the client). So the schema is dropped for
  // exactly that combination and the call falls back to prompt-only JSON.
  if (opts.schema && opts.expectArray && t.provider === "openai") {
    console.warn(
      `[llm] ${opts.model}: dropping the output schema for a streamed ` +
        `array — OpenAI would wrap it as {items:[...]} and change the ` +
        `wire shape mid-stream. Falling back to prompt-only JSON.`,
    );
    opts = { ...opts, schema: undefined };
  }
  if (t.provider === "anthropic") {
    const body: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.maxTokens,
      stream: true,
      system: asBlocks(opts.system),
      messages: [{ role: "user", content: opts.user }],
    };
    if (t.thinkingBody) body.thinking = t.thinkingBody;
    else if (t.allowTemperature && opts.temperature !== undefined)
      body.temperature = opts.temperature;
    if (opts.schema)
      body.output_config = {
        format: {
          type: "json_schema",
          schema: normaliseSchema(opts.schema, "anthropic"),
        },
      };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok)
      throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const usage = emptyUsage();
    let truncated = false;
    for await (const ev of sseEvents(res)) {
      const d = safeJson(ev);
      if (!d) continue;
      // A mid-stream `{"type":"error",...}` (overloaded_error, api_error)
      // used to fall through every branch below and the loop would simply
      // end — yielding {type:"done", truncated:false} for a HALF-WRITTEN
      // response. The caller saw a clean success, billed it, and handed the
      // client a truncated JSON array. The non-adapter IG path always
      // handled this; the adapter had regressed it.
      if (d.type === "error")
        throw new Error(
          `Anthropic stream error: ${JSON.stringify(d.error ?? d)}`,
        );
      if (d.type === "content_block_delta" && d.delta?.text)
        yield { type: "delta", text: d.delta.text };
      if (d.type === "message_start" && d.message?.usage) {
        const u = d.message.usage;
        usage.input_tokens += u.input_tokens ?? 0;
        usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
        usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
      }
      if (d.type === "message_delta") {
        usage.output_tokens += d.usage?.output_tokens ?? 0;
        if (d.delta?.stop_reason === "max_tokens") truncated = true;
      }
    }
    yield { type: "done", usage, truncated };
    return;
  }

  if (t.provider === "google") {
    const mk = (budgetZero: boolean) => ({
      systemInstruction: { parts: [{ text: asText(opts.system) }] },
      contents: [{ role: "user", parts: [{ text: opts.user }] }],
      generationConfig: {
        maxOutputTokens: opts.maxTokens,
        ...(opts.json || opts.schema
          ? { responseMimeType: "application/json" }
          : {}),
        ...(opts.schema
          ? { responseJsonSchema: normaliseSchema(opts.schema, "google") }
          : {}),
        ...(budgetZero ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    });
    const post = (b: unknown) =>
      fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": Deno.env.get("GEMINI_API_KEY") ?? "",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(b),
          signal: opts.signal,
        },
      );
    let res = await post(mk(t.thinkingBudgetZero));
    if (res.status === 400 && t.thinkingBudgetZero) res = await post(mk(false));
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const usage = emptyUsage();
    let truncated = false;
    for await (const ev of sseEvents(res)) {
      const d = safeJson(ev);
      if (!d) continue;
      // Same class as the Anthropic `error` event: a mid-stream failure or a
      // safety block must not read as a clean finish.
      if (d.error)
        throw new Error(`Gemini stream error: ${JSON.stringify(d.error)}`);
      if (d.promptFeedback?.blockReason)
        throw new Error(
          `Gemini blocked the prompt: ${d.promptFeedback.blockReason}`,
        );
      const cand = d?.candidates?.[0];
      const text = (cand?.content?.parts || [])
        .map((p: { text?: string }) => p.text || "")
        .join("");
      if (text) yield { type: "delta", text };
      if (cand?.finishReason === "MAX_TOKENS") truncated = true;
      if (
        cand?.finishReason === "SAFETY" ||
        cand?.finishReason === "RECITATION"
      )
        throw new Error(`Gemini stopped: finishReason=${cand.finishReason}`);
      if (d.usageMetadata) {
        // Gemini re-sends cumulative usage per chunk — overwrite, don't add.
        usage.input_tokens = d.usageMetadata.promptTokenCount ?? 0;
        usage.output_tokens =
          (d.usageMetadata.candidatesTokenCount ?? 0) +
          (d.usageMetadata.thoughtsTokenCount ?? 0);
        usage.cache_read_input_tokens =
          d.usageMetadata.cachedContentTokenCount ?? 0;
      }
    }
    yield { type: "done", usage, truncated };
    return;
  }

  // OpenAI
  const useJsonMode =
    !!opts.json && !(opts.expectArray && t.jsonModeBlocksArrays);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY") ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      max_completion_tokens: opts.maxTokens,
      ...(opts.schema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "response",
                strict: true,
                schema: normaliseSchema(
                  opts.expectArray ? wrapArrayRoot(opts.schema) : opts.schema,
                  "openai",
                ),
              },
            },
          }
        : useJsonMode
          ? { response_format: { type: "json_object" } }
          : {}),
      stream: true,
      // Usage is omitted from OpenAI streams unless explicitly requested.
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: asText(opts.system) },
        { role: "user", content: opts.user },
      ],
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const usage = emptyUsage();
  let truncated = false;
  for await (const ev of sseEvents(res)) {
    if (ev === "[DONE]") break;
    const d = safeJson(ev);
    if (!d) continue;
    if (d.error)
      throw new Error(`OpenAI stream error: ${JSON.stringify(d.error)}`);
    const delta = d?.choices?.[0]?.delta?.content;
    if (delta) yield { type: "delta", text: delta };
    if (d?.choices?.[0]?.finish_reason === "length") truncated = true;
    if (d?.usage) {
      const cached = d.usage.prompt_tokens_details?.cached_tokens ?? 0;
      usage.input_tokens = Math.max(0, (d.usage.prompt_tokens ?? 0) - cached);
      usage.output_tokens = d.usage.completion_tokens ?? 0;
      usage.cache_read_input_tokens = cached;
    }
  }
  yield { type: "done", usage, truncated };
}

/** Yields the `data:` payload of each SSE event in a streamed response. */
async function* sseEvents(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
}

function safeJson(s: string): any {
  if (!s || s === "[DONE]") return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
