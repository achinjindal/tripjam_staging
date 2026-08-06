import { test, expect, Page } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { login } from "./helpers";

// Realtime Tier 2 — board live-sync.
//
// One browser (member B, on Board → To-dos) + a Node client (owner A) driving
// deterministic board writes. Asserts the live loop: A adds a to-do → it appears
// in B's list live (boardTick refetch); A deletes it → it vanishes live (the
// DELETE path that REPLICA IDENTITY FULL enables). Gated on the flags + collab
// RPCs + Tier-2 migration; skips cleanly.

const TRIP_NAME = "Tokyo to Kyoto Classic";
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

test.describe("Collaboration — board live-sync (Tier 2)", () => {
  test.skip(
    !INVITE_ENABLED || !REALTIME_ENABLED,
    "requires VITE_INVITE_ENABLED=true + VITE_REALTIME_ENABLED=true + collab RPCs + Tier-2 migration on the target DB",
  );
  test.setTimeout(150000);

  test("a co-member's to-do appears and disappears live", async ({
    browser,
  }) => {
    const owner = await signedClient(OWNER_EMAIL, OWNER_PASSWORD);
    if (!owner) {
      test.skip(true, "could not sign in owner (qa-tester)");
      return;
    }
    const { data: trips } = await owner
      .from("trips")
      .select("id")
      .ilike("name", `${TRIP_NAME}%`)
      .limit(1);
    if (!trips || !trips[0]) {
      test.skip(true, `owner trip "${TRIP_NAME}" not found`);
      return;
    }
    const tripId = trips[0].id as string;
    const ownerId = (await owner.auth.getUser()).data.user?.id;

    const { data: token } = await owner.rpc("create_or_get_invite_link", {
      p_trip: tripId,
    });
    const bClient = await signedClient(SECOND_EMAIL, SECOND_PASSWORD);
    if (!bClient || !token) {
      test.skip(true, "could not set up second member");
      return;
    }
    await bClient.rpc("accept_invite", { p_token: token });
    const bId = (await bClient.auth.getUser()).data.user?.id;
    const { data: preview } = await owner.rpc("get_invite_preview", {
      p_token: token,
    });
    if (((preview as { member_count?: number })?.member_count ?? 0) < 2) {
      test.skip(true, "trip not shared");
      return;
    }
    // Pre-seed styles + B read-state so neither the prefs nudge nor a while-away
    // sheet blocks the Board navigation.
    for (const [cl, uid] of [
      [owner, ownerId],
      [bClient, bId],
    ] as const) {
      await cl
        .from("trip_preferences")
        .upsert(
          { trip_id: tripId, user_id: uid, prefs_text: "e2e" },
          { onConflict: "trip_id,user_id" },
        );
    }
    await bClient
      .from("trip_read_state")
      .upsert(
        {
          trip_id: tripId,
          user_id: bId,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "trip_id,user_id" },
      );

    const b = await (await browser.newContext()).newPage();
    const waitB = trackChannel(b);
    const marker = `e2e-board-${Date.now()}`;
    let todoId: string | null = null;
    try {
      await login(b, SECOND_USER);
      await b.goto(`/trip/${tripId}`);
      await b
        .locator('textarea[maxlength="2000"]')
        .first()
        .waitFor({ state: "visible", timeout: 20000 });
      // Board tab → To-do card (bottom-nav "Board" is hidden on desktop).
      await b.locator("button:has-text('Board'):visible").first().click();
      await b.getByText("To-do", { exact: true }).first().click();
      await b.waitForTimeout(800); // TodoView mounted + initial fetch
      expect(await waitB(), "member channel SUBSCRIBED").toBe(true);

      // ---- A (Node) adds a to-do → appears live in B's list ----
      const { data: todo } = await owner
        .from("trip_todos")
        .insert({ trip_id: tripId, text: marker, done: false, position: 99 })
        .select("id")
        .single();
      todoId = todo!.id as string;
      await expect(b.getByText(marker)).toBeVisible({ timeout: 20000 });

      // ---- A deletes it → vanishes live (REPLICA IDENTITY FULL delete path) ----
      await owner.from("trip_todos").delete().eq("id", todoId);
      todoId = null;
      await expect(b.getByText(marker)).toHaveCount(0, { timeout: 20000 });
    } finally {
      if (todoId) await owner.from("trip_todos").delete().eq("id", todoId);
      await bClient.rpc("leave_trip", { p_trip: tripId });
    }
  });
});
