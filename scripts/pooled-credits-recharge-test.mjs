// Phase 2.5 recharge-scope E2E (staging). Requires the recharge functions
// deployed (create-checkout/payment-webhook/revenuecat-verify/redeem-coupon).
//
// Verifies the two testable-without-real-payment guarantees:
//   1. member-guard: a NON-member funding a trip pool → 403 not_a_member.
//   2. coupon → POOL grant: a member redeems a coupon with trip_id → the trip
//      pool is funded, the redeemer's PERSONAL wallet is byte-unchanged.
//   3. member create-checkout with trip_id passes the guard (not 403).
//
// Run: node scripts/pooled-credits-recharge-test.mjs

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
  const owner = await signIn("collab-api-a@tripjam.app");
  const outsider = await signIn("collab-api-c@tripjam.app");

  // owner's trip (owner is a member; outsider is NOT)
  const tripId = crypto.randomUUID();
  await owner.client.from("trips").insert({
    id: tripId,
    name: "RECHARGE-TEST",
    destination: "T",
    start_date: "2026-08-01",
    end_date: "2026-08-05",
    created_by: owner.id,
    owner_id: owner.id,
    credit_balance: 0,
  });
  await owner.client
    .from("trip_members")
    .insert({ trip_id: tripId, user_id: owner.id, role: "edit" });

  // 1. non-member funding guard
  const g = await fn("redeem-coupon", outsider.token, {
    code: "IKNOWACHIN",
    trip_id: tripId,
  });
  const gBody = await g.json().catch(() => ({}));
  ok(
    g.status === 403,
    `non-member redeem-coupon(trip) → 403 (got ${g.status})`,
  );
  ok(
    gBody?.error === "not_a_member",
    `→ error 'not_a_member' (got '${gBody?.error}')`,
  );

  // 3. member create-checkout with trip_id passes the guard (may 200 or LS-config
  //    error, but must NOT be the 403 guard rejection)
  const cc = await fetch(
    `${URL_}/functions/v1/create-checkout?pack=small&trip_id=${tripId}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${owner.token}`, apikey: ANON },
    },
  );
  ok(
    cc.status !== 403,
    `member create-checkout(trip) not guard-blocked (got ${cc.status})`,
  );
  await owner.client.from("trips").delete().eq("id", tripId);

  // 2. coupon → POOL grant, with a FRESH user (coupon is single-use per user)
  const fresh = await signIn(
    `recharge-${crypto.randomUUID().slice(0, 8)}@tripjam.app`,
  );
  const fTrip = crypto.randomUUID();
  await fresh.client.from("trips").insert({
    id: fTrip,
    name: "COUPON-POOL",
    destination: "T",
    start_date: "2026-08-01",
    end_date: "2026-08-05",
    created_by: fresh.id,
    owner_id: fresh.id,
    credit_balance: 0,
  });
  await fresh.client
    .from("trip_members")
    .insert({ trip_id: fTrip, user_id: fresh.id, role: "edit" });
  const p0 = (
    await fresh.client
      .from("profiles")
      .select("credits")
      .eq("id", fresh.id)
      .single()
  ).data.credits;

  const rc = await fn("redeem-coupon", fresh.token, {
    code: "IKNOWACHIN",
    trip_id: fTrip,
  });
  ok(
    rc.status === 200,
    `member redeem-coupon(IKNOWACHIN, trip) → 200 (got ${rc.status})`,
  );
  const pool = (
    await fresh.client
      .from("trips")
      .select("credit_balance")
      .eq("id", fTrip)
      .single()
  ).data.credit_balance;
  ok(Number(pool) === 300, `coupon funded the POOL (+300, got ${pool})`);
  const p1 = (
    await fresh.client
      .from("profiles")
      .select("credits")
      .eq("id", fresh.id)
      .single()
  ).data.credits;
  ok(
    Number(p1) === Number(p0),
    `redeemer personal wallet byte-unchanged (${p0} → ${p1})`,
  );

  await fresh.client.from("trips").delete().eq("id", fTrip);
  console.log(
    failures === 0
      ? "\n🎉 ALL RECHARGE TESTS PASSED"
      : `\n❌ ${failures} failure(s)`,
  );
  process.exit(failures === 0 ? 0 : 1);
};
main().catch((e) => {
  console.error("test error:", e.message);
  process.exit(1);
});
