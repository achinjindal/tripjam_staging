// Phase 2 (shared Trippy chat) E2E — staging. Validates the DB/API-testable
// guarantees. Requires:
//   - migration 20260722000001_trip_messages_assistant_rls applied to staging
//   - the `chat` function deployed to staging
//
// Covers:
//   1. Assistant-row RLS: a member CAN insert an assistant/user_id=null row for
//      their trip; a NON-member CANNOT; a member CANNOT impersonate another
//      member on a user row (existing policy holds).
//   2. Group-prompt function: a shared-trip chat call carrying members[]+sender
//      returns 200 with a reply (pool-funded) — the function accepts group
//      context without error.
//   3. Free human message: a member inserts an audience='everyone' user row
//      directly (no function call, no credits) — allowed by the human policy.
//   4. Solo byte-identical: a solo chat call (no members) returns 200 on the
//      personal path.
//
// The whole-trip route-clobber fix (update_route non-destructive) lives in
// dispatchActions JS, so its true regression test is browser-level (Playwright);
// see e2e/. This script covers everything reachable from the DB/API.
//
// Run: node scripts/phase2-shared-chat-test.mjs

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
if (!URL_.includes("wlrzvwjdrjpfqcwgmzch"))
  throw new Error("refusing to run against non-staging: " + URL_);

const PASS = "qaTest123!";
let failures = 0;
const ok = (c, m) => {
  console.log(`${c ? "✅ PASS" : "❌ FAIL"}  ${m}`);
  if (!c) failures++;
};

async function signIn(email) {
  const c = createClient(URL_, ANON);
  let { data, error } = await c.auth.signInWithPassword({
    email,
    password: PASS,
  });
  if (error) {
    await c.auth.signUp({ email, password: PASS });
    ({ data, error } = await c.auth.signInWithPassword({
      email,
      password: PASS,
    }));
    if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  }
  return { client: c, id: data.user.id, token: data.session.access_token };
}
const fn = (name, token, body) =>
  fetch(`${URL_}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: ANON,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

const main = async () => {
  const a = await signIn("collab-api-a@tripjam.app");
  const b = await signIn("collab-api-b@tripjam.app");
  const c = await signIn("collab-api-c@tripjam.app");

  // Shared trip, pool-funded so a Trippy call can actually run.
  const sharedId = crypto.randomUUID();
  await a.client.from("trips").insert({
    id: sharedId,
    name: "P2-SHARED",
    destination: "Testland",
    start_date: "2026-08-01",
    end_date: "2026-08-05",
    created_by: a.id,
    owner_id: a.id,
    credit_balance: 50,
  });
  await a.client
    .from("trip_members")
    .insert({ trip_id: sharedId, user_id: a.id, role: "edit" });
  const { data: token, error: eInvite } = await a.client.rpc(
    "create_or_get_invite_link",
    { p_trip: sharedId },
  );
  if (eInvite) throw new Error("create_or_get_invite_link: " + eInvite.message);
  const { error: eAccept } = await b.client.rpc("accept_invite", {
    p_token: token,
  });
  if (eAccept) throw new Error("accept_invite: " + eAccept.message);

  // ── 1. Assistant-row RLS ───────────────────────────────────────────────
  const bAssistant = await b.client.from("trip_messages").insert({
    id: crypto.randomUUID(),
    trip_id: sharedId,
    user_id: null,
    role: "assistant",
    content: "Trippy reply (member-inserted)",
    audience: "trippy",
  });
  ok(
    !bAssistant.error,
    `member inserts assistant/null row → allowed (${bAssistant.error?.message || "ok"})`,
  );

  const cAssistant = await c.client.from("trip_messages").insert({
    id: crypto.randomUUID(),
    trip_id: sharedId,
    user_id: null,
    role: "assistant",
    content: "outsider forging a Trippy reply",
    audience: "trippy",
  });
  ok(
    !!cAssistant.error,
    `NON-member inserts assistant/null row → blocked (${cAssistant.error ? "blocked" : "LEAKED"})`,
  );

  const bImpersonate = await b.client.from("trip_messages").insert({
    id: crypto.randomUUID(),
    trip_id: sharedId,
    user_id: a.id, // pretend to be A
    role: "user",
    content: "forged as A",
    audience: "everyone",
  });
  ok(
    !!bImpersonate.error,
    `member impersonating another user → blocked (${bImpersonate.error ? "blocked" : "LEAKED"})`,
  );

  // ── 2. Group-prompt function (pool-funded) ─────────────────────────────
  const pool = (
    await a.client
      .from("trips")
      .select("credit_balance")
      .eq("id", sharedId)
      .single()
  ).data?.credit_balance;
  if (Number(pool) > 0) {
    const chatRes = await fn("chat", a.token, {
      screen: "brainstorm",
      trip: { id: sharedId, name: "P2-SHARED", destination: "Testland" },
      routes: [
        {
          id: crypto.randomUUID(),
          title: "P1 South Coast",
          points: [{ text: "Beaches", good: true }],
          days: ["Day 1: arrive"],
        },
      ],
      days: [],
      form: {},
      message: "Can you make this more relaxed?",
      members: [
        { id: a.id, name: "collab-api-a" },
        { id: b.id, name: "collab-api-b" },
      ],
      sender: "collab-api-a",
      history: [
        {
          role: "user",
          content: "I want packed days",
          author: "collab-api-b",
        },
      ],
    });
    const chatBody = await chatRes.json().catch(() => ({}));
    ok(
      chatRes.status === 200,
      `shared chat w/ members[] → 200 (got ${chatRes.status})`,
    );
    ok(
      typeof chatBody.message === "string" && chatBody.message.length > 0,
      `→ returned a reply (${(chatBody.message || "").slice(0, 50)}…)`,
    );
  } else {
    ok(false, `pool not funded (credit_balance=${pool}) — cannot test chat`);
  }

  // ── 3. Free human message (audience='everyone', no function/credits) ────
  const human = await b.client.from("trip_messages").insert({
    id: crypto.randomUUID(),
    trip_id: sharedId,
    user_id: b.id,
    role: "user",
    content: "hey everyone, thoughts on the south coast?",
    audience: "everyone",
  });
  ok(
    !human.error,
    `member posts audience='everyone' human message → allowed (${human.error?.message || "ok"})`,
  );

  await a.client.from("trips").delete().eq("id", sharedId);

  // ── 4. Solo byte-identical: no members sent, personal path ─────────────
  const soloId = crypto.randomUUID();
  await a.client.from("trips").insert({
    id: soloId,
    name: "P2-SOLO",
    destination: "Testland",
    start_date: "2026-08-01",
    end_date: "2026-08-05",
    created_by: a.id,
    owner_id: a.id,
  });
  await a.client
    .from("trip_members")
    .insert({ trip_id: soloId, user_id: a.id, role: "edit" });
  const soloRes = await fn("chat", a.token, {
    screen: "brainstorm",
    trip: { id: soloId, name: "P2-SOLO", destination: "Testland" },
    routes: [
      {
        id: crypto.randomUUID(),
        title: "P1",
        points: [{ text: "x", good: true }],
        days: ["Day 1"],
      },
    ],
    days: [],
    form: {},
    message: "hello",
    history: [],
  });
  ok(
    soloRes.status === 200,
    `solo chat (no members) → 200 personal path (got ${soloRes.status})`,
  );
  await a.client.from("trips").delete().eq("id", soloId);

  console.log(
    failures === 0
      ? "\n🎉 ALL PHASE 2 SHARED-CHAT TESTS PASSED"
      : `\n❌ ${failures} failure(s)`,
  );
  process.exit(failures === 0 ? 0 : 1);
};
main().catch((e) => {
  console.error("test error:", e.message);
  process.exit(1);
});
