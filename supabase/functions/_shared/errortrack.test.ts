// Pins the shape of what PostHog receives, because every regression in this
// file is SILENT by construction: captureException swallows its own errors so
// telemetry can never break a caller, which also means a broken payload looks
// exactly like a working one from the inside.
//
// Run: npm run test:functions
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// Must be set BEFORE importing: KEY and ENVIRONMENT are module-level consts.
Deno.env.set("POSTHOG_KEY", "phc_test_key");
Deno.env.set("SUPABASE_URL", "https://viyvdqwwnbbqjuwiuzbh.supabase.co"); // prod ref

const { captureException, qualifyExceptionType } =
  await import("./errortrack.ts");

/** Capture the single PostHog payload produced by one captureException call. */
async function payloadFor(
  err: unknown,
  // deno-lint-ignore no-explicit-any
  ctx: any = {},
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  let body: any = null;
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return Promise.resolve(new Response("ok", { status: 200 }));
  }) as typeof fetch;
  try {
    await captureException(err, ctx);
  } finally {
    globalThis.fetch = original;
  }
  return body;
}

Deno.test(
  "exception type carries env + origin so the filed issue is readable",
  async () => {
    const p = await payloadFor(new Error("Gemini 402: prepayment depleted"), {
      functionName: "generate-itinerary",
    });
    // The regression this guards: a bare "Error" title, which is what made
    // issue #15 indistinguishable from noise during a total RG/IG outage.
    assertEquals(
      p.properties.$exception_type,
      "prod/generate-itinerary: Error",
    );
    assertEquals(
      p.properties.$exception_list[0].type,
      "prod/generate-itinerary: Error",
    );
    assertEquals(p.properties.exception_class, "Error"); // raw class preserved
    assertStringIncludes(
      p.properties.$exception_message,
      "prepayment depleted",
    );
  },
);

Deno.test("staging is distinguishable from production in the title", () => {
  assertEquals(
    qualifyExceptionType("TypeError", "chat", "staging"),
    "staging/chat: TypeError",
  );
  assertEquals(
    qualifyExceptionType("TypeError", "chat", "production"),
    "prod/chat: TypeError",
  );
  // No origin when the caller omits functionName (2 of 34 call sites do).
  assertEquals(
    qualifyExceptionType("Error", undefined, "production"),
    "prod: Error",
  );
});

Deno.test(
  "named context reaches its canonical property, extras survive",
  async () => {
    const p = await payloadFor(new Error("boom"), {
      functionName: "generate-itinerary",
      userId: "user-123",
      tripId: "trip-456",
      // The billing-alarm callers depend on arbitrary extras arriving.
      billing_path: "deductCredits",
      credits: 2.5,
    });
    assertEquals(p.properties.function_name, "generate-itinerary");
    assertEquals(p.properties.trip_id, "trip-456");
    assertEquals(p.distinct_id, "user-123");
    assertEquals(p.properties.billing_path, "deductCredits");
    assertEquals(p.properties.credits, 2.5);
    assertEquals(p.properties.app_env, "production");
  },
);

Deno.test(
  "snake_case context keys do NOT silently win (canonical fields last)",
  async () => {
    // Documents the trap: callers must pass functionName, not function_name —
    // the canonical properties are written after the spread, so a snake_case
    // key is overwritten with null and the origin is lost from the title.
    const p = await payloadFor(new Error("boom"), { function_name: "oops" });
    assertEquals(p.properties.function_name, null);
    assertEquals(p.properties.$exception_type, "prod: Error"); // no origin
  },
);

Deno.test(
  "captureException never throws, even when the transport fails",
  async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.reject(new Error("network down"))) as typeof fetch;
    try {
      await captureException(new Error("inner"), { functionName: "chat" });
    } finally {
      globalThis.fetch = original;
    }
  },
);
