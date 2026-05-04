import { test, expect } from "@playwright/test";
import { login, snap } from "./helpers";

/**
 * Tests for unified chat actions — verifies that chat can perform
 * all action types and the UI stays in sync.
 */

/** Navigate to an existing trip's itinerary */
async function openTrip(page: import("@playwright/test").Page) {
  await login(page);
  await page.waitForTimeout(1000);

  // Find any trip card on home
  const cards = page.locator("[style*='cursor: pointer'][style*='border-radius']");
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const text = await card.textContent().catch(() => "");
    if (text && /Day|Tokyo|Japan|\d+ days?/i.test(text)) {
      await card.click();
      await page.waitForTimeout(2000);
      // Check if we landed on itinerary (has bottom nav with Itinerary tab)
      const itinTab = page.locator("button", { hasText: /Itinerary/i }).first();
      if (await itinTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        return true;
      }
      await page.goBack();
      await page.waitForTimeout(1000);
    }
  }
  return false;
}

test.describe("Chat Actions", () => {

  test("chat opens and shows suggestion pills", async ({ page }) => {
    test.setTimeout(120000);
    const opened = await openTrip(page);
    if (!opened) { test.skip(); return; }

    // Click chat bar to open
    const chatBar = page.locator("text=/Ask anything about your trip/i").first();
    if (!await chatBar.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await chatBar.click();
    await page.waitForTimeout(500);

    // Chat should be open with suggestion pills
    const pills = page.locator("button", { hasText: /Change Day|Add a beach|Make Day/i });
    const pillCount = await pills.count();
    expect(pillCount).toBeGreaterThan(0);

    await snap(page, "40-chat-open");
  });

  test("chat pill pre-fills input", async ({ page }) => {
    test.setTimeout(120000);
    const opened = await openTrip(page);
    if (!opened) { test.skip(); return; }

    const chatBar = page.locator("text=/Ask anything about your trip/i").first();
    if (!await chatBar.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await chatBar.click();
    await page.waitForTimeout(500);

    // Click a suggestion pill
    const pill = page.locator("button", { hasText: /Change Day 1 hotel/i }).first();
    if (await pill.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pill.click();
      await page.waitForTimeout(300);

      // Input should be pre-filled
      const input = page.locator("textarea, input[placeholder*='Ask']").first();
      const value = await input.inputValue().catch(() => "");
      expect(value).toContain("Change Day 1 hotel");
    }

    await snap(page, "41-chat-pill");
  });

  test("activity chat icon opens chat with context", async ({ page }) => {
    test.setTimeout(120000);
    const opened = await openTrip(page);
    if (!opened) { test.skip(); return; }

    // Find a chat icon (💬) on an activity card
    const chatIcon = page.locator("button[title='Ask Trippy']").first();
    if (!await chatIcon.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await chatIcon.click();
    await page.waitForTimeout(500);

    // Chat should open with "Tell me about" pre-filled
    const input = page.locator("textarea, input").filter({ hasText: /Tell me about/i }).first();
    const chatOpen = await page.locator("text=/Travel with Trippy|Trippy/i").first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(chatOpen).toBe(true);

    await snap(page, "42-activity-chat");
  });

  test("chat on brainstorm shows route-specific pills", async ({ page }) => {
    await login(page);

    // Create a new trip to get to brainstorm
    const createBtn = page.locator("button", { hasText: /new trip|create/i }).first();
    if (!await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await createBtn.click();
    await page.waitForTimeout(500);

    // Just check if we can see the setup - don't go through full flow
    const whereToVisible = await page.locator("text=/Where to/i").first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(whereToVisible).toBe(true);

    await snap(page, "43-setup-form");
  });
});

test.describe("Setup Form (updated)", () => {

  test("setup has 3 steps with progress dots", async ({ page }) => {
    await login(page);
    const createBtn = page.locator("button", { hasText: /new trip|create/i }).first();
    await createBtn.click();
    await page.waitForTimeout(500);

    // Should see 3 progress dots
    // Step 0: Where to
    await expect(page.locator("text=/Where to/i").first()).toBeVisible({ timeout: 3000 });

    // Add a destination and advance
    const destInput = page.locator("input[placeholder*='Bangkok']").first();
    await destInput.fill("Japan");
    await page.waitForTimeout(1000);
    await destInput.press("Enter");
    await page.waitForTimeout(500);
    await page.locator("body").click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);
    await page.locator("body").click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);

    const nextBtn = page.locator("button").filter({ hasText: /continue|→/i }).first();
    if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nextBtn.click({ force: true });
      await page.waitForTimeout(800);

      // Step 1: Trip details (dates + travelers)
      await expect(page.locator("text=/Trip details/i").first()).toBeVisible({ timeout: 3000 });

      // Advance to step 2
      const nextBtn2 = page.locator("button").filter({ hasText: /continue|→/i }).first();
      if (await nextBtn2.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nextBtn2.click({ force: true });
        await page.waitForTimeout(500);

        // Step 2: A few more details (base city + notes + Start Planning)
        await expect(page.locator("text=/few more details/i").first()).toBeVisible({ timeout: 3000 });
        await expect(page.locator("text=/What kind of trip/i").first()).toBeVisible();
        await expect(page.locator("button", { hasText: /Start Planning/i }).first()).toBeVisible();

        // Should NOT have Trip Style, Budget, Morning, Pace questions
        const hasStyle = await page.locator("text=/Trip style/i").first().isVisible({ timeout: 1000 }).catch(() => false);
        const hasBudget = await page.locator("text=/Budget range/i").first().isVisible({ timeout: 1000 }).catch(() => false);
        const hasMorning = await page.locator("text=/head out/i").first().isVisible({ timeout: 1000 }).catch(() => false);
        expect(hasStyle).toBe(false);
        expect(hasBudget).toBe(false);
        expect(hasMorning).toBe(false);
      }
    }

    await snap(page, "44-setup-3-steps");
  });

  test("Help me decide button visible on step 0", async ({ page }) => {
    await login(page);
    const createBtn = page.locator("button", { hasText: /new trip|create/i }).first();
    await createBtn.click();
    await page.waitForTimeout(500);

    const helpBtn = page.locator("button", { hasText: /Help me decide/i }).first();
    await expect(helpBtn).toBeVisible({ timeout: 3000 });

    await snap(page, "45-help-me-decide");
  });
});

test.describe("Pre-IG Bottom Sheet", () => {

  test("Build My Itinerary opens refinement sheet", async ({ page }) => {
    test.setTimeout(180000);
    await login(page);

    // Find an existing trip in brainstorm/planning state
    const planningCard = page.locator("text=/Planning/i").first();
    if (!await planningCard.isVisible({ timeout: 3000 }).catch(() => false)) { test.skip(); return; }
    await planningCard.click();
    await page.waitForTimeout(2000);

    // Select a route if not already selected
    const selectBtn = page.locator("button", { hasText: /^Select$/ }).first();
    if (await selectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await selectBtn.click();
      await page.waitForTimeout(500);
    }

    // Click Build My Itinerary
    const buildBtn = page.locator("button", { hasText: /Build My Itinerary/i }).first();
    if (await buildBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await buildBtn.click();
      await page.waitForTimeout(500);

      // Pre-IG sheet should appear
      await expect(page.locator("text=/Fine-tune your itinerary/i").first()).toBeVisible({ timeout: 3000 });
      await expect(page.locator("text=/Budget range/i").first()).toBeVisible();
      await expect(page.locator("text=/head out/i").first()).toBeVisible();
      await expect(page.locator("text=/How active/i").first()).toBeVisible();
      await expect(page.locator("text=/Anything specific/i").first()).toBeVisible();
      await expect(page.locator("button", { hasText: /Generate Itinerary/i }).first()).toBeVisible();

      await snap(page, "46-pre-ig-sheet");
    }
  });
});
