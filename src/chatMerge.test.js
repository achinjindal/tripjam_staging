/* global Deno */
// Unit tests for the chat catch-up merge. Run: npm run test:functions
import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyServerFields, mergeChatRows } from "./chatMerge.js";

const at = (s) => `2026-10-28T10:00:${String(s).padStart(2, "0")}.000+00:00`;
const row = (id, s, extra = {}) => ({
  id,
  role: "user",
  content: id,
  created_at: at(s),
  ...extra,
});
const ids = (list) => list.map((m) => m.id);

Deno.test("nothing new → the same array comes back", () => {
  const prev = [row("a", 1), row("b", 2)];
  assertStrictEquals(mergeChatRows(prev, [row("a", 1), row("b", 2)]), prev);
  assertStrictEquals(mergeChatRows(prev, []), prev);
  assertStrictEquals(mergeChatRows(prev, null), prev);
});

Deno.test("a missed message lands in created_at order, once", () => {
  const prev = [row("a", 1), row("c", 3)];
  const out = mergeChatRows(prev, [row("a", 1), row("b", 2), row("c", 3)]);
  assertEquals(ids(out), ["a", "b", "c"]);
  // Merging the same rows again changes nothing.
  assertStrictEquals(mergeChatRows(out, [row("b", 2)]), out);
});

Deno.test("missed messages newer than everything append at the end", () => {
  const prev = [row("a", 1)];
  assertEquals(ids(mergeChatRows(prev, [row("b", 2), row("c", 3)])), [
    "a",
    "b",
    "c",
  ]);
});

Deno.test("held fields win over the saved row", () => {
  const undo = { before: [{ day_id: "d1", activities: [] }] };
  const prev = [
    row("a", 1, {
      role: "assistant",
      content: "local text",
      undo,
      changes: [{ kind: "removed" }],
    }),
  ];
  const out = mergeChatRows(prev, [
    row("a", 1, { role: "assistant", content: "saved text", changes: [] }),
  ]);
  assertStrictEquals(out, prev);
  assertStrictEquals(out[0].undo, undo);
});

Deno.test("undone on the server reaches a held card and drops its Undo", () => {
  const prev = [
    row("a", 1, { role: "assistant", undo: { before: [{}] }, changes: [{}] }),
  ];
  const out = mergeChatRows(prev, [
    row("a", 1, { role: "assistant", changes: [{}], undone: true }),
  ]);
  assertEquals(out[0].undone, true);
  assertEquals(out[0].undo, null);
  assertEquals(out[0].content, "a");
  // Already undone → no change.
  assertStrictEquals(mergeChatRows(out, [row("a", 1, { undone: true })]), out);
  // The server never un-undoes a card.
  assertStrictEquals(mergeChatRows(out, [row("a", 1)]), out);
});

Deno.test("our own echo fills in created_at", () => {
  const prev = [row("a", 1), { id: "b", role: "user", content: "hi" }];
  const out = mergeChatRows(prev, [row("b", 2)]);
  assertEquals(out[1].created_at, at(2));
  assertEquals(out[1].content, "hi");
  assertEquals(ids(out), ["a", "b"]);
});

Deno.test("held-only rows survive: undo rows, errors, unsent sends", () => {
  const prev = [
    row("a", 1),
    { id: "u", role: "system-undo", content: "Removed X" },
    { id: "e", role: "assistant", content: "Sorry", error: true },
    row("c", 5),
    { id: "q", role: "user", content: "unsent" },
  ];
  const out = mergeChatRows(prev, [row("a", 1), row("b", 3), row("c", 5)]);
  assertEquals(ids(out), ["a", "u", "e", "b", "c", "q"]);
});

Deno.test("a question and its streaming reply are never split", () => {
  const prev = [
    row("a", 1),
    row("q", 2),
    { id: "r", role: "assistant", content: "", streaming: true },
    row("z", 9),
  ];
  // "m" was saved between q and the end of Trippy's reply.
  const out = mergeChatRows(prev, [
    row("a", 1),
    row("q", 2),
    row("m", 3),
    row("z", 9),
  ]);
  assertEquals(ids(out), ["a", "q", "r", "m", "z"]);
});

Deno.test("untimed messages before any timed one stay first", () => {
  const prev = [{ id: "opt", role: "user", content: "sent before load" }];
  const out = mergeChatRows(prev, [row("a", 1), row("b", 2)]);
  assertEquals(ids(out), ["opt", "a", "b"]);
});

Deno.test("realtime and PostgREST timestamp formats compare as times", () => {
  const prev = [{ ...row("a", 1), created_at: "2026-10-28 10:00:01+00" }];
  const out = mergeChatRows(prev, [
    { id: "b", role: "user", created_at: "2026-10-28T09:59:59.5+00:00" },
  ]);
  assertEquals(ids(out), ["b", "a"]);
});

Deno.test("duplicate ids in the fetched rows land once", () => {
  const out = mergeChatRows([], [row("a", 1), row("a", 1)]);
  assertEquals(ids(out), ["a"]);
});

Deno.test("applyServerFields keeps the object when nothing moves", () => {
  const m = row("a", 1, { undone: true });
  assertStrictEquals(applyServerFields(m, { undone: true }), m);
  assertStrictEquals(applyServerFields(m, null), m);
  const fresh = { id: "b", undo: { before: [] } };
  assertEquals(applyServerFields(fresh, { undone: true }), {
    id: "b",
    undo: null,
    undone: true,
  });
});
