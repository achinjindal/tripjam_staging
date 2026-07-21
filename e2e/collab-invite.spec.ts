import { test, expect, Page, BrowserContext } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { login } from "./helpers";

// Phase-1 collaboration: invite links, /join landing, and the members sheet.
//
// The first test runs unconditionally — the /join/:token route renders the
// JoinTrip screen regardless of the VITE_INVITE_ENABLED flag, so a bogus token
// should always land on the "link no longer active" state. It validates the
// route + JoinTrip render + error handling with zero prerequisites.
//
// The members/invite tests are gated on VITE_INVITE_ENABLED=true plus the
// invite RPCs being live on the target DB. They reuse the qa-tester built trip
// "Tokyo to Kyoto Classic" (no RG/IG is ever triggered).

const BOGUS_TOKEN = "00000000-0000-0000-0000-000000000000";
const TRIP_NAME = "Tokyo to Kyoto Classic";
const OWNER_EMAIL = "qa-tester"; // qa-tester signs in with the bare username
const OWNER_PASSWORD = "qaTest123!";
const SECOND_USER = "collab-e2e-b";
const SECOND_EMAIL = `${SECOND_USER}@tripjam.app`;
const SECOND_PASSWORD = "qaTest123!";

// ── Read the staging Supabase creds + invite flag that Vite injects for the
// browser. The Playwright *test process* doesn't load .env (only the Vite
// webServer does), so parse it directly. This keeps the gate + the multi-user
// test aligned with what the running app actually sees. ──
function readEnv(): {
  url: string;
  anon: string;
  inviteEnabled: boolean;
} {
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
      const [, k, vRaw] = m;
      const v = vRaw.replace(/^["']|["']$/g, "");
      if (k === "VITE_SUPABASE_URL" && !url) url = v;
      if (k === "VITE_SUPABASE_ANON_KEY" && !anon) anon = v;
      if (k === "VITE_INVITE_ENABLED" && !invite) invite = v;
    }
  } catch {
    /* fall back to process.env */
  }
  return { url, anon, inviteEnabled: invite === "true" };
}

const INVITE_ENABLED = readEnv().inviteEnabled;

async function signedClient(
  emailOrUsername: string,
  password: string,
): Promise<SupabaseClient | null> {
  const { url, anon } = readEnv();
  if (!url || !anon) return null;
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // qa-tester's stored email is the synthetic <username>@tripjam.app; the
  // client signs in with email/password. Username-only login through the app
  // resolves to that synthetic email, so use it here too.
  const email = emailOrUsername.includes("@")
    ? emailOrUsername
    : `${emailOrUsername}@tripjam.app`;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return null;
  return sb;
}

/**
 * Open the qa-tester built trip by name from Home and land inside the trip
 * view (the tabbed Route · Inspirations · Magazine shell). A built trip opens
 * via onOpenTrip (a "Planning" draft would open the editor instead), so we
 * target the card by its visible title text and confirm we left Home.
 */
async function openTripByName(page: Page, name = TRIP_NAME) {
  await login(page);
  // Wait for the trips list to render (qa-tester has ~20 trips; cold load can
  // be slow) before hunting for the card.
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
  const found = await card.isVisible({ timeout: 12000 }).catch(() => false);
  if (!found) return false;

  await card.scrollIntoViewIfNeeded().catch(() => {});
  await card.click();

  // We are inside the trip once the URL changes to /trip/<id>. Poll for it.
  const opened = await page
    .waitForURL(/\/trip\/[a-f0-9-]{36}/, { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(1500);
  return opened;
}

/**
 * The members affordance (title="Trip members" — "＋ Invite" when solo or an
 * avatar-stack + count when shared). Only renders when INVITE_ENABLED is on
 * AND a trip is open.
 */
function membersButton(page: Page) {
  return page.getByTitle("Trip members");
}

test.describe("Collaboration — invite & join (Phase 1)", () => {
  test("invalid invite link shows the 'no longer active' screen", async ({
    page,
  }) => {
    await page.goto(`/join/${BOGUS_TOKEN}`);
    await expect(page.getByText(/Link no longer active/i)).toBeVisible({
      timeout: 12000,
    });
    await expect(page.getByText(/Go to my trips/i)).toBeVisible();
  });

  test.describe("with the feature enabled", () => {
    test.skip(
      !INVITE_ENABLED,
      "requires VITE_INVITE_ENABLED=true + invite RPCs on the target DB",
    );

    // ── Diagnostic (KNOWN-FAILING): is the members affordance rendered? ──
    // APP BUG: the Phase-1 members button lives in App.jsx behind
    // INVITE_ENABLED, but commit 3498b8c inserted it INSIDE the pre-existing
    // `{false && (…)}` dead sidebar block (App.jsx ~line 10107, disabled by
    // commit 6f948a6a). So `title="Trip members"` renders NOWHERE in the live
    // UI even with VITE_INVITE_ENABLED=true and a trip open — the entire
    // MembersSheet / invite / leave surface is unreachable from the app.
    //
    // Marked test.fail(): it asserts the CORRECT expectation (affordance
    // visible) and is expected to fail until src/App.jsx is fixed. When the
    // bug is fixed, Playwright will flag this as "unexpectedly passing" so the
    // annotation gets removed. We must not touch src/, so it stays known-fail.
    test("members affordance is present in the trip header", async ({
      page,
    }) => {
      test.fail(
        true,
        'APP BUG: title="Trip members" affordance is dead code (rendered ' +
          "inside a `{false && …}` block in App.jsx). MembersSheet UI is " +
          "unreachable. Fix requires a src/ edit, which is out of scope here.",
      );

      const opened = await openTripByName(page);
      expect(opened, `could not open "${TRIP_NAME}"`).toBe(true);

      const visible = await membersButton(page)
        .isVisible({ timeout: 6000 })
        .catch(() => false);

      test.info().annotations.push({
        type: "affordance-visible",
        description: String(visible),
      });

      expect(
        visible,
        'title="Trip members" affordance should render when a trip is open ' +
          "and VITE_INVITE_ENABLED=true",
      ).toBe(true);
    });

    test("owner can open the members sheet", async ({ page }) => {
      const opened = await openTripByName(page);
      test.skip(!opened, `could not open "${TRIP_NAME}"`);

      const btn = membersButton(page);
      const btnVisible = await btn
        .isVisible({ timeout: 6000 })
        .catch(() => false);
      test.skip(
        !btnVisible,
        'members affordance (title="Trip members") not rendered — see the ' +
          "diagnostic test / bug report",
      );

      await btn.click();
      await expect(
        page.getByText("Trip members", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/Owner/i).first()).toBeVisible();
    });

    test("generate + copy an invite link yields a /join URL", async ({
      page,
      context,
    }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const opened = await openTripByName(page);
      test.skip(!opened, `could not open "${TRIP_NAME}"`);

      const btn = membersButton(page);
      const btnVisible = await btn
        .isVisible({ timeout: 6000 })
        .catch(() => false);
      test.skip(
        !btnVisible,
        "members affordance not rendered — MembersSheet unreachable via UI",
      );

      await btn.click();
      await page.getByText(/Copy invite link/i).click();
      await page.waitForTimeout(1500);
      const clip = await page
        .evaluate(() => navigator.clipboard.readText())
        .catch(() => "");
      expect(clip).toContain("/join/");
    });

    test("a generated invite link previews the trip on the join screen", async ({
      page,
      context,
    }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const opened = await openTripByName(page);
      test.skip(!opened, `could not open "${TRIP_NAME}"`);

      const btn = membersButton(page);
      const btnVisible = await btn
        .isVisible({ timeout: 6000 })
        .catch(() => false);
      test.skip(
        !btnVisible,
        "members affordance not rendered — MembersSheet unreachable via UI",
      );

      await btn.click();
      await page.getByText(/Copy invite link/i).click();
      await page.waitForTimeout(1500);
      const clip = await page
        .evaluate(() => navigator.clipboard.readText())
        .catch(() => "");
      const path = clip.replace(/^https?:\/\/[^/]+/, "");
      test.skip(!path.startsWith("/join/"), "no invite link captured");
      await page.goto(path);
      await expect(page.getByText(/Join trip|Sign in to join/i)).toBeVisible({
        timeout: 12000,
      });
    });
  });
});

// ── Multi-user JOIN via the real /join UI ──────────────────────────────────
// The MembersSheet affordance is unreachable in the live UI (see the
// diagnostic test / bug report), so we mint the invite link by calling the
// live `create_or_get_invite_link` RPC as the owner through a Node Supabase
// client (real backend, the exact RPC getInviteUrl() uses). Then context B
// (a real second account) drives the ACTUAL JoinTrip screen + accept flow.
// This validates JoinTrip render → preview → accept_invite → membership end to
// end. Cleanup removes B via the live leave_trip RPC and re-checks membership.

test.describe("Collaboration — real multi-user join (Phase 1)", () => {
  test.skip(
    !INVITE_ENABLED,
    "requires VITE_INVITE_ENABLED=true + invite RPCs on the target DB",
  );
  test.setTimeout(120000);

  test("second user joins via the /join screen, then is removed", async ({
    browser,
  }) => {
    // ---- Owner mints an invite link (Node client, live RPC) ----
    const owner = await signedClient(OWNER_EMAIL, OWNER_PASSWORD);
    if (!owner) {
      test.skip(true, "could not sign in owner (qa-tester) via Supabase");
      return;
    }

    // The stored trip name carries a "· <dateRange>" suffix ("Tokyo to Kyoto
    // Classic · Jun 10–Jun 17"), so match by prefix rather than exact equality.
    const { data: trips, error: tripErr } = await owner
      .from("trips")
      .select("id, name, owner_id")
      .ilike("name", `${TRIP_NAME}%`)
      .limit(1);
    if (tripErr || !trips || !trips[0]) {
      test.skip(
        true,
        `owner trip "${TRIP_NAME}" not found: ${tripErr?.message}`,
      );
      return;
    }
    const tripId = trips[0].id as string;

    const { data: token, error: mintErr } = await owner.rpc(
      "create_or_get_invite_link",
      { p_trip: tripId },
    );
    if (mintErr || !token) {
      test.skip(
        true,
        `create_or_get_invite_link failed: ${mintErr?.message || "no token"}`,
      );
      return;
    }
    expect(String(token)).toMatch(/[a-f0-9-]{36}/);

    // Ensure B is not already a member from a prior run (idempotent cleanup).
    // leave_trip errors harmlessly if B isn't a member — swallow it.
    const bPre = await signedClient(SECOND_EMAIL, SECOND_PASSWORD);
    if (bPre) {
      try {
        await bPre.rpc("leave_trip", { p_trip: tripId });
      } catch {
        /* not a member yet — fine */
      }
    }

    // Baseline member count (should be 1 = owner only).
    const { data: pre } = await owner.rpc("get_invite_preview", {
      p_token: token,
    });
    const baseCount = (pre as { member_count?: number })?.member_count;
    test.info().annotations.push({
      type: "member_count_baseline",
      description: String(baseCount),
    });

    // ---- Context B: a real second user joins via the /join UI ----
    const ctxB: BrowserContext = await browser.newContext();
    const b: Page = await ctxB.newPage();
    // login() signs up collab-e2e-b@tripjam.app if it doesn't yet exist.
    await login(b, SECOND_USER);

    await b.goto(`/join/${token}`);
    await expect(b.getByText(/Join trip/i)).toBeVisible({ timeout: 15000 });
    // Trip name is previewed on the JoinTrip screen.
    await expect(b.getByText(new RegExp(TRIP_NAME, "i")).first()).toBeVisible();

    await b.getByText(/Join trip/i).click();
    await b.waitForTimeout(3500);

    // Verify membership via the live preview (owner sees updated count).
    const { data: postJoin } = await owner.rpc("get_invite_preview", {
      p_token: token,
    });
    const joinedCount = (postJoin as { member_count?: number })?.member_count;
    test.info().annotations.push({
      type: "member_count_after_join",
      description: String(joinedCount),
    });
    expect(joinedCount).toBeGreaterThanOrEqual(2);

    // Also confirm B actually landed in the trip UI (left the /join screen).
    const stillOnJoin = await b
      .getByText(/You'll be able to edit the plan/i)
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    expect(stillOnJoin).toBe(false);

    // ---- Cleanup: B leaves via the live leave_trip RPC ----
    const bClient = await signedClient(SECOND_EMAIL, SECOND_PASSWORD);
    expect(bClient).not.toBeNull();
    const { data: leftResult, error: leaveErr } = await bClient!.rpc(
      "leave_trip",
      { p_trip: tripId },
    );
    expect(leaveErr).toBeNull();
    expect(["left", "trip_deleted"]).toContain(leftResult);

    // Membership back to baseline (owner only).
    const { data: postLeave } = await owner.rpc("get_invite_preview", {
      p_token: token,
    });
    const finalCount = (postLeave as { member_count?: number })?.member_count;
    expect(finalCount).toBe(1);

    await ctxB.close();
  });
});
