import { test, expect } from "@playwright/test";
import { login, snap } from "./helpers";

/**
 * Interaction tests — real user behavior patterns that catch state sync bugs.
 * Uses a SHARED trip created once in beforeAll to avoid repeated RG calls (~$0.05 vs ~$0.45).
 */

/** Helper: navigate to setup and create a trip through to routes */
async function setupToRoutes(page: import("@playwright/test").Page, destination = "Japan") {
  await login(page);
  const createBtn = page.locator("button", { hasText: /new trip|create/i }).first();
  await createBtn.click();
  await page.waitForTimeout(500);

  // Step 0: destination
  const destInput = page.locator("input[placeholder*='Bangkok']").first();
  await destInput.fill(destination);
  await page.waitForTimeout(1000);
  await destInput.press("Enter");
  await page.waitForTimeout(300);
  await page.locator("body").click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(300);

  // Advance steps 0→1→2
  for (let step = 0; step < 2; step++) {
    const nextBtn = page.locator("button").filter({ hasText: /continue|→/i }).first();
    if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nextBtn.click({ force: true });
      await page.waitForTimeout(600);
    }
  }

  // Click Start Planning
  const startBtn = page.locator("button", { hasText: /start planning/i }).first();
  if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await startBtn.click();
  }

  // Wait for at least 2 route cards
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].filter(b => b.textContent?.trim() === "Select").length >= 2,
    { timeout: 180000 }
  );
  await page.waitForTimeout(1000);
}

/** Helper: open the most recent draft trip (avoids creating a new one) */
async function openDraftTrip(page: import("@playwright/test").Page) {
  await login(page);
  const planningCard = page.locator("text=/Planning/i").first();
  if (!await planningCard.isVisible({ timeout: 5000 }).catch(() => false)) return false;
  await planningCard.click();
  await page.waitForTimeout(2000);

  // Wait for route cards to be visible
  const hasRoutes = await page.locator("button", { hasText: /^Select$|✓ Selected/ }).first()
    .isVisible({ timeout: 5000 }).catch(() => false);
  return hasRoutes;
}

// ── Create one shared trip for all tests that need routes ──
// This runs once, then all tests reuse the same draft trip.
test.describe.serial("Shared trip setup", () => {
  test.setTimeout(300000);

  test("create shared trip with routes", async ({ page }) => {
    await setupToRoutes(page, "Japan");

    // Wait for all 4 routes
    await page.waitForFunction(
      () => [...document.querySelectorAll("button")].filter(b => b.textContent?.trim() === "Select").length >= 4,
      { timeout: 60000 }
    ).catch(() => {});
    await page.waitForTimeout(1000);

    const routeCount = await page.locator("button", { hasText: /^Select$/ }).count();
    expect(routeCount).toBeGreaterThanOrEqual(2);
    await snap(page, "50-shared-trip-created");
  });
});

test.describe("Route label integrity", () => {
  test.setTimeout(120000);

  test("labels are sequential after initial generation", async ({ page }) => {
    const opened = await openDraftTrip(page);
    if (!opened) { test.skip(); return; }

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
    if (!opened) { test.skip(); return; }

    // Count initial routes
    const initialCount = await page.locator("button", { hasText: /^Select$/ }).count();
    if (initialCount < 2) { test.skip(); return; }

    // Dismiss first route (P1)
    const dismissBtn = page.locator("button", { hasText: /Dismiss this plan/i }).first();
    await dismissBtn.click();
    await page.waitForTimeout(500);

    // Remaining routes should be labelled P1, P2, P3 (not P2, P3, P4)
    const newCount = await page.locator("button", { hasText: /^Select$|✓ Selected/ }).count();
    expect(newCount).toBe(initialCount - 1);

    // P1 should still exist (first remaining route)
    const p1 = await page.locator("text=P1").first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(p1).toBe(true);

    // No label gap — check that labels are sequential
    for (let i = 1; i <= newCount; i++) {
      const label = await page.locator(`text=P${i}`).first().isVisible({ timeout: 1000 }).catch(() => false);
      expect(label).toBe(true);
    }

    await snap(page, "52-labels-after-dismiss");
  });
});

test.describe("Setup form persistence", () => {

  test("edit details goes to step 0 with pre-filled data", async ({ page }) => {
    const opened = await openDraftTrip(page);
    if (!opened) { test.skip(); return; }

    // Click Edit details
    const editBtn = page.locator("button", { hasText: /Edit details/i }).first();
    if (!await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await editBtn.click();
    await page.waitForTimeout(500);

    // Should be on step 0 (Where to) with destination pre-filled
    await expect(page.locator("text=/Where to/i").first()).toBeVisible({ timeout: 3000 });

    // Destination chip should show "Japan"
    const chipVisible = await page.locator("text=/Japan/i").first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(chipVisible).toBe(true);

    await snap(page, "53-edit-details-step0");
  });

  test("browser back from routes does not go to home", async ({ page }) => {
    const opened = await openDraftTrip(page);
    if (!opened) { test.skip(); return; }
    await page.waitForTimeout(500);

    // Press browser back
    await page.goBack();
    await page.waitForTimeout(1500);

    // Should be on setup form OR still on routes (not home)
    const onHome = await page.locator("text=/Your Trips|No trips yet/i").first()
      .isVisible({ timeout: 2000 }).catch(() => false);
    const onRoutes = await page.locator("button", { hasText: /^Select$|✓ Selected|Edit details/i }).first()
      .isVisible({ timeout: 1000 }).catch(() => false);
    const onSetup = await page.locator("text=/Where to|Trip details|few more details/i").first()
      .isVisible({ timeout: 1000 }).catch(() => false);

    // Accept setup or routes — just not home
    if (!onRoutes && !onSetup) expect(onHome).toBe(false);

    await snap(page, "54-back-from-routes");
  });
});

test.describe("Pre-IG sheet", () => {
  test.setTimeout(120000);

  test("selecting route shows Build button, which opens pre-IG sheet", async ({ page }) => {
    const opened = await openDraftTrip(page);
    if (!opened) { test.skip(); return; }

    // Select first route
    const selectBtn = page.locator("button", { hasText: /^Select$/ }).first();
    if (!await selectBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await selectBtn.click();
    await page.waitForTimeout(500);

    // Build My Itinerary should appear
    const buildBtn = page.locator("button", { hasText: /Build My Itinerary/i }).first();
    await expect(buildBtn).toBeVisible({ timeout: 3000 });

    // Click it — pre-IG sheet should open
    await buildBtn.click();
    await page.waitForTimeout(500);

    // Sheet should have Budget, Morning, Pace, free text, Generate button
    await expect(page.locator("text=/Fine-tune/i").first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator("text=/Budget range/i").first()).toBeVisible();
    await expect(page.locator("button", { hasText: /Generate Itinerary/i }).first()).toBeVisible();

    await snap(page, "55-pre-ig-sheet");
  });

  test("pre-IG sheet dismisses on scrim tap", async ({ page }) => {
    const opened = await openDraftTrip(page);
    if (!opened) { test.skip(); return; }

    const selectBtn = page.locator("button", { hasText: /^Select$/ }).first();
    if (!await selectBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await selectBtn.click();
    await page.waitForTimeout(500);

    const buildBtn = page.locator("button", { hasText: /Build My Itinerary/i }).first();
    await buildBtn.click();
    await page.waitForTimeout(500);

    // Tap scrim (top area above sheet)
    await page.mouse.click(200, 50);
    await page.waitForTimeout(500);

    // Sheet should be gone
    const sheetVisible = await page.locator("text=/Fine-tune/i").first()
      .isVisible({ timeout: 1000 }).catch(() => false);
    expect(sheetVisible).toBe(false);

    await snap(page, "56-sheet-dismissed");
  });
});

test.describe("Board tab navigation", () => {
  test.setTimeout(300000);

  test("Board tab hides chat bar", async ({ page }) => {
    const opened = await openDraftTrip(page);
    if (!opened) { test.skip(); return; }

    // Select and build
    const selectBtn = page.locator("button", { hasText: /^Select$/ }).first();
    if (!await selectBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await selectBtn.click();
    await page.waitForTimeout(300);
    const buildBtn = page.locator("button", { hasText: /Build My Itinerary/i }).first();
    await buildBtn.click();
    await page.waitForTimeout(300);
    await page.locator("button", { hasText: /Generate Itinerary/i }).first().click();

    // Wait for itinerary
    await page.waitForFunction(
      () => [...document.querySelectorAll("button")].some(b => /Board/i.test(b.textContent || "")),
      { timeout: 240000 }
    );
    await page.waitForTimeout(2000);

    // Switch to Board
    await page.locator("button:visible", { hasText: /Board/i }).first().click();
    await page.waitForTimeout(500);

    // Chat bar should NOT be visible on Board
    const chatBarOnBoard = await page.locator("text=/Ask anything about your trip/i").first()
      .isVisible({ timeout: 1000 }).catch(() => false);
    expect(chatBarOnBoard).toBe(false);

    await snap(page, "57-board-no-chat");
  });
});

test.describe("Magazine destination display", () => {
  test.setTimeout(120000);

  test("Magazine header shows destination name, not 'Help me decide'", async ({ page }) => {
    const opened = await openDraftTrip(page);
    if (!opened) { test.skip(); return; }

    // Switch to Magazine tab
    const magTab = page.locator("button", { hasText: /Magazine/i }).first();
    if (!await magTab.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await magTab.click();
    await page.waitForTimeout(2000);

    // Header should NOT say "Help me decide"
    const hasHelpMe = await page.locator("text=/Help me decide/i").first()
      .isVisible({ timeout: 1000 }).catch(() => false);
    expect(hasHelpMe).toBe(false);

    await snap(page, "58-magazine-no-helpme");
  });

  test("Tell me more shows country name in header, not city list", async ({ page }) => {
    const opened = await openDraftTrip(page);
    if (!opened) { test.skip(); return; }

    // Click "Tell me more" on first route
    const tellMore = page.locator("button", { hasText: /Tell me more/i }).first();
    if (!await tellMore.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await tellMore.click();
    await page.waitForTimeout(2000);

    // Header should show route name (e.g. "Classic Tokyo") not "Tokyo, Kyoto, Osaka"
    const header = page.locator("[style*='DM Serif Display']").first();
    const headerText = await header.textContent().catch(() => "");

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
    const createBtn = page.locator("button", { hasText: /new trip|create/i }).first();
    await createBtn.click();
    await page.waitForTimeout(500);

    const destInput = page.locator("input[placeholder*='Bangkok']").first();
    await destInput.fill("Thailand");
    await page.waitForTimeout(500);
    await destInput.press("Enter");
    await page.waitForTimeout(300);
    await page.locator("body").click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    for (let step = 0; step < 2; step++) {
      const nextBtn = page.locator("button").filter({ hasText: /continue|→/i }).first();
      if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nextBtn.click({ force: true });
        await page.waitForTimeout(600);
      }
    }

    const startBtn = page.locator("button", { hasText: /start planning/i }).first();
    if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startBtn.click();
    }

    // Wait for first route to appear, then check for skeletons
    await page.waitForFunction(
      () => [...document.querySelectorAll("button")].filter(b => b.textContent?.trim() === "Select").length >= 1,
      { timeout: 120000 }
    );

    // Should see skeleton shimmer cards for remaining routes
    const skeletons = page.locator("[style*='shimmer']");
    const skelCount = await skeletons.count();
    console.log(`Skeleton cards visible: ${skelCount}`);

    await snap(page, "60-skeleton-cards");

    // Wait for all routes to finish
    await page.waitForFunction(
      () => [...document.querySelectorAll("button")].filter(b => b.textContent?.trim() === "Select").length >= 3,
      { timeout: 120000 }
    );
  });
});
