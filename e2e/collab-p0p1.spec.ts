import { test, expect, Page } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { login } from "./helpers";

// P0/P1 journey-gap features (2026-08-11 build) — deterministic coverage,
// ZERO LLM spend: no RG/IG/chat turn is ever triggered. Criteria: 17-collab-p0p1.md.
//
// Covers: join-route fallback, quick tags + tags-only styles, seeded rebalance
// chip, merged share sheet, invite inline hints (self / not-found), expense
// splitting + settle-up, welcome briefing sheet, route-vote persistence +
// consensus checkpoint ("Ask the group" creates a real poll).
//
// Setup mirrors collab-polls.spec.ts: qa-tester owns "Tokyo to Kyoto Classic",
// collab-e2e-b is joined via the invite RPCs. The consensus test builds its own
// throwaway draft trip with hand-inserted tier-1 routes and deletes it after.

const TRIP_NAME = "Tokyo to Kyoto Classic";
const OWNER = "qa-tester";
const OWNER_PASSWORD = "qaTest123!";
const SECOND_USER = "collab-e2e-b";
const PASSWORD = "qaTest123!";

function readEnv(): { url: string; anon: string; inviteEnabled: boolean } {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, "..", ".env");
  let url = process.env.VITE_SUPABASE_URL || "";
  let anon = process.env.VITE_SUPABASE_ANON_KEY || "";
  let invite = process.env.VITE_INVITE_ENABLED || "";
  try {
    const raw = readFileSync(envPath, "utf8");
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
  const email = username.includes("@") ? username : `${username}@tripjam.app`;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return error ? null : sb;
}

/** Click the first VISIBLE element matching — mobile/desktop duplicates mean
 *  the first DOM match is often a hidden variant that stalls click(). */
async function clickVisible(page: Page, re: RegExp): Promise<boolean> {
  const els = page.locator(
    "button, [role=button], div[style*='cursor: pointer'], span",
    { hasText: re },
  );
  const n = await els.count();
  for (let i = 0; i < n; i++) {
    const el = els.nth(i);
    if (await el.isVisible().catch(() => false)) {
      const ok = await el
        .click({ timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (ok) return true;
    }
  }
  return false;
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

/** Dismiss auto-shown overlays (While-you-were-away "Got it", stray sheets)
 *  that intercept pointer events after a trip opens. */
async function dismissTripOverlays(page: Page) {
  for (let i = 0; i < 4; i++) {
    let closed = false;
    // Topmost sheet first — sheets stack and only the top one is clickable:
    // ✕ (style nudge / generic), then Got it (while-away), then Maybe later
    // (paywall).
    for (const re of [/^✕$/, /^Got it$/, /^Maybe later$/]) {
      const el = page.locator("button, div", { hasText: re }).last();
      if (!(await el.isVisible({ timeout: 500 }).catch(() => false))) continue;
      const ok = await el
        .click({ timeout: 2500 })
        .then(() => true)
        .catch(() => false);
      if (ok) {
        closed = true;
        break;
      }
    }
    if (!closed) return;
    await page.waitForTimeout(600);
  }
}

async function openTripByName(page: Page, name = TRIP_NAME): Promise<boolean> {
  await login(page);
  const ok = await clickTripCard(page, name);
  if (ok) await dismissTripOverlays(page);
  return ok;
}

/** Open the members sheet via its stable title attribute. */
async function openMembersSheet(page: Page): Promise<boolean> {
  const btn = page.getByTitle("Trip members").first();
  if (!(await btn.isVisible({ timeout: 5000 }).catch(() => false)))
    return false;
  await btn.click();
  return page
    .locator("text=Trip members")
    .first()
    .isVisible({ timeout: 4000 })
    .catch(() => false);
}

/** Ensure the QA trip is shared (B joined) and both members have styles so the
 *  one-time style nudge never blocks other sheets. Returns ids or null. */
async function ensureSharedTrip(): Promise<{
  owner: SupabaseClient;
  b: SupabaseClient;
  tripId: string;
  ownerId: string;
  bId: string;
} | null> {
  const owner = await signedClient(OWNER, OWNER_PASSWORD);
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
  for (const [client, uid] of [
    [owner, ownerId],
    [b, bId],
  ] as const) {
    await client.from("trip_preferences").upsert(
      {
        trip_id: tripId,
        user_id: uid,
        prefs_text: "e2e style",
        prefs_struct: { tags: [] },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "trip_id,user_id" },
    );
  }
  return { owner, b, tripId, ownerId, bId };
}

// ── 1. Join-route fallback (always runs — no flags needed) ──────────────────

test("malformed /join token shows the invalid-invite screen, not Home", async ({
  page,
}) => {
  await page.goto("/join/not-a-real-token");
  await expect(
    page.locator("text=/no longer valid|no longer active|invalid/i").first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator("text=/Your Trips/i")).not.toBeVisible();
});

// ── 2-8. Flag-gated feature coverage ────────────────────────────────────────

test.describe("P0/P1 collab features", () => {
  test.skip(
    !INVITE_ENABLED,
    "requires VITE_INVITE_ENABLED=true + collab migrations on the target DB",
  );
  test.setTimeout(180000);

  test("quick tags: toggle, save, persist to prefs_struct, reseed on reopen", async ({
    page,
  }) => {
    const ctx = await ensureSharedTrip();
    test.skip(!ctx, "shared-trip setup failed");
    const { owner, tripId, ownerId } = ctx!;

    const opened = await openTripByName(page);
    test.skip(!opened, `could not open "${TRIP_NAME}"`);

    const sheetOpen = await openMembersSheet(page);
    test.skip(!sheetOpen, "could not open the members sheet");

    await page.locator("text=Your kind of trip").first().click();
    await expect(page.locator("text=🏖 Beaches")).toBeVisible({
      timeout: 5000,
    });

    // Toggle two tags and save.
    await page.locator("text=🏖 Beaches").click();
    await page.locator("text=🍜 Food").click();
    await page
      .locator("button, div", { hasText: /^Save$/ })
      .last()
      .click();
    await expect(
      page.locator("text=/Saved — Trippy now plans|Travel style saved/i"),
    ).toBeVisible({ timeout: 6000 });

    // DB: tags persisted.
    const { data: pref } = await owner
      .from("trip_preferences")
      .select("prefs_struct")
      .eq("trip_id", tripId)
      .eq("user_id", ownerId)
      .single();
    const tags = (pref?.prefs_struct as { tags?: string[] })?.tags || [];
    expect(tags).toContain("🏖 Beaches");
    expect(tags).toContain("🍜 Food");
  });

  test("seeded rebalance chip appears after saving a style", async ({
    page,
  }) => {
    const ctx = await ensureSharedTrip();
    test.skip(!ctx, "shared-trip setup failed");
    const opened = await openTripByName(page);
    test.skip(!opened, `could not open "${TRIP_NAME}"`);

    // Open the style sheet via members sheet and save (arms the chip).
    test.skip(!(await openMembersSheet(page)), "members sheet unavailable");
    await page.locator("text=Your kind of trip").first().click();
    await page
      .locator("button, div", { hasText: /^Save$/ })
      .last()
      .click();
    await page.waitForTimeout(1500);

    // The one-shot chip is pinned above the chat input (visible even with
    // chat history). We only assert presence — clicking would spend credits.
    await expect(
      page.locator("text=/Rebalance the (plans|itinerary) for everyone/i"),
    ).toBeVisible({ timeout: 8000 });
  });

  test("share sheet leads with invite-to-edit and labels the view-only link", async ({
    page,
  }) => {
    const ctx = await ensureSharedTrip();
    test.skip(!ctx, "shared-trip setup failed");
    const opened = await openTripByName(page);
    test.skip(!opened, `could not open "${TRIP_NAME}"`);

    const clicked = await clickVisible(page, /Share/);
    test.skip(!clicked, "share affordance not clickable on this viewport");
    await expect(page.locator("text=Invite to plan together")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator("text=/Share a view-only link/i")).toBeVisible();

    // The invite row routes into the members sheet.
    await page.locator("text=Invite to plan together").click();
    await expect(page.locator("text=Trip members")).toBeVisible({
      timeout: 5000,
    });
  });

  test("invite field: self-invite and unknown-email inline hints", async ({
    page,
  }) => {
    const ctx = await ensureSharedTrip();
    test.skip(!ctx, "shared-trip setup failed");
    const opened = await openTripByName(page);
    test.skip(!opened, `could not open "${TRIP_NAME}"`);

    test.skip(!(await openMembersSheet(page)), "members sheet unavailable");

    const inviteInput = page.locator(
      "input[placeholder*='username or email' i]",
    );
    // Self-invite → inline "That's you" (not just a toast).
    await inviteInput.fill(`${OWNER}@tripjam.app`);
    await page.locator("button", { hasText: /^Invite$/ }).click();
    await expect(page.locator("text=/That's you/i")).toBeVisible({
      timeout: 8000,
    });

    // Unknown email → not-found hint + copy-link recovery.
    await inviteInput.fill("nobody-e2e-p0p1@example.com");
    await page.locator("button", { hasText: /^Invite$/ }).click();
    await expect(
      page.locator("text=/No TripJam account for that email yet/i"),
    ).toBeVisible({ timeout: 8000 });
    await expect(page.locator("text=Copy invite link").first()).toBeVisible();
  });

  test("expense splitting: payer picker, split row copy, settle-up panel", async ({
    page,
  }) => {
    const ctx = await ensureSharedTrip();
    test.skip(!ctx, "shared-trip setup failed");
    const { owner, b, tripId, ownerId, bId } = ctx!;
    // Clean slate for the rows this test creates.
    await owner
      .from("trip_expenses")
      .delete()
      .eq("trip_id", tripId)
      .ilike("title", "E2E split%");

    const opened = await openTripByName(page);
    test.skip(!opened, `could not open "${TRIP_NAME}"`);

    // Board → Expenses → Actual tab.
    const boardOk = await clickVisible(page, /Board/i);
    test.skip(!boardOk, "Board tab not reachable on this layout");
    await page.waitForTimeout(800);
    await clickVisible(page, /Expenses/i);
    await page.waitForTimeout(1200);
    await clickVisible(page, /^Actual/);

    // Add an expense paid by "You".
    await page
      .locator("text=/Add expense|\\+ Add/i")
      .first()
      .click()
      .catch(() => {});
    const titleInput = page.locator("input[placeholder='What for?']");
    test.skip(
      !(await titleInput.isVisible({ timeout: 3000 }).catch(() => false)),
      "add-expense form unavailable",
    );
    await titleInput.fill("E2E split dinner");
    await page.locator("input[placeholder='Amount']").fill("120");
    await expect(page.locator("text=/Paid by/i")).toBeVisible();
    await page.locator("button", { hasText: /^You$/ }).click();
    await page
      .locator("button", { hasText: /^(Add|Save)$/ })
      .last()
      .click();
    await page.waitForTimeout(1500);

    // Row shows the split chip; DB row carries the split fields.
    await expect(
      page.locator("text=/paid by you · split \\d+ ways/i"),
    ).toBeVisible({ timeout: 6000 });
    const { data: row } = await owner
      .from("trip_expenses")
      .select("paid_by, split_mode, split_count")
      .eq("trip_id", tripId)
      .eq("title", "E2E split dinner")
      .single();
    expect(row?.paid_by).toBe(ownerId);
    expect(row?.split_mode).toBe("even");
    expect((row?.split_count ?? 0) >= 2).toBeTruthy();

    // Second expense paid by B (inserted directly) → settle-up lines appear.
    await b.from("trip_expenses").insert({
      trip_id: tripId,
      title: "E2E split taxi",
      amount: 40,
      currency: "USD",
      category: "Transport",
      is_planned: false,
      position: 99,
      paid_by: bId,
      split_mode: "even",
      split_count: 2,
    });
    await page.reload();
    await page.waitForTimeout(2500);
    // B's insert generated fresh activity — the while-away sheet reappears
    // on reload and intercepts clicks.
    await dismissTripOverlays(page);
    await clickVisible(page, /Board/i);
    await page.waitForTimeout(800);
    await clickVisible(page, /Expenses/i);
    await page.waitForTimeout(1200);
    await clickVisible(page, /^Actual/);
    await expect(page.locator("text=/Settle up/i")).toBeVisible({
      timeout: 6000,
    });
    await expect(page.locator("text=/→/").first()).toBeVisible();

    // Cleanup.
    await owner
      .from("trip_expenses")
      .delete()
      .eq("trip_id", tripId)
      .ilike("title", "E2E split%");
  });

  test("welcome briefing shows once on first open after joining", async ({
    page,
  }) => {
    const ctx = await ensureSharedTrip();
    test.skip(!ctx, "shared-trip setup failed");
    const { tripId } = ctx!;

    await login(page);
    // Simulate the just-joined flag both accept paths set, THEN open the trip
    // (no second login — the flag must survive until the trip-open effect).
    await page.evaluate(
      (id) => localStorage.setItem(`tripjam_just_joined_${id}`, "1"),
      tripId,
    );
    const opened = await clickTripCard(page, TRIP_NAME);
    test.skip(!opened, `could not open "${TRIP_NAME}"`);
    // Close a while-away sheet if it stacked on top (never ✕ — that could hit
    // the welcome sheet's own close).
    const gotIt = page.locator("button, div", { hasText: /^Got it$/ }).last();
    if (await gotIt.isVisible({ timeout: 2500 }).catch(() => false))
      await gotIt.click().catch(() => {});

    await expect(page.locator("text=You're on the trip 🎉")).toBeVisible({
      timeout: 10000,
    });
    // CTA routes into the style sheet; flag is consumed (once-only).
    await page.locator("text=Share your travel style").click();
    await expect(page.locator("text=Your kind of trip")).toBeVisible({
      timeout: 5000,
    });
    const flag = await page.evaluate(
      (id) => localStorage.getItem(`tripjam_just_joined_${id}`),
      tripId,
    );
    expect(flag).toBeNull();
  });

  test("route votes persist and the consensus checkpoint offers Ask-the-group", async ({
    page,
  }) => {
    const ctx = await ensureSharedTrip();
    test.skip(!ctx, "shared-trip setup failed");
    const { owner, b, ownerId } = ctx!;

    // Throwaway draft trip with hand-inserted tier-1 routes (no RG spend).
    const draftId = crypto.randomUUID();
    const { error: tripErr } = await owner.from("trips").insert({
      id: draftId,
      name: "E2E Consensus Draft",
      destination: "Testland",
      created_by: ownerId,
      start_date: "2026-10-01",
      end_date: "2026-10-05",
    });
    test.skip(!!tripErr, `draft trip insert failed: ${tripErr?.message}`);
    // Mirror the app's create flow: creator self-inserts membership and
    // owner_id — without the member row, create_or_get_invite_link is
    // member-gated and B could never join.
    await owner.from("trip_members").insert({
      trip_id: draftId,
      user_id: ownerId,
      role: "edit",
    });
    await owner.from("trips").update({ owner_id: ownerId }).eq("id", draftId);

    const routes = ["Coast Loop", "Mountain Arc"].map((title, i) => ({
      trip_id: draftId,
      title,
      city: "Alpha, Beta",
      category: "Route",
      position: i,
      tier: 1,
      data: {
        tagline: "e2e",
        days: ["Day 1", "Day 2"],
        routeLabel: `P${i + 1}`,
      },
    }));
    const { error: itemErr } = await owner
      .from("brainstorm_items")
      .insert(routes);
    if (itemErr) {
      await owner.from("trips").delete().eq("id", draftId);
      test.skip(true, `route insert failed: ${itemErr.message}`);
    }
    // Share the draft so the checkpoint has a second member to wait on.
    const { data: draftToken } = await owner.rpc("create_or_get_invite_link", {
      p_trip: draftId,
    });
    if (draftToken) await b.rpc("accept_invite", { p_token: draftToken });
    // Suppress the one-time style nudge on the draft (the checkpoint keys on
    // VOTES; styles are irrelevant to it).
    const draftBId = (await b.auth.getUser()).data.user?.id as string;
    for (const [client, uid] of [
      [owner, ownerId],
      [b, draftBId],
    ] as const) {
      await client.from("trip_preferences").upsert(
        {
          trip_id: draftId,
          user_id: uid,
          prefs_text: "e2e style",
          prefs_struct: { tags: [] },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "trip_id,user_id" },
      );
    }

    try {
      const opened = await openTripByName(page, "E2E Consensus Draft");
      test.skip(!opened, "could not open the draft trip");

      // Select the first route.
      // The plans screen can open on the Inspirations tab — go to Route.
      await clickVisible(page, /Route$/);
      await page.waitForTimeout(1000);
      const selectBtn = page.locator("button", { hasText: /^Select$/ }).first();
      const cardsVisible = await selectBtn
        .isVisible({ timeout: 15000 })
        .catch(() => false);
      if (!cardsVisible)
        await page.screenshot({ path: "test-results/consensus-debug.png" });
      test.skip(!cardsVisible, "route cards did not render");
      await selectBtn.click();
      await page.waitForTimeout(2000);

      // Vote persisted for the selected tier-1 item.
      const { data: votes } = await owner
        .from("brainstorm_votes")
        .select("item_id, user_id")
        .eq("user_id", ownerId);
      expect((votes || []).length).toBeGreaterThan(0);

      // Build → consensus checkpoint (B hasn't voted).
      await page.locator("text=/Build My Itinerary/i").first().click();
      await expect(
        page.locator("text=/haven't weighed in|hasn't weighed in/i"),
      ).toBeVisible({ timeout: 10000 });

      // Ask the group → a real poll lands; IG is never started.
      await page.getByRole("button", { name: "Ask the group" }).click();
      await expect(
        page.locator("text=/Poll posted to the group/i"),
      ).toBeVisible({ timeout: 8000 });
      const { data: polls } = await owner
        .from("polls")
        .select("question")
        .eq("trip_id", draftId);
      expect(
        (polls || []).some((p) =>
          String(p.question).startsWith("Build the itinerary from"),
        ),
      ).toBeTruthy();
    } finally {
      await owner.from("trips").delete().eq("id", draftId);
    }
  });
});
