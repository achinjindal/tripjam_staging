// Isolate the realtime path (no browser): does a member's trip_messages
// subscription actually receive another member's INSERT on staging?
// Mirrors src/realtime.js subscribeTrip. Run: node scripts/realtime-probe.mjs
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
const PASS = "qaTest123!";

async function signIn(email) {
  const c = createClient(URL_, ANON);
  const { data, error } = await c.auth.signInWithPassword({
    email,
    password: PASS,
  });
  if (error) throw new Error(`${email}: ${error.message}`);
  c.realtime.setAuth(data.session.access_token);
  return { client: c, id: data.user.id, token: data.session.access_token };
}

const main = async () => {
  const a = await signIn("qa-tester@tripjam.app");
  const b = await signIn("collab-e2e-b@tripjam.app");

  const { data: trips } = await a.client
    .from("trips")
    .select("id, name")
    .ilike("name", "Tokyo to Kyoto Classic%")
    .limit(1);
  const tripId = trips?.[0]?.id;
  if (!tripId) throw new Error("trip not found");
  console.log("trip:", tripId);

  // Ensure B is a member (so RLS lets B insert + both SELECT).
  const { data: token } = await a.client.rpc("create_or_get_invite_link", {
    p_trip: tripId,
  });
  await b.client.rpc("accept_invite", { p_token: token });

  let received = false;
  const channel = a.client.channel(`trip:${tripId}`);
  channel
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "trip_messages",
        filter: `trip_id=eq.${tripId}`,
      },
      (payload) => {
        received = true;
        console.log(
          "✅ A RECEIVED realtime event:",
          payload.eventType,
          payload.new?.content,
        );
      },
    )
    .subscribe((status, err) => {
      console.log("channel status:", status, err ? `err=${err.message}` : "");
    });

  // Wait for the channel to attach, then B inserts an 'everyone' message.
  await new Promise((r) => setTimeout(r, 4000));
  const marker = `probe-${Date.now()}`;
  const ins = await b.client.from("trip_messages").insert({
    id: crypto.randomUUID(),
    trip_id: tripId,
    user_id: b.id,
    role: "user",
    content: marker,
    audience: "everyone",
  });
  console.log(
    "B insert:",
    ins.error ? `ERROR ${ins.error.message}` : `ok (${marker})`,
  );

  await new Promise((r) => setTimeout(r, 8000));
  console.log(
    received ? "\n🎉 realtime WORKS" : "\n❌ realtime did NOT deliver to A",
  );

  await b.client.rpc("leave_trip", { p_trip: tripId });
  process.exit(received ? 0 : 1);
};
main().catch((e) => {
  console.error("probe error:", e.message);
  process.exit(1);
});
