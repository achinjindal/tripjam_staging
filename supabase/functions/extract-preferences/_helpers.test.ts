// Unit tests for buildPrefsInput. Run: npm run test:functions
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildPrefsInput,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
  MAX_NOTES_CHARS,
} from "./_helpers.ts";

Deno.test("real input passes through unchanged", () => {
  // The health-monitor probe body: must keep extracting "luxury".
  assertEquals(
    buildPrefsInput(
      "We want a luxury budget, a relaxed pace, and late morning starts.",
      [],
    ),
    'User notes: "We want a luxury budget, a relaxed pace, and late morning starts."',
  );
  assertEquals(
    buildPrefsInput("  backpacker trip  ", [
      { role: "user", content: "no early mornings please" },
      { role: "assistant", content: "Got it, late starts." },
    ]),
    'User notes: "backpacker trip"\n\nChat history:\nuser: no early mornings please\nassistant: Got it, late starts.',
  );
});

Deno.test("nothing to extract from returns null (no model call)", () => {
  assertEquals(buildPrefsInput("", []), null);
  assertEquals(buildPrefsInput("   ", undefined), null);
  assertEquals(
    buildPrefsInput(undefined, [{ role: "user", content: " " }]),
    null,
  );
});

Deno.test("oversized notes and messages are trimmed, not rejected", () => {
  const out = buildPrefsInput("a".repeat(500_000), [
    { role: "user", content: "b".repeat(500_000) },
  ])!;
  assert(out.includes(`"${"a".repeat(MAX_NOTES_CHARS)}…"`));
  assert(out.includes(`user: ${"b".repeat(MAX_MESSAGE_CHARS)}…`));
  assert(!out.includes("a".repeat(MAX_NOTES_CHARS + 1)));
  assert(!out.includes("b".repeat(MAX_MESSAGE_CHARS + 1)));
});

Deno.test(
  "worst case stays bounded (~17k chars, a few thousand tokens)",
  () => {
    const huge = "x".repeat(1_000_000);
    const history = Array.from({ length: 5000 }, () => ({
      role: huge,
      content: huge,
    }));
    const out = buildPrefsInput(huge, history)!;
    assertEquals(out.split("\n").length - 3, MAX_MESSAGES); // notes, blank, header
    assert(out.length < 18_000, `got ${out.length} chars`);
  },
);

Deno.test("keeps the LAST messages, the ones nearest the build", () => {
  const history = Array.from({ length: 15 }, (_, i) => ({
    role: "user",
    content: `m${i}`,
  }));
  const out = buildPrefsInput("", history)!;
  assert(!out.includes("user: m4\n"));
  assert(out.includes("user: m5\n"));
  assert(out.endsWith("user: m14"));
});

Deno.test("junk shapes are ignored, never thrown on", () => {
  assertEquals(buildPrefsInput({ evil: true }, { length: 3 }), null);
  assertEquals(buildPrefsInput(42, "not an array"), null);
  assertEquals(
    buildPrefsInput(null, [
      null,
      { content: { nested: "obj" } },
      { role: 7, content: "pace: relaxed" },
    ]),
    "Chat history:\nuser: pace: relaxed",
  );
});
