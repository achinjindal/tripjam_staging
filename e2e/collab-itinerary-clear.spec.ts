import { test, expect, Page } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { login, dismissTripOverlays } from "./helpers";

// Realtime DELETEs on days / trip_members.
//
// When the owner changes destinations or trip length the itinerary is cleared
// with replace_trip_days(p, []), which emits only DELETEs on `days`. Under the
// default replica identity a DELETE's old row has just the PK, so the
// trip_id-filtered subscription never matched and co-travellers kept the old
// days — and then got them back from the offline cache even after a reload.
// Migration 20261028000003 sets REPLICA IDENTITY FULL on days / trip_members /
// brainstorm_items. One browser + a Node client (owner A) driving the writes.
// Each test seeds and deletes its own throwaway trip. Gated on the flags.

const OWNER_EMAIL = "qa-tester";
const OWNER_PASSWORD = "qaTest123!";
const SECOND_USER = "collab-e2e-b";
const SECOND_EMAIL = `${SECOND_USER}@tripjam.app`;
const SECOND_PASSWORD = "qaTest123!";

function readEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, "..", ".env");
  let url = process.env.VITE_SUPABASE_URL || "";
  let anon = process.env.VITE_SUPABASE_ANON_KEY || "";
  let invite = process.env.VITE_INVITE_ENABLED || "";
  let realtime = process.env.VITE_REALTIME_ENABLED || "";
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const v = m[2].replace(/^["']|["']$/g, "");
      if (m[1] === "VITE_SUPABASE_URL" && !url) url = v;
      if (m[1] === "VITE_SUPABASE_ANON_KEY" && !anon) anon = v;
      if (m[1] === "VITE_INVITE_ENABLED" && !invite) invite = v;
      if (m[1] === "VITE_REALTIME_ENABLED" && !realtime) realtime = v;
    }
  } catch {
    /* fall back to process.env */
  }
  return {
    url,
    anon,
    inviteEnabled: invite === "true",
    realtimeEnabled: realtime === "true",
  };
}

const { inviteEnabled: INVITE_ENABLED, realtimeEnabled: REALTIME_ENABLED } =
  readEnv();

async function signedClient(
  emailOrUsername: string,
  password: string,
): Promise<SupabaseClient | null> {
  const { url, anon } = readEnv();
  if (!url || !anon) return null;
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = emailOrUsername.includes("@")
    ? emailOrUsername
    : `${emailOrUsername}@tripjam.app`;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return null;
  return sb;
}

function trackChannel(page: Page) {
  const s = { status: "", at: 0 };
  page.on("console", (m) => {
    const mm = m.text().match(/channel trip:\S+ → (\w+)/);
    if (mm) {
      s.status = mm[1];
      s.at = Date.now();
    }
  });
  return async () => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (s.status === "SUBSCRIBED" && Date.now() - s.at > 2000) return true;
      await page.waitForTimeout(500);
    }
    return false;
  };
}

// A built two-day trip owned by qa-tester. ig_response is set so it opens on
// the itinerary rather than route planning.
async function seedTrip(owner: SupabaseClient, marker: string) {
  const ownerId = (await owner.auth.getUser()).data.user?.id as string;
  const id = randomUUID();
  const start = new Date();
  start.setDate(start.getDate() + 40);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  const { error } = await owner.from("trips").insert({
    id,
    // Not the marker: the header shows the name, and the marker must vanish.
    name: "ZZ Realtime Clear Fixture",
    destination: "Lisbon",
    start_date: iso(start),
    end_date: iso(end),
    created_by: ownerId,
    owner_id: ownerId,
    ig_request: { destinations: ["Lisbon"], travelers: "2" },
    ig_response: { name: "Lisbon fixture" },
    detailed_ready_at: new Date().toISOString(),
  });
  if (error) throw error;
  await owner
    .from("trip_members")
    .insert({ trip_id: id, user_id: ownerId, role: "edit" });
  const { error: daysErr } = await owner.rpc("replace_trip_days", {
    p_trip: id,
    p_days: [0, 1].map((i) => ({
      label: `Day ${i + 1}`,
      city: "Lisbon",
      description: `Lisbon day ${i + 1}`,
      activities: [0, 1].map((k) => ({
        time: ["09:00", "14:00"][k],
        title: `${marker} ${i + 1}.${k + 1}`,
        type: "sight",
      })),
    })),
  });
  if (daysErr) throw daysErr;
  return { id, ownerId };
}

// B joins via the invite link; both get a style + B a read-state so neither the
// prefs nudge nor a while-away sheet covers the trip view.
async function addMember(
  owner: SupabaseClient,
  b: SupabaseClient,
  tripId: string,
  ownerId: string,
) {
  const { data: token } = await owner.rpc("create_or_get_invite_link", {
    p_trip: tripId,
  });
  if (!token) return null;
  const { error } = await b.rpc("accept_invite", { p_token: token });
  if (error) return null;
  const bId = (await b.auth.getUser()).data.user?.id as string;
  for (const [cl, uid] of [
    [owner, ownerId],
    [b, bId],
  ] as const) {
    await cl
      .from("trip_preferences")
      .upsert(
        { trip_id: tripId, user_id: uid, prefs_text: "e2e" },
        { onConflict: "trip_id,user_id" },
      );
  }
  await b
    .from("trip_read_state")
    .upsert(
      { trip_id: tripId, user_id: bId, last_seen_at: new Date().toISOString() },
      { onConflict: "trip_id,user_id" },
    );
  return bId;
}

// An emptied itinerary must not regenerate (or re-plan routes) on its own.
async function blockLlm(page: Page) {
  for (const fn of [
    "generate-brainstorm",
    "generate-itinerary",
    "extract-preferences",
  ]) {
    await page.route(`**/functions/v1/${fn}`, (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
  }
}

const cacheKey = (page: Page, tripId: string) =>
  page.evaluate((k) => localStorage.getItem(k), `tripjam_days_${tripId}`);

test.describe("Collaboration — itinerary clear & member removal live", () => {
  test.skip(
    !INVITE_ENABLED || !REALTIME_ENABLED,
    "requires VITE_INVITE_ENABLED=true + VITE_REALTIME_ENABLED=true + migration 20261028000003 on the target DB",
  );
  test.setTimeout(150000);

  test("owner clears the itinerary → member's days vanish live and stay gone", async ({
    browser,
  }) => {
    const owner = await signedClient(OWNER_EMAIL, OWNER_PASSWORD);
    const bClient = await signedClient(SECOND_EMAIL, SECOND_PASSWORD);
    if (!owner || !bClient) {
      test.skip(true, "could not sign in the test users");
      return;
    }
    const marker = `clr${Date.now()}`;
    const { id: tripId, ownerId } = await seedTrip(owner, marker);
    try {
      const bId = await addMember(owner, bClient, tripId, ownerId);
      if (!bId) {
        test.skip(true, "could not set up second member");
        return;
      }

      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const b = await ctx.newPage();
      const waitB = trackChannel(b);
      await blockLlm(b);
      await login(b, SECOND_USER);
      await b.goto(`/trip/${tripId}`);
      await dismissTripOverlays(b, 2000);
      await expect(b.getByText(`${marker} 1.1`).first()).toBeVisible({
        timeout: 20000,
      });
      expect(await waitB(), "member channel SUBSCRIBED").toBe(true);
      // The persist effect has cached the itinerary for offline viewing.
      await expect.poll(() => cacheKey(b, tripId)).not.toBeNull();

      // ---- A (Node) clears the itinerary → B's days vanish live ----
      const { error } = await owner.rpc("replace_trip_days", {
        p_trip: tripId,
        p_days: [],
      });
      expect(error).toBeNull();
      await expect(b.getByText(marker)).toHaveCount(0, { timeout: 20000 });
      await expect
        .poll(() => cacheKey(b, tripId), { timeout: 5000 })
        .toBeNull();

      // ---- Reload: the offline cache must not bring the days back ----
      await b.reload();
      await dismissTripOverlays(b, 2000);
      await b.waitForTimeout(3000); // network reconcile after cache-first paint
      await expect(b.getByText(marker)).toHaveCount(0);
      expect(await cacheKey(b, tripId)).toBeNull();
      await ctx.close();
    } finally {
      await bClient.rpc("leave_trip", { p_trip: tripId });
      await owner.rpc("delete_trip", { p_trip: tripId });
    }
  });

  test("owner removes a member → owner's member count drops live", async ({
    browser,
  }) => {
    const owner = await signedClient(OWNER_EMAIL, OWNER_PASSWORD);
    const bClient = await signedClient(SECOND_EMAIL, SECOND_PASSWORD);
    if (!owner || !bClient) {
      test.skip(true, "could not sign in the test users");
      return;
    }
    const marker = `rm${Date.now()}`;
    const { id: tripId, ownerId } = await seedTrip(owner, marker);
    try {
      const bId = await addMember(owner, bClient, tripId, ownerId);
      if (!bId) {
        test.skip(true, "could not set up second member");
        return;
      }

      // Owner's browser; the removal is driven from Node (the same RPC the
      // MembersSheet calls), so this checks the realtime path, not the sheet's
      // own onMembersChanged refresh.
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const a = await ctx.newPage();
      const waitA = trackChannel(a);
      await blockLlm(a);
      await login(a, OWNER_EMAIL);
      await a.goto(`/trip/${tripId}`);
      await dismissTripOverlays(a, 2000);
      await expect(a.getByText(`${marker} 1.1`).first()).toBeVisible({
        timeout: 20000,
      });
      expect(await waitA(), "owner channel SUBSCRIBED").toBe(true);
      // Mobile header: avatar stack + count when shared, "＋ Invite" when solo.
      const membersBtn = a.getByTitle("Trip members").first();
      await expect(membersBtn).toContainText("2", { timeout: 10000 });

      const { error } = await owner.rpc("remove_member", {
        p_trip: tripId,
        p_user: bId,
      });
      expect(error).toBeNull();
      await expect(membersBtn).toContainText("Invite", { timeout: 20000 });
      await ctx.close();
    } finally {
      await bClient.rpc("leave_trip", { p_trip: tripId });
      await owner.rpc("delete_trip", { p_trip: tripId });
    }
  });
});
