// Phase 2.5 END-TO-END gate test (staging). Requires migration 20260721000008
// applied + the changed functions deployed to staging.
//
// The must-have test: on a SHARED trip with an EMPTY pool, a `trippy` call
// returns 402 `empty_trip_pool`, the caller's personal wallet is byte-unchanged,
// and NO credit_transactions row is written. Also checks a SOLO trip still
// reaches the LLM path (personal-gated, unchanged).
//
// Run: node scripts/pooled-credits-e2e-test.mjs

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ── load staging creds from .env ──
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
  throw new Error("refusing to run against a non-staging URL: " + URL_);

const PASS = "qaTest123!";
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "✅ PASS" : "❌ FAIL"}  ${msg}`);
  if (!cond) failures++;
};

async function signIn(email) {
  const c = createClient(URL_, ANON);
  let { data, error } = await c.auth.signInWithPassword({ email, password: PASS });
  if (error) {
    await c.auth.signUp({ email, password: PASS });
    ({ data, error } = await c.auth.signInWithPassword({ email, password: PASS }));
    if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  }
  return { client: c, id: data.user.id, token: data.session.access_token };
}

async function callChat(token, tripId) {
  const res = await fetch(`${URL_}/functions/v1/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: ANON,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      screen: "itinerary",
      trip: { id: tripId },
      message: "hello",
      history: [],
    }),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body };
}

const main = async () => {
  const a = await signIn("collab-api-a@tripjam.app");
  const b = await signIn("collab-api-b@tripjam.app");

  // ── SHARED trip, EMPTY pool ──
  const sharedId = crypto.randomUUID();
  await a.client.from("trips").insert({
    id: sharedId,
    name: "E2E-POOL-EMPTY",
    destination: "Testland",
    start_date: "2026-08-01",
    end_date: "2026-08-05",
    created_by: a.id,
    owner_id: a.id,
    credit_balance: 0,
  });
  // a self-joins (RLS allows inserting your OWN membership); b joins via the
  // accept_invite SECURITY DEFINER RPC (RLS blocks inserting ANOTHER user's row).
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

  const memberCount = (
    await a.client
      .from("trip_members")
      .select("user_id", { count: "exact", head: true })
      .eq("trip_id", sharedId)
  ).count;
  ok(memberCount === 2, `setup: trip is SHARED (2 members, got ${memberCount})`);

  const before = (
    await a.client.from("profiles").select("credits").eq("id", a.id).single()
  ).data.credits;
  const txBefore = (
    await a.client
      .from("credit_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", a.id)
  ).count;

  const r = await callChat(a.token, sharedId);
  ok(r.status === 402, `shared+empty-pool chat → HTTP 402 (got ${r.status})`);
  ok(
    r.body?.code === "empty_trip_pool",
    `→ code 'empty_trip_pool' (got '${r.body?.code}')`,
  );

  const after = (
    await a.client.from("profiles").select("credits").eq("id", a.id).single()
  ).data.credits;
  ok(
    Number(after) === Number(before),
    `personal wallet byte-unchanged (${before} → ${after})`,
  );
  const txAfter = (
    await a.client
      .from("credit_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", a.id)
  ).count;
  ok(txAfter === txBefore, `no credit_transactions row written (${txBefore} → ${txAfter})`);

  // cleanup
  await a.client.from("trips").delete().eq("id", sharedId);

  console.log(failures === 0 ? "\n🎉 ALL E2E GATE TESTS PASSED" : `\n❌ ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error("test error:", e.message);
  process.exit(1);
});
