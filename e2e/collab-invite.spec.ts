import { test, expect } from "@playwright/test";
import { login } from "./helpers";

// Phase-1 collaboration: invite links, /join landing, and the members sheet.
//
// The first test runs unconditionally — the /join/:token route renders the
// JoinTrip screen regardless of the VITE_INVITE_ENABLED flag, so a bogus token
// should always land on the "link no longer active" state. It validates the
// route + JoinTrip render + error handling with zero prerequisites.
//
// The members/invite tests are gated: they require
//   • VITE_INVITE_ENABLED=true in the dev/staging env,
//   • migration 20260721000007_invite_rpcs applied to the staging DB,
//   • at least one existing trip on the qa-tester account.
// They skip cleanly until that environment is set up.

const INVITE_ENABLED = process.env.VITE_INVITE_ENABLED === "true";
const BOGUS_TOKEN = "00000000-0000-0000-0000-000000000000";

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

    async function openFirstTrip(page) {
      await login(page);
      // Open the first trip card on Home.
      const card = page
        .locator('[data-testid="trip-card"], a[href^="/trip/"]')
        .first();
      await card.click({ timeout: 10000 }).catch(async () => {
        // Fallback: any element linking into a trip.
        await page.locator("text=/day|itinerary|magazine/i").first().click();
      });
      await page.waitForTimeout(1500);
    }

    test("owner can open the members sheet", async ({ page }) => {
      await openFirstTrip(page);
      await page.getByTitle("Trip members").click({ timeout: 10000 });
      await expect(page.getByText(/Trip members/i)).toBeVisible();
      // Self appears in the list.
      await expect(page.getByText(/Owner/i).first()).toBeVisible();
    });

    test("generate + copy an invite link yields a /join URL", async ({
      page,
      context,
    }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await openFirstTrip(page);
      await page.getByTitle("Trip members").click({ timeout: 10000 });
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
      await openFirstTrip(page);
      await page.getByTitle("Trip members").click({ timeout: 10000 });
      await page.getByText(/Copy invite link/i).click();
      await page.waitForTimeout(1500);
      const clip = await page
        .evaluate(() => navigator.clipboard.readText())
        .catch(() => "");
      const path = clip.replace(/^https?:\/\/[^/]+/, "");
      test.skip(!path.startsWith("/join/"), "no invite link captured");
      await page.goto(path);
      // The join screen shows the accept CTA (signed in) or sign-in CTA.
      await expect(page.getByText(/Join trip|Sign in to join/i)).toBeVisible({
        timeout: 12000,
      });
    });
  });
});
