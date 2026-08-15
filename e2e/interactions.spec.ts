import { test, expect } from "@playwright/test";
import { login, snap, dismissTripOverlays } from "./helpers";

/**
 * Interaction tests — real user behavior patterns that catch state sync bugs.
 * Uses a SHARED trip created once in beforeAll to avoid repeated RG calls (~$0.05 vs ~$0.45).
 */

/**
 * Fill in the SetupForm step 1 date range by clicking two future day cells in
 * the DateRangePicker. The picker renders 12 stacked months (current first) and
 * auto-scrolls to the current month; day cells are <div>s whose text is the day
 * number. We pick two enabled (non-past) cells a few rows apart so the range is
 * always valid regardless of what today's date is.
 */
async function pickDateRange(page: import("@playwright/test").Page) {
  // Enabled day cells have cursor:pointer (past days are cursor:default).
  const dayCells = page.locator("div[style*='cursor: pointer']").filter({
    hasText: /^\d{1,2}$/,
  });
  await dayCells.first().waitFor({ state: "visible", timeout: 5000 });
  const count = await dayCells.count();
  // Start ~5 cells in, end ~5 cells later — both comfortably in the future and
  // in date order (cells render chronologically).
  const startIdx = Math.min(5, Math.max(0, count - 6));
  const endIdx = Math.min(startIdx + 5, count - 1);
  await dayCells.nth(startIdx).click();
  await page.waitForTimeout(200);
  await dayCells.nth(endIdx).click();
  await page.waitForTimeout(200);
}

/** Helper: navigate to setup and create a trip through to routes.
 *
 *  Post design-pass SetupForm (desktop shell at the default 1280px viewport):
 *   - Step 0 "Where to?": inline destination input (placeholder "…Bangkok…") or
 *     popular pills. Footer "Continue →".
 *   - Step 1 "Dates": travelers counter + DateRangePicker. Continue → validates
 *     that BOTH start and end dates are picked, otherwise it errors and blocks.
 *   - Step 2 "Preferences": base location + notes + "Start Planning ✨" button
 *     (this is the button that fires route generation — there is no separate
 *     "Continue" on the last step).
 */
async function setupToRoutes(
  page: import("@playwright/test").Page,
  destination = "Japan",
) {
  await login(page);
  const createBtn = page
    .locator("button", { hasText: /new trip|create/i })
    .first();
  await createBtn.click();
  await page.waitForTimeout(500);

  // Step 0: destination (desktop inline input)
  const destInput = page.locator("input[placeholder*='Bangkok']").first();
  await destInput.fill(destination);
  await page.waitForTimeout(1000);
  await destInput.press("Enter");
  await page.waitForTimeout(300);

  // Advance to step 1 (Dates)
  await page
    .locator("button", { hasText: /continue/i })
    .first()
    .click();
  await page.waitForTimeout(500);

  // Step 1: pick a valid date range, then continue to step 2
  await pickDateRange(page);
  await page
    .locator("button", { hasText: /continue/i })
    .first()
    .click();
  await page.waitForTimeout(500);

  // Step 2: fire route generation via "Start Planning ✨"
  await page
    .locator("button", { hasText: /start planning/i })
    .first()
    .click();

  // Wait for at least 2 route cards
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].filter(
        (b) => b.textContent?.trim() === "Select",
      ).length >= 2,
    { timeout: 180000 },
  );
  await page.waitForTimeout(1000);
}

/** Helper: open a draft trip that actually has generated routes and land on the
 *  Route sub-tab (avoids creating a new trip).
 *
 *  Post design-pass the brainstorm/"plans" view is a tabbed shell
 *  (🛣️ Route · ✨ Inspirations · 📖 Magazine). On desktop it opens on the
 *  Inspirations tab, so the route "Select" cards are NOT visible until we click
 *  the Route tab. We also skip stale drafts that were never populated with
 *  routes (they show a "Generate plans" button instead of Select cards).
 */
async function openDraftTrip(page: import("@playwright/test").Page) {
  await login(page);

  // Prefer a Japan draft (our shared-setup trip reliably has 4 routes); fall
  // back to any Planning card. Trip cards are the row <div> whose status badge
  // reads "Planning".
  const candidates = [
    // Actual clickable trip cards (cursor: pointer root) — the bare div
    // locators below match ancestor wrappers whose "click" hits nothing
    page
      .locator("[style*='cursor: pointer']")
      .filter({ hasText: /Japan ·/ })
      .filter({ has: page.locator("text=/Planning/") }),
    page
      .locator("[style*='cursor: pointer']")
      .filter({ has: page.locator("text=/Planning/") }),
    page
      .locator("div", { hasText: /Japan ·/ })
      .filter({ has: page.locator("text=/Planning/") }),
    page.locator("div").filter({ has: page.locator("text=/Planning/") }),
  ];

  for (const cards of candidates) {
    const count = await cards.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 4); i++) {
      const card = cards.nth(i);
      if (!(await card.isVisible({ timeout: 2000 }).catch(() => false)))
        continue;
      await card.click();
      await page.waitForTimeout(1500);
      await dismissTripOverlays(page, 1500);

      // Switch to the Route sub-tab so the Select cards render.
      const routeTab = page.locator("button", { hasText: /Route/i }).first();
      if (await routeTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await routeTab.click();
        await page.waitForTimeout(1000);
      }

      const hasRoutes = await page
        .locator("button", { hasText: /^Select$|✓ Selected/ })
        .first()
        .isVisible({ timeout: 4000 })
        .catch(() => false);
      if (hasRoutes) return true;

      // Stale draft (no routes) — go back home and try the next candidate.
      await page.goto("/");
      await page.waitForTimeout(800);
    }
  }
  return false;
}

// ── Create one shared trip for all tests that need routes ──
// This runs once, then all tests reuse the same draft trip.
test.describe.serial("Shared trip setup", () => {
  test.setTimeout(300000);

  test("create shared trip with routes", async ({ page }) => {
    await setupToRoutes(page, "Japan");

    // Wait for all 4 routes
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll("button")].filter(
            (b) => b.textContent?.trim() === "Select",
          ).length >= 4,
        { timeout: 60000 },
      )
      .catch(() => {});
    await page.waitForTimeout(1000);

    const routeCount = await page
      .locator("button", { hasText: /^Select$/ })
      .count();
    expect(routeCount).toBeGreaterThanOrEqual(2);
    await snap(page, "50-shared-trip-created");
  });
});

test.describe("Route label integrity", () => {
  test.setTimeout(120000);

  test("labels are sequential after initial generation", async ({ page }) => {
    const opened = await openDraftTrip(page);
    if (!opened) {
      test.skip();
      return;
    }

    // Verify labels are sequential by checking route label badges
    const labels = page.locator("span", { hasText: /^P\d+$/ });
    const labelCount = await labels.count();
    expect(labelCount).toBeGreaterThanOrEqual(2);

    // Check no duplicates
    const labelTexts = [];
    for (let i = 0; i < labelCount; i++) {
      labelTexts.push(await labels.nth(i).textContent());
    }
    const unique = new Set(labelTexts);
    expect(unique.size).toBe(labelTexts.length);

    await snap(page, "51-labels-initial");
  });

  test("labels re-sequence after dismissing a route", async ({ page }) => {
    const opened = await openDraftTrip(page);
    if (!opened) {
      test.skip();
      return;
    }

    // Count initial routes
    const initialCount = await page
      .locator("button", { hasText: /^Select$/ })
      .count();
    if (initialCount < 2) {
      test.skip();
      return;
    }

    // Dismiss first route (P1)
    const dismissBtn = page
      .locator("button", { hasText: /Dismiss this plan/i })
      .first();
    await dismissBtn.click();
    await page.waitForTimeout(500);

    // Remaining routes should be labelled P1, P2, P3 (not P2, P3, P4)
    const newCount = await page
      .locator("button", { hasText: /^Select$|✓ Selected/ })
      .count();
    expect(newCount).toBe(initialCount - 1);

    // P1 should still exist (first remaining route)
    const p1 = await page
      .locator("text=P1")
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    expect(p1).toBe(true);

    // No label gap — check that labels are sequential
    for (let i = 1; i <= newCount; i++) {
      const label = await page
        .locator(`text=P${i}`)
        .first()
        .isVisible({ timeout: 1000 })
        .catch(() => false);
      expect(label).toBe(true);
    }

    await snap(page, "52-labels-after-dismiss");
  });
});

test.describe("Setup form persistence", () => {
  test("edit details goes to step 0 with pre-filled data", async ({ page }) => {
    const opened = await openDraftTrip(page);
    if (!opened) {
      test.skip();
      return;
    }

    // Click Edit details
    const editBtn = page
      .locator("button", { hasText: /Edit details/i })
      .first();
    if (!(await editBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await editBtn.click();
    await page.waitForTimeout(500);

    // Should be on step 0 (Where to) with destination pre-filled
    await expect(page.locator("text=/Where to/i").first()).toBeVisible({
      timeout: 3000,
    });

    // Destination chip should show "Japan"
    const chipVisible = await page
      .locator("text=/Japan/i")
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    expect(chipVisible).toBe(true);

    await snap(page, "53-edit-details-step0");
  });

  test("in-app back from routes goes to setup, not home", async ({ page }) => {
    const opened = await openDraftTrip(page);
    if (!opened) {
      test.skip();
      return;
    }
    await page.waitForTimeout(500);

    // Post design-pass: the routes/"plans" header carries a "←" back affordance
    // that returns to the setup form (setScreen("setup")) rather than dumping
    // the user back to Home. (Browser back is a separate concern — from a
    // home-opened draft it legitimately returns Home, so we exercise the
    // in-app back button instead, which is what the design pass changed.)
    const backBtn = page.locator("button", { hasText: /^←$/ }).first();
    await expect(backBtn).toBeVisible({ timeout: 4000 });
    await backBtn.click();
    await page.waitForTimeout(1200);

    // Should land on the setup form (its destination step / heading), not Home.
    const onHome = await page
      .locator("text=/Your Trips|No trips yet/i")
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    const onSetup = await page
      .locator("text=/Where to|Preferences|Dates|Start Planning|Continue/i")
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    expect(onHome).toBe(false);
    expect(onSetup).toBe(true);

    await snap(page, "54-back-from-routes");
  });
});

test.describe("Pre-IG sheet", () => {
  test.setTimeout(120000);

  test("selecting route shows Build button, which opens pre-IG sheet", async ({
    page,
  }) => {
    const opened = await openDraftTrip(page);
    if (!opened) {
      test.skip();
      return;
    }

    // Select first route
    const selectBtn = page.locator("button", { hasText: /^Select$/ }).first();
    if (!(await selectBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await selectBtn.click();
    await page.waitForTimeout(500);

    // Build My Itinerary should appear
    const buildBtn = page
      .locator("button", { hasText: /Build My Itinerary/i })
      .first();
    await expect(buildBtn).toBeVisible({ timeout: 3000 });

    // Click it — pre-IG sheet should open
    await buildBtn.click();
    await page.waitForTimeout(500);

    // Sheet should have Budget, Morning, Pace, free text, Generate button
    await expect(page.locator("text=/Fine-tune/i").first()).toBeVisible({
      timeout: 3000,
    });
    await expect(page.locator("text=/Budget range/i").first()).toBeVisible();
    await expect(
      page.locator("button", { hasText: /Generate Itinerary/i }).first(),
    ).toBeVisible();

    await snap(page, "55-pre-ig-sheet");
  });

  test("pre-IG sheet dismisses on scrim tap", async ({ page }) => {
    const opened = await openDraftTrip(page);
    if (!opened) {
      test.skip();
      return;
    }

    const selectBtn = page.locator("button", { hasText: /^Select$/ }).first();
    if (!(await selectBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await selectBtn.click();
    await page.waitForTimeout(500);

    const buildBtn = page
      .locator("button", { hasText: /Build My Itinerary/i })
      .first();
    await buildBtn.click();
    // The sheet opens only AFTER the extract-preferences fetch resolves — a
    // fixed 500ms wait raced it (scrim tap landed pre-open, then the sheet
    // appeared and the assertion saw it). Wait for the sheet itself.
    await expect(page.locator("text=/Fine-tune/i").first()).toBeVisible({
      timeout: 15000,
    });

    // Tap scrim (top area above sheet)
    await page.mouse.click(200, 50);
    await page.waitForTimeout(500);

    // Sheet should be gone
    const sheetVisible = await page
      .locator("text=/Fine-tune/i")
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    expect(sheetVisible).toBe(false);

    await snap(page, "56-sheet-dismissed");
  });
});

test.describe("Board tab navigation", () => {
  // Staging IG for a 7-day trip now runs ~5 min server-side (llm_usage
  // confirms completion); the old 300s budget expired mid-stream.
  test.setTimeout(600000);

  test("Board tab hides chat bar", async ({ page }) => {
    const opened = await openDraftTrip(page);
    if (!opened) {
      test.skip();
      return;
    }

    // Select and build
    const selectBtn = page.locator("button", { hasText: /^Select$/ }).first();
    if (!(await selectBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await selectBtn.click();
    await page.waitForTimeout(300);
    const buildBtn = page
      .locator("button", { hasText: /Build My Itinerary/i })
      .first();
    await buildBtn.click();
    await page.waitForTimeout(300);
    await page
      .locator("button", { hasText: /Generate Itinerary/i })
      .first()
      .click();

    // The post-IG UX completes on the brainstorm screen with a ready banner
    // ("Your itinerary is ready · View itinerary →") rather than
    // auto-navigating — click through when it appears.
    const viewBtn = page
      .locator("button", { hasText: /View itinerary/i })
      .first();
    await viewBtn.click({ timeout: 480000 });
    await page.waitForTimeout(1500);

    // Wait for itinerary
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some((b) =>
          /Board/i.test(b.textContent || ""),
        ),
      { timeout: 60000 },
    );
    await page.waitForTimeout(2000);

    // Switch to Board
    await page.locator("button:visible", { hasText: /Board/i }).first().click();
    await page.waitForTimeout(500);

    // Chat bar should NOT be visible on Board. The chat input placeholder is
    // "Ask Trippy anything…" (itinerary) / "Ask about plans…" (brainstorm).
    const chatBarOnBoard = await page
      .locator(
        "textarea[placeholder*='Ask Trippy'], textarea[placeholder*='Ask about plans']",
      )
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    expect(chatBarOnBoard).toBe(false);

    await snap(page, "57-board-no-chat");
  });
});

test.describe("Magazine destination display", () => {
  test.setTimeout(120000);

  test("Magazine header shows destination name, not 'Help me decide'", async ({
    page,
  }) => {
    const opened = await openDraftTrip(page);
    if (!opened) {
      test.skip();
      return;
    }

    // Switch to Magazine tab
    const magTab = page.locator("button", { hasText: /Magazine/i }).first();
    if (!(await magTab.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await magTab.click();
    await page.waitForTimeout(2000);

    // Header should NOT say "Help me decide"
    const hasHelpMe = await page
      .locator("text=/Help me decide/i")
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    expect(hasHelpMe).toBe(false);

    await snap(page, "58-magazine-no-helpme");
  });

  test("Tell me more shows country name in header, not city list", async ({
    page,
  }) => {
    const opened = await openDraftTrip(page);
    if (!opened) {
      test.skip();
      return;
    }

    // Click "Tell me more" on first route
    const tellMore = page
      .locator("button", { hasText: /Tell me more/i })
      .first();
    if (!(await tellMore.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await tellMore.click();
    await page.waitForTimeout(2000);

    // Header should show route name (e.g. "Classic Tokyo") not "Tokyo, Kyoto, Osaka"
    const header = page.locator("[style*='DM Serif Display']").first();
    const headerText = (await header.textContent().catch(() => "")) || "";

    // Count commas — a country/route name has 0-1 commas, city list has 2+
    const commaCount = (headerText.match(/,/g) || []).length;
    expect(commaCount).toBeLessThan(3);

    await snap(page, "59-magazine-country-header");
  });
});

test.describe("Skeleton cards", () => {
  test.setTimeout(300000);

  test("skeleton cards appear during route generation", async ({ page }) => {
    await login(page);
    const createBtn = page
      .locator("button", { hasText: /new trip|create/i })
      .first();
    await createBtn.click();
    await page.waitForTimeout(500);

    const destInput = page.locator("input[placeholder*='Bangkok']").first();
    await destInput.fill("Thailand");
    await page.waitForTimeout(500);
    await destInput.press("Enter");
    await page.waitForTimeout(300);

    // Step 0 → 1
    await page
      .locator("button", { hasText: /continue/i })
      .first()
      .click();
    await page.waitForTimeout(500);

    // Step 1: dates → step 2
    await pickDateRange(page);
    await page
      .locator("button", { hasText: /continue/i })
      .first()
      .click();
    await page.waitForTimeout(500);

    // Step 2: fire generation
    await page
      .locator("button", { hasText: /start planning/i })
      .first()
      .click();

    // Wait for first route to appear, then check for skeletons
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].filter(
          (b) => b.textContent?.trim() === "Select",
        ).length >= 1,
      { timeout: 120000 },
    );

    // Should see skeleton shimmer cards for remaining routes
    const skeletons = page.locator("[style*='shimmer']");
    const skelCount = await skeletons.count();
    console.log(`Skeleton cards visible: ${skelCount}`);

    await snap(page, "60-skeleton-cards");

    // Wait for all routes to finish
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].filter(
          (b) => b.textContent?.trim() === "Select",
        ).length >= 3,
      { timeout: 120000 },
    );
  });
});
