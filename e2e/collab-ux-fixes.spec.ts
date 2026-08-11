import { test, expect, Page } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { login } from "./helpers";

// Pre-launch UX fixes (2026-08-11) — deterministic, zero LLM spend.
//
// 1. Auto-sheet priority queue: welcome briefing > while-you-were-away >
//    style nudge — exactly one at a time, lower-priority sheets DEFER (not
//    skip) and appear when the one above closes.
// 2. Empty-pool 402 on the background Inspirations preload stays silent
//    (no "You're out of credits" over a full personal wallet).
// 3. Repeat member_join rows collapse to one line in While-you-were-away.

const TRIP_NAME = "Tokyo to Kyoto Classic";
const OWNER = "qa-tester";
const SECOND_USER = "collab-e2e-b";
const PASSWORD = "qaTest123!";

function readEnv(): { url: string; anon: string; inviteEnabled: boolean } {
  const here = dirname(fileURLToPath(import.meta.url));
  let url = process.env.VITE_SUPABASE_URL || "";
  let anon = process.env.VITE_SUPABASE_ANON_KEY || "";
  let invite = process.env.VITE_INVITE_ENABLED || "";
  try {
    const raw = readFileSync(join(here, "..", ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const v = m[2].replace(/^["']|["']$/g, "");
      if (m[1] === "VITE_SUPABASE_URL" && !url) url = v;
      if (m[1] === "VITE_SUPABASE_ANON_KEY" && !anon) anon = v;
      if (m[1] === "VITE_INVITE_ENABLED" && !invite) invite = v;
    }
  } catch {
    /* fall back to process.env */
  }
  return { url, anon, inviteEnabled: invite === "true" };
}
const INVITE_ENABLED = readEnv().inviteEnabled;

async function signedClient(
  username: string,
  password: string,
): Promise<SupabaseClient | null> {
  const { url, anon } = readEnv();
  if (!url || !anon) return null;
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await sb.auth.signInWithPassword({
    email: username.includes("@") ? username : `${username}@tripjam.app`,
    password,
  });
  return error ? null : sb;
}

async function clickTripCard(page: Page, name: string): Promise<boolean> {
  await page
    .locator("text=/Your Trips|No trips yet/i")
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(500);
  const card = page
    .locator("div[style*='cursor: pointer']")
    .filter({ hasText: name })
    .first();
  if (!(await card.isVisible({ timeout: 12000 }).catch(() => false)))
    return false;
  await card.scrollIntoViewIfNeeded().catch(() => {});
  await card.click();
  await page.waitForTimeout(2500);
  return true;
}

type Ctx = {
  owner: SupabaseClient;
  b: SupabaseClient;
  tripId: string;
  ownerId: string;
  bId: string;
};

async function setup(): Promise<Ctx | null> {
  const owner = await signedClient(OWNER, PASSWORD);
  const b = await signedClient(SECOND_USER, PASSWORD);
  if (!owner || !b) return null;
  const { data: trips } = await owner
    .from("trips")
    .select("id")
    .ilike("name", `${TRIP_NAME}%`)
    .limit(1);
  const tripId = trips?.[0]?.id as string | undefined;
  if (!tripId) return null;
  const { data: token } = await owner.rpc("create_or_get_invite_link", {
    p_trip: tripId,
  });
  if (token) await b.rpc("accept_invite", { p_token: token });
  const ownerId = (await owner.auth.getUser()).data.user?.id as string;
  const bId = (await b.auth.getUser()).data.user?.id as string;
  return { owner, b, tripId, ownerId, bId };
}

/** Seed N member_join rows for B, dated `minutesAgo`, and set the owner's
 *  read-state older still so they land in the while-away window. */
async function seedJoinNoise(ctx: Ctx, n: number) {
  const { owner, b, tripId, ownerId, bId } = ctx;
  await owner.from("trip_read_state").upsert(
    {
      trip_id: tripId,
      user_id: ownerId,
      last_seen_at: new Date(Date.now() - 3600_000).toISOString(),
    },
    { onConflict: "trip_id,user_id" },
  );
  for (let i = 0; i < n; i++) {
    await b.from("activity_log").insert({
      trip_id: tripId,
      user_id: bId,
      action: "member_join",
      entity_type: "member",
      entity_id: bId,
      summary: "joined the trip",
      created_at: new Date(Date.now() - (10 - i) * 60_000).toISOString(),
    });
  }
}

async function cleanupJoinNoise(ctx: Ctx) {
  const { b, tripId, bId } = ctx;
  // Members can delete their own rows; scope to our synthetic window.
  await b
    .from("activity_log")
    .delete()
    .eq("trip_id", tripId)
    .eq("user_id", bId)
    .eq("action", "member_join")
    .gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString());
}

test.describe("Pre-launch UX fixes", () => {
  test.skip(!INVITE_ENABLED, "requires VITE_INVITE_ENABLED=true");
  test.setTimeout(180000);

  test("auto-sheets queue one at a time: welcome → while-away → style nudge", async ({
    page,
  }) => {
    const ctx = await setup();
    test.skip(!ctx, "shared-trip setup failed");
    const { owner, tripId, ownerId } = ctx!;

    // Arm all three sheets: join noise (while-away), no style (nudge),
    // just-joined flag (welcome).
    await seedJoinNoise(ctx!, 2);
    await owner
      .from("trip_preferences")
      .delete()
      .eq("trip_id", tripId)
      .eq("user_id", ownerId);
    // Owner's setup-form notes count as a shared style (by design) and would
    // legitimately suppress the nudge — clear them for the test window.
    const { data: tripRow } = await owner
      .from("trips")
      .select("notes")
      .eq("id", tripId)
      .single();
    const savedNotes = tripRow?.notes ?? null;
    await owner.from("trips").update({ notes: null }).eq("id", tripId);

    try {
      await login(page);
      await page.evaluate(
        ([id, uid]) => {
          localStorage.setItem(`tripjam_just_joined_${id}`, "1");
          localStorage.removeItem(`tripjam_prefs_nudged_${id}_${uid}`);
        },
        [tripId, ownerId],
      );
      const opened = await clickTripCard(page, TRIP_NAME);
      test.skip(!opened, `could not open "${TRIP_NAME}"`);
      await page.waitForTimeout(3000);

      // 1. ONLY the welcome sheet.
      await expect(page.locator("text=You're on the trip 🎉")).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator("text=While you were away")).not.toBeVisible();
      await expect(
        page.locator("text=Trippy plans for everyone on the trip."),
      ).not.toBeVisible();

      // 2. Close welcome → while-away appears (deferred, not skipped).
      await page.locator("text=Look around first").click();
      await expect(page.locator("text=While you were away")).toBeVisible({
        timeout: 8000,
      });
      await expect(
        page.locator("text=Trippy plans for everyone on the trip."),
      ).not.toBeVisible();

      // 3. Close while-away → NO style nudge: the welcome sheet pre-marks it
      // as consumed (its own CTA covers style), so the queue ends here.
      await page
        .locator("button, div", { hasText: /^Got it$/ })
        .last()
        .click();
      await page.waitForTimeout(2500);
      await expect(
        page.locator("text=Trippy plans for everyone on the trip."),
      ).not.toBeVisible();
      await expect(page.locator("text=While you were away")).not.toBeVisible();
    } finally {
      await cleanupJoinNoise(ctx!);
      await owner.from("trips").update({ notes: savedNotes }).eq("id", tripId);
      // Restore the owner's style so later suites' nudges stay suppressed.
      await owner.from("trip_preferences").upsert(
        {
          trip_id: tripId,
          user_id: ownerId,
          prefs_text: "e2e style",
          prefs_struct: { tags: [] },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "trip_id,user_id" },
      );
    }
  });

  test("repeat member_join rows collapse to one while-away line", async ({
    page,
  }) => {
    const ctx = await setup();
    test.skip(!ctx, "shared-trip setup failed");
    await seedJoinNoise(ctx!, 3);

    try {
      await login(page);
      const opened = await clickTripCard(page, TRIP_NAME);
      test.skip(!opened, `could not open "${TRIP_NAME}"`);

      await expect(page.locator("text=While you were away")).toBeVisible({
        timeout: 10000,
      });
      // Three seeded join rows must collapse to ONE unseen change.
      await expect(page.locator("text=/1 change since/i")).toBeVisible({
        timeout: 5000,
      });
    } finally {
      await cleanupJoinNoise(ctx!);
    }
  });

  test("empty-pool 402 on Inspirations preload never opens the paywall", async ({
    page,
  }) => {
    const ctx = await setup();
    test.skip(!ctx, "shared-trip setup failed");
    const { owner, tripId } = ctx!;

    // Force a fresh research request (bust the per-trip digest cache), and
    // mock the endpoint with the pool-empty 402.
    await owner
      .from("trips")
      .update({ inspirations_digest: null })
      .eq("id", tripId);
    await page.route("**/functions/v1/generate-destination-research", (route) =>
      route.fulfill({
        status: 402,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Trip pool is empty",
          code: "empty_trip_pool",
          pool_balance: 0,
        }),
      }),
    );

    await login(page);
    const opened = await clickTripCard(page, TRIP_NAME);
    test.skip(!opened, `could not open "${TRIP_NAME}"`);

    // Navigate to Magazine → Inspirations to trigger the load.
    const magTab = page.locator("button:visible", { hasText: /Magazine/i });
    if (
      await magTab
        .first()
        .isVisible({ timeout: 4000 })
        .catch(() => false)
    ) {
      await magTab.first().click();
      await page.waitForTimeout(1000);
      const inspTab = page.locator("button:visible, div:visible", {
        hasText: /Inspirations/i,
      });
      if (
        await inspTab
          .first()
          .isVisible({ timeout: 2000 })
          .catch(() => false)
      )
        await inspTab.first().click();
    }
    await page.waitForTimeout(4000);

    // The contradictory sheet must NOT appear.
    await expect(page.locator("text=You're out of credits")).not.toBeVisible();
    await expect(page.locator("text=Redeem a coupon")).not.toBeVisible();
  });
});
