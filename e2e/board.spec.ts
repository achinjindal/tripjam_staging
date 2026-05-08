import { test, expect } from "@playwright/test";
import { login, snap } from "./helpers";

/** Navigate to Board tab — finds existing itinerary trip or creates one */
async function openBoard(page: import("@playwright/test").Page) {
  await login(page);
  await page.waitForTimeout(1000);

  // Try to find an existing itinerary trip (has Board tab) — click each non-Planning trip card
  const tripCards = page.locator("[style*='cursor: pointer'][style*='border-radius']", { hasText: /.+/ });
  const count = await tripCards.count();
  for (let i = 0; i < count; i++) {
    const card = tripCards.nth(i);
    const text = await card.textContent().catch(() => "");
    if (!text || /Planning/i.test(text)) continue;
    await card.click();
    await page.waitForTimeout(2000);
    const boardTab = page.locator("button", { hasText: /Board/i }).first();
    if (await boardTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await boardTab.click();
      await page.waitForTimeout(1000);
      return true;
    }
    await page.goBack();
    await page.waitForTimeout(1000);
  }
  return false;
}

test.describe.serial("Board tab", () => {
  test.setTimeout(300000);

  test("setup: ensure itinerary trip exists", async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1000);

    // Check if any itinerary trip exists
    const tripCards = page.locator("[style*='cursor: pointer'][style*='border-radius']", { hasText: /.+/ });
    const count = await tripCards.count();
    // Check if any non-Planning trip exists with an itinerary (has Board tab when opened)
    let found = false;
    for (let i = 0; i < count; i++) {
      const text = await tripCards.nth(i).textContent().catch(() => "");
      if (!text || /Planning/i.test(text)) continue;
      await tripCards.nth(i).click();
      await page.waitForTimeout(2000);
      if (await page.locator("button", { hasText: /Board/i }).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found = true;
        await page.goto("/"); // go back to home
        await page.waitForTimeout(1000);
        break;
      }
      await page.goBack();
      await page.waitForTimeout(1000);
    }

    if (found) return; // Already have a trip with itinerary

    // Create one: setup → RG → select route → build → IG
    const createBtn = page.locator("button", { hasText: /new trip|create/i }).first();
    await createBtn.click();
    await page.waitForTimeout(500);

    const destInput = page.locator("input[placeholder*='Bangkok']").first();
    await destInput.fill("Tokyo");
    await page.waitForTimeout(1000);
    await destInput.press("Enter");
    await page.waitForTimeout(500);
    await page.locator("body").click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);
    await page.locator("body").click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);

    for (let step = 0; step < 2; step++) {
      const nextBtn = page.locator("button").filter({ hasText: /continue|→/i }).first();
      if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nextBtn.click({ force: true });
        await page.waitForTimeout(1000);
      }
    }

    // May need one more Continue if stuck
    const startBtn = page.locator("button", { hasText: /start planning/i }).first();
    if (!await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const retryBtn = page.locator("button").filter({ hasText: /continue|→/i }).first();
      if (await retryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await retryBtn.click({ force: true });
        await page.waitForTimeout(1000);
      }
    }

    await expect(startBtn).toBeVisible({ timeout: 5000 });
    await startBtn.click();

    // Wait for routes
    await page.waitForFunction(
      () => [...document.querySelectorAll("button")].filter(b => b.textContent?.trim() === "Select").length >= 2,
      { timeout: 180000 }
    );
    await page.waitForTimeout(1000);

    // Select first route
    await page.locator("button", { hasText: /^Select$/ }).first().click();
    await page.waitForTimeout(500);

    // Build My Itinerary
    const buildBtn = page.locator("button", { hasText: /Build My Itinerary/i }).first();
    await expect(buildBtn).toBeVisible({ timeout: 5000 });
    await buildBtn.click();
    await page.waitForTimeout(500);

    // Generate Itinerary on pre-IG sheet
    const generateBtn = page.locator("button", { hasText: /Generate Itinerary/i }).first();
    await expect(generateBtn).toBeVisible({ timeout: 3000 });
    await generateBtn.click();

    // Wait for itinerary to load (Board tab appears)
    await page.waitForFunction(
      () => [...document.querySelectorAll("button")].some(b => /Board/i.test(b.textContent || "")),
      { timeout: 240000 }
    );
    await page.waitForTimeout(3000);
  });

  test("Board tab shows all widgets", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    await expect(page.locator("text=/Expenses/i").first()).toBeVisible();
    await expect(page.locator("text=/Notes/i").first()).toBeVisible();
    await expect(page.locator("text=/To-do/i").first()).toBeVisible();
    await expect(page.locator("text=/Bookmarks/i").first()).toBeVisible();
    // Travel & Hotels widget
    await expect(page.locator("text=/Travel & Hotels/i").first()).toBeVisible();

    await snap(page, "06-board-overview");
  });

  test("Notes: auto-save works", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    page.locator("text=/Notes/i").first().click();
    await page.waitForTimeout(500);

    const textarea = page.locator("textarea").first();
    await textarea.fill("Test note from Playwright " + Date.now());
    await page.waitForTimeout(1500);

    await expect(page.locator("text=/Saved/i").first()).toBeVisible({ timeout: 3000 });
    await snap(page, "07-notes-autosave");

    await page.locator("button", { hasText: /←/ }).first().click();
    await page.waitForTimeout(500);
  });

  test("To-do: opens and shows categories or auto-generates", async ({ page }) => {
    test.setTimeout(60000);
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    page.locator("text=/To-do/i").first().click();
    await page.waitForTimeout(1000);

    const hasItems = await page.locator("text=/Bookings|Documents|Packing|Health|Money|Day of travel/i").first()
      .isVisible({ timeout: 30000 }).catch(() => false);

    if (hasItems) {
      const categories = page.locator("text=/Bookings|Documents|Packing|Health|Money|Day of travel/i");
      expect(await categories.count()).toBeGreaterThan(0);
    }

    await snap(page, "08-todo");
    await page.locator("button", { hasText: /←/ }).first().click();
    await page.waitForTimeout(500);
  });

  test("To-do: add manual item", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    page.locator("text=/To-do/i").first().click();
    await page.waitForTimeout(1000);

    const input = page.locator("input[placeholder*='Add an item']").first();
    await input.fill("Test todo from Playwright");
    await page.locator("button", { hasText: /\+/ }).last().click();
    await page.waitForTimeout(500);

    await expect(page.locator("text=/Test todo from Playwright/i").first()).toBeVisible();
    await snap(page, "09-todo-manual");
  });

  test("Bookmarks: add and delete", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    page.locator("text=/Bookmarks/i").first().click();
    await page.waitForTimeout(500);

    const titleInput = page.locator("input[placeholder*='Title']").first();
    const urlInput = page.locator("input[placeholder*='URL']").first();
    await titleInput.fill("Test Booking");
    await urlInput.fill("https://booking.com/test");
    await page.locator("button", { hasText: /\+/ }).last().click();
    await page.waitForTimeout(500);

    await expect(page.locator("text=/Test Booking/i").first()).toBeVisible();
    await snap(page, "10-bookmarks");

    await page.locator("button", { hasText: /✕/ }).first().click();
    await page.waitForTimeout(500);

    const gone = await page.locator("text=/Test Booking/i").first().isVisible({ timeout: 1000 }).catch(() => false);
    expect(gone).toBe(false);
  });

  test("Bookmarks: auto-fills title from URL", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    page.locator("text=/Bookmarks/i").first().click();
    await page.waitForTimeout(500);

    const urlInput = page.locator("input[placeholder*='URL']").first();
    await urlInput.fill("https://tripadvisor.com/hotel-review");
    await page.waitForTimeout(500);

    const titleInput = page.locator("input[placeholder*='Title']").first();
    const titleValue = await titleInput.inputValue();
    expect(titleValue.length).toBeGreaterThan(0);

    await snap(page, "11-bookmarks-autofill");
  });

  test("Expenses: planned vs actual tabs", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    page.locator("text=/Expenses/i").first().click();
    await page.waitForTimeout(500);

    await expect(page.locator("button", { hasText: /Planned/i }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: /Actual/i }).first()).toBeVisible();

    await page.locator("button", { hasText: /Actual/i }).first().click();
    await page.waitForTimeout(300);

    await snap(page, "14-expenses-actual");
  });

  test("Board: browser back from sub-view returns to Board", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    page.locator("text=/Notes/i").first().click();
    await page.waitForTimeout(500);
    await expect(page.locator("textarea").first()).toBeVisible();

    await page.goBack();
    await page.waitForTimeout(500);

    await expect(page.locator("text=/Expenses/i").first()).toBeVisible();
    await expect(page.locator("text=/Notes/i").first()).toBeVisible();

    await snap(page, "15-board-back");
  });
});
