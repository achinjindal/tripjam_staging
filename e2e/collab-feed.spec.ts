import { test, expect, Page } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { login } from "./helpers";

// Phase-3 collaboration: activity feed / "while you were away" / undo.
//
// One browser (member B) + a Node client (owner A) that drives a deterministic,
// LLM-free change. Asserts the live loop: A makes a change → B's header 🔔 badge
// increments via realtime → B opens the feed and sees the attributed row → B taps
// Undo → the change is reversed (owner confirms the row is gone) and the row is
// annotated. Gated on the flags + collab RPCs + Phase-3 migration; skips cleanly.

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

test.describe("Collaboration — activity feed / undo (Phase 3)", () => {
  test.skip(
    !INVITE_ENABLED || !REALTIME_ENABLED,
    "requires VITE_INVITE_ENABLED=true + VITE_REALTIME_ENABLED=true + collab RPCs + Phase-3 migration on the target DB",
  );
  test.setTimeout(150000);

  test("a change syncs to the member's feed and can be undone", async ({
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
    // Pre-seed both styles + mark B's read-state now, so neither the Phase-5
    // nudge nor a stale "while you were away" sheet blocks the header.
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
    await bClient.from("trip_read_state").upsert(
      {
        trip_id: tripId,
        user_id: bId,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "trip_id,user_id" },
    );

    const b = await (await browser.newContext()).newPage();
    const waitB = trackChannel(b);
    const marker = `e2e-feed-${Date.now()}`;
    let todoId: string | null = null;
    try {
      await login(b, SECOND_USER);
      await b.goto(`/trip/${tripId}`);
      await b
        .locator('textarea[maxlength="2000"]')
        .first()
        .waitFor({ state: "visible", timeout: 20000 });
      expect(await waitB(), "member channel SUBSCRIBED").toBe(true);

      // ---- Owner (Node) makes a deterministic change → activity_log row ----
      const { data: todo } = await owner
        .from("trip_todos")
        .insert({ trip_id: tripId, text: marker, done: false, position: 0 })
        .select("id")
        .single();
      todoId = todo!.id as string;
      await owner.from("activity_log").insert({
        trip_id: tripId,
        user_id: ownerId,
        action: "add_todo",
        entity_type: "todo",
        entity_id: todoId,
        summary: `Added to-do: ${marker}`,
        undo_payload: { id: todoId },
      });

      // ---- B's header 🔔 badge increments live (realtime) ----
      const bell = b.getByRole("button", { name: "Activity" });
      await expect(bell).toBeVisible({ timeout: 15000 });
      await expect(bell).toContainText("1", { timeout: 20000 });

      // ---- B opens the feed and sees the attributed row ----
      await bell.click();
      await expect(b.getByText("Activity", { exact: true })).toBeVisible();
      await expect(b.getByText(`Added to-do: ${marker}`)).toBeVisible({
        timeout: 10000,
      });

      // ---- B taps Undo → the todo is reversed (owner confirms it's gone) ----
      await b.getByText("Undo", { exact: true }).first().click();
      await expect
        .poll(
          async () =>
            (await owner.from("trip_todos").select("id").eq("id", todoId!)).data
              ?.length ?? -1,
          { timeout: 15000 },
        )
        .toBe(0);
      // The original row is annotated "· undone".
      await expect(b.getByText(/undone/).first()).toBeVisible({
        timeout: 10000,
      });
    } finally {
      if (todoId) await owner.from("trip_todos").delete().eq("id", todoId);
      await bClient.rpc("leave_trip", { p_trip: tripId });
    }
  });
});
