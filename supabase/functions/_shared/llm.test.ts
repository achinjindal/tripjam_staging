// Unit tests for the pure parts of the multi-provider adapter.
//
// These exist because nothing in llm.ts is reachable by Playwright except
// end-to-end through three paid providers, while the riskiest behaviours are
// pure functions whose failures are silent or expensive:
//   * traitsOf sends the WRONG thinking shape -> hard 400 on every call
//   * normaliseSchema mutating a caller's schema -> cross-provider corruption
//     that persists for the isolate's life
//   * the per-provider schema reshaping is otherwise never exercised, because
//     no live schema currently uses the keywords it rewrites
//
// Run: npm run test:functions
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  providerOf,
  traitsOf,
  suggestCap,
  turnsOf,
  parseLLMJson,
  mergeUsage,
  normaliseSchemaForTest as normaliseSchema,
} from "./llm.ts";

// ── provider routing ────────────────────────────────────────────────────────
Deno.test("providerOf routes by model-id prefix", () => {
  assertEquals(providerOf("claude-sonnet-5-5"), "anthropic");
  assertEquals(providerOf("gemini-3.8-flash"), "google");
  assertEquals(providerOf("gpt-6-luna"), "openai");
  assertEquals(providerOf("o1-preview"), "openai");
});

// ── the thinking off-switch matrix ──────────────────────────────────────────
// Each shape below is a HARD 400 on the wrong model, which is why this is
// table-driven rather than spot-checked.
Deno.test("traitsOf picks the right thinking shape per model", () => {
  const cases: [string, Record<string, string> | null][] = [
    ["claude-sonnet-5", { type: "disabled" }],
    ["claude-opus-5", { type: "disabled" }],
    // sonnet-5-5 REJECTS {type:"disabled"}; between_tools is the only off-switch
    ["claude-sonnet-5-5", { type: "between_tools" }],
    ["claude-sonnet-5-5-20261001", { type: "between_tools" }],
    // thinking is always on; sending `disabled` 400s
    ["claude-opus-5-5", null],
    ["claude-fable-5", null],
    // pre-Claude-5: no thinking by default, field omitted
    ["claude-haiku-4-5-20251001", null],
    ["claude-sonnet-4-6", null],
  ];
  for (const [model, want] of cases) {
    assertEquals(
      traitsOf(model).thinkingBody,
      want,
      `thinkingBody for ${model}`,
    );
  }
});

Deno.test("traitsOf: sampling params only where accepted", () => {
  // Rejected on Opus 4.7+ and the whole Claude 5 family.
  for (const m of [
    "claude-sonnet-5",
    "claude-sonnet-5-5",
    "claude-opus-5",
    "claude-opus-4-7",
    "claude-opus-4-8",
  ]) {
    assertEquals(traitsOf(m).allowTemperature, false, `${m} rejects sampling`);
  }
  for (const m of ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"]) {
    assertEquals(traitsOf(m).allowTemperature, true, `${m} accepts sampling`);
  }
});

Deno.test("traitsOf: OpenAI json-mode cannot emit a top-level array", () => {
  assertEquals(traitsOf("gpt-6-luna").jsonModeBlocksArrays, true);
  assertEquals(traitsOf("claude-sonnet-5").jsonModeBlocksArrays, false);
  assertEquals(traitsOf("gemini-3.8-flash").jsonModeBlocksArrays, false);
});

Deno.test(
  "traitsOf: thinkingBudget flag only on Gemini tiers that accept it",
  () => {
    assertEquals(traitsOf("gemini-3.8-flash").thinkingBudgetZero, true);
    // >=3.5 flash-lite and *-latest reject the flag with a 400
    assertEquals(traitsOf("gemini-3.5-flash-lite").thinkingBudgetZero, false);
    assertEquals(traitsOf("gemini-3.8-flash-latest").thinkingBudgetZero, false);
  },
);

// ── schema normalisation ────────────────────────────────────────────────────
// The purity test is the important one: the OpenAI required-promotion used to
// write through to the caller's object, and every call site passes a
// module-level constant.
Deno.test("normaliseSchema does not mutate the caller's schema", () => {
  const schema = {
    type: "object",
    required: ["city"], // `tip` deliberately optional -> triggers promotion
    properties: {
      city: { type: "string" },
      tip: { type: "string" },
      nested: {
        type: "object",
        required: [],
        properties: { deep: { type: "string" } },
      },
    },
  };
  const before = JSON.stringify(schema);
  for (const p of ["openai", "anthropic", "google"] as const) {
    normaliseSchema(schema, p);
    assertEquals(JSON.stringify(schema), before, `mutated after ${p} pass`);
  }
});

Deno.test(
  "normaliseSchema: OpenAI strict needs every key required + nullable",
  () => {
    const out = normaliseSchema(
      {
        type: "object",
        required: ["city"],
        properties: { city: { type: "string" }, tip: { type: "string" } },
      },
      "openai",
    ) as Record<string, never>;
    const req = out.required as unknown as string[];
    assert(req.includes("city") && req.includes("tip"), "all keys required");
    assertEquals(out.additionalProperties as unknown, false);
    const props = out.properties as unknown as Record<
      string,
      { type: unknown }
    >;
    // The optional one is widened so "absent" is expressible as null.
    assertEquals(props.tip.type, ["string", "null"]);
    assertEquals(props.city.type, "string");
  },
);

Deno.test(
  "normaliseSchema: Anthropic's unsupported keywords are stripped",
  () => {
    const out = normaliseSchema(
      {
        type: "object",
        required: ["picks", "score"],
        properties: {
          picks: {
            type: "array",
            items: { type: "string" },
            minItems: 3,
            maxItems: 9,
          },
          score: { type: "number", minimum: 0, maximum: 5 },
        },
      },
      "anthropic",
    ) as Record<string, never>;
    const props = out.properties as unknown as Record<
      string,
      Record<string, unknown>
    >;
    // minItems > 1 is a 400; clamped to 1. maxItems unsupported; dropped.
    assertEquals(props.picks.minItems, 1);
    assertEquals("maxItems" in props.picks, false);
    // numeric bounds unsupported on Anthropic
    assertEquals("minimum" in props.score, false);
    assertEquals("maximum" in props.score, false);
  },
);

Deno.test("normaliseSchema: Google passes the full schema through", () => {
  const input = {
    type: "object",
    required: ["picks"],
    properties: {
      picks: { type: "array", items: { type: "string" }, minItems: 3 },
    },
  };
  const out = normaliseSchema(input, "google") as Record<string, never>;
  const props = out.properties as unknown as Record<
    string,
    Record<string, unknown>
  >;
  assertEquals(props.picks.minItems, 3, "Google supports minItems > 1");
});

Deno.test("normaliseSchema recurses into items and anyOf (RG's shape)", () => {
  const out = normaliseSchema(
    {
      type: "array",
      items: {
        anyOf: [
          {
            type: "object",
            required: ["a"],
            properties: { a: { type: "string" }, b: { type: "string" } },
          },
        ],
      },
    },
    "openai",
  ) as Record<string, never>;
  const variant = (out.items as unknown as { anyOf: Record<string, never>[] })
    .anyOf[0] as Record<string, never>;
  const req = variant.required as unknown as string[];
  assert(req.includes("b"), "promotion reached inside anyOf");
});

// ── output caps ─────────────────────────────────────────────────────────────
Deno.test(
  "suggestCap scales for verbose models and never shrinks below baseline",
  () => {
    const baseline = 1000;
    const haiku = suggestCap("claude-haiku-4-5-20251001", baseline);
    const luna = suggestCap("gpt-6-luna", baseline);
    assert(haiku >= baseline, "terse model keeps at least the baseline");
    assert(luna > baseline, "verbose model gets headroom");
  },
);

// ── JSON extraction (the degraded-path fallback) ────────────────────────────
Deno.test(
  "parseLLMJson survives fences and prose, object or array root",
  () => {
    assertEquals(parseLLMJson('```json\n{"a":1}\n```'), { a: 1 });
    assertEquals(parseLLMJson("Here you go:\n[1,2,3]"), [1, 2, 3]);
    // Array root must win when it appears first — load-bearing for RG/todos.
    assertEquals(parseLLMJson('[{"a":1}]'), [{ a: 1 }]);
    assertEquals(parseLLMJson("not json at all"), null);
    assertEquals(parseLLMJson(""), null);
  },
);

// ── usage accounting ────────────────────────────────────────────────────────
Deno.test("mergeUsage sums every disjoint bucket", () => {
  const merged = mergeUsage(
    {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 2,
      cache_read_input_tokens: 1,
      web_search_requests: 1,
    },
    {
      input_tokens: 20,
      output_tokens: 7,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 3,
      web_search_requests: 2,
    },
    undefined,
  );
  assertEquals(merged.input_tokens, 30);
  assertEquals(merged.output_tokens, 12);
  assertEquals(merged.cache_creation_input_tokens, 2);
  assertEquals(merged.cache_read_input_tokens, 4);
  assertEquals(merged.web_search_requests, 3);
});

Deno.test(
  "turnsOf: no messages → the single user turn (existing callers)",
  () => {
    assertEquals(turnsOf({ user: "hi" }), [{ role: "user", content: "hi" }]);
  },
);

Deno.test(
  "turnsOf: normalises a chat history to what Anthropic accepts",
  () => {
    const out = turnsOf({
      user: "unused",
      messages: [
        { role: "assistant", content: "greeting the model never sent" },
        { role: "user", content: "a" },
        { role: "user", content: "b" },
        { role: "assistant", content: "  " },
        { role: "assistant", content: "reply" },
        { role: "user", content: "c" },
      ],
    });
    assertEquals(out, [
      { role: "user", content: "a\nb" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "c" },
    ]);
  },
);

Deno.test(
  "turnsOf: a history ending on the assistant gets the user turn",
  () => {
    const out = turnsOf({
      user: "now this",
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: "a" },
      ],
    });
    assertEquals(out[out.length - 1], { role: "user", content: "now this" });
  },
);
