// Realtime Tier 2 — board live-sync: publication + REPLICA IDENTITY FULL.
//
// Two members. A subscribes to the trip channel (todos/expenses/bookmarks); B
// performs INSERT / UPDATE / DELETE on each board table; asserts A receives every
// event — the DELETE assertions are the direct proof that REPLICA IDENTITY FULL
// makes trip_id-filtered deletes deliver (they'd be dropped under DEFAULT).
//
//   node scripts/tier2-board-test.mjs

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const SB = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const mk = () =>
  createClient(SB, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0,
  fail = 0;
const ok = (n, c, d = "") => {
  console.log(`${c ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`);
  c ? pass++ : fail++;
};

const A = mk();
const { data: ad, error: aErr } = await A.auth.signInWithPassword({
  email: "qa-tester@tripjam.app",
  password: "qaTest123!",
});
if (aErr) {
  console.error("could not sign in qa-tester:", aErr.message);
  process.exit(2);
}
const aId = ad.user.id;
const bEmail = `t2-${Date.now().toString(36)}@tripjam.app`;
const B = mk();
const { data: bd } = await B.auth.signUp({
  email: bEmail,
  password: "qaTest123!",
});
const bId = bd.user.id;
await B.auth.setSession(bd.session);
await sleep(1500);

const T = randomUUID();
await A.from("trips").insert({
  id: T,
  created_by: aId,
  owner_id: aId,
  name: "T2",
  destination: "Japan",
  start_date: "2026-09-01",
  end_date: "2026-09-02",
  ig_response: { cities: [] },
});
await A.from("trip_members").insert({ trip_id: T, user_id: aId, role: "edit" });
const inv = await A.rpc("invite_user_by_handle", {
  p_trip: T,
  p_handle: bEmail,
});
await B.rpc("respond_invite", { p_invite: inv.data.invite_id, p_accept: true });

// A subscribes to the three board tables (mirrors subscribeTrip filter).
await A.realtime.setAuth(ad.session.access_token);
const ev = { trip_todos: [], trip_expenses: [], trip_bookmarks: [] };
const ch = A.channel(`trip:${T}`);
for (const table of ["trip_todos", "trip_expenses", "trip_bookmarks"]) {
  ch.on(
    "postgres_changes",
    { event: "*", schema: "public", table, filter: `trip_id=eq.${T}` },
    (p) => ev[table].push(p.eventType),
  );
}
await new Promise((res) => ch.subscribe((s) => s === "SUBSCRIBED" && res()));
await sleep(3000); // replication slot warmup

// B (co-member) inserts / updates / deletes each board row.
const { data: todo } = await B.from("trip_todos")
  .insert({ trip_id: T, text: "JR Pass", done: false, position: 0 })
  .select("id")
  .single();
await sleep(800);
await B.from("trip_todos").update({ done: true }).eq("id", todo.id);
await sleep(800);
await B.from("trip_todos").delete().eq("id", todo.id);
await sleep(1200);
ok(
  "todo INSERT delivered",
  ev.trip_todos.includes("INSERT"),
  JSON.stringify(ev.trip_todos),
);
ok(
  "todo UPDATE (toggle done) delivered",
  ev.trip_todos.includes("UPDATE"),
  JSON.stringify(ev.trip_todos),
);
ok(
  "todo DELETE delivered (REPLICA IDENTITY FULL)",
  ev.trip_todos.includes("DELETE"),
  JSON.stringify(ev.trip_todos),
);

const { data: exp } = await B.from("trip_expenses")
  .insert({
    trip_id: T,
    title: "Ryokan",
    amount: 200,
    currency: "USD",
    category: "Lodging",
    position: 0,
  })
  .select("id")
  .single();
await sleep(800);
await B.from("trip_expenses").delete().eq("id", exp.id);
await sleep(1200);
ok(
  "expense INSERT delivered",
  ev.trip_expenses.includes("INSERT"),
  JSON.stringify(ev.trip_expenses),
);
ok(
  "expense DELETE delivered (FULL)",
  ev.trip_expenses.includes("DELETE"),
  JSON.stringify(ev.trip_expenses),
);

const { data: bm } = await B.from("trip_bookmarks")
  .insert({
    trip_id: T,
    title: "Hotel",
    url: "https://x.com",
    icon: "🔗",
    position: 0,
  })
  .select("id")
  .single();
await sleep(800);
await B.from("trip_bookmarks").delete().eq("id", bm.id);
await sleep(1200);
ok(
  "bookmark INSERT delivered",
  ev.trip_bookmarks.includes("INSERT"),
  JSON.stringify(ev.trip_bookmarks),
);
ok(
  "bookmark DELETE delivered (FULL)",
  ev.trip_bookmarks.includes("DELETE"),
  JSON.stringify(ev.trip_bookmarks),
);

await A.removeChannel(ch);
await A.from("trips").delete().eq("id", T);
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
