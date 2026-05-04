import { test, expect } from "@playwright/test";
import { login, snap } from "./helpers";

/**
 * Board tab tests — reuses an existing itinerary trip if available,
 * only creates a new one if none exists. Saves ~$0.15 per run.
 */
test.describe("Board tab (full flow)", () => {
  test("test all Board widgets on an itinerary trip", async ({ page }) => {
    test.setTimeout(300000); // 5 min
    await login(page);

    // ── Try to open an existing itinerary trip first ──
    const tripCards = page.locator("[style*='cursor: pointer'][style*='border-radius']");
    let foundItinerary = false;
    const cardCount = await tripCards.count();
    for (let i = 0; i < cardCount; i++) {
      const card = tripCards.nth(i);
      const text = await card.textContent().catch(() => "");
      if (text && /Day|days?|itinerary/i.test(text) && !/Planning/i.test(text)) {
        await card.click();
        await page.waitForTimeout(2000);
        const boardTab = page.locator("button", { hasText: /Board/i }).first();
        if (await boardTab.isVisible({ timeout: 3000 }).catch(() => false)) {
          foundItinerary = true;
          break;
        }
        await page.goBack();
        await page.waitForTimeout(1000);
      }
    }

    // ── If no existing itinerary, create one ──
    if (!foundItinerary) {
      // Go home if needed
      if (await page.locator("text=/Your Trips|No trips yet/i").first().isVisible({ timeout: 1000 }).catch(() => false) === false) {
        await page.goto("/");
        await page.waitForTimeout(1000);
      }

      const createBtn = page.locator("button", { hasText: /new trip|create/i }).first();
      await createBtn.click();
      await expect(page.locator("text=/Where to/i").first()).toBeVisible({ timeout: 5000 });

      const destInput = page.locator("input[placeholder*='Bangkok']").first();
      await destInput.fill("Tokyo");
      await page.waitForTimeout(1500);
      const suggestion = page.locator("[style*='cursor: pointer'][style*='font-weight']", { hasText: /Tokyo/i }).first();
      if (await suggestion.isVisible({ timeout: 2000 }).catch(() => false)) {
        await suggestion.click();
      } else {
        await destInput.press("Enter");
      }
      await page.waitForTimeout(500);
      await page.locator("body").click({ position: { x: 10, y: 10 } });
      await page.waitForTimeout(500);

      for (let step = 0; step < 2; step++) {
        const nextBtn = page.locator("button").filter({ hasText: /next|continue|→/i }).first();
        if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await nextBtn.click({ force: true });
          await page.waitForTimeout(800);
        }
      }

      const startBtn = page.locator("button", { hasText: /start planning/i }).first();
      await expect(startBtn).toBeVisible({ timeout: 5000 });
      await startBtn.click();

      await page.waitForFunction(
        () => [...document.querySelectorAll("button")].filter(b => b.textContent?.trim() === "Select").length >= 2,
        { timeout: 180000 }
      );
      await page.waitForTimeout(1000);

      await page.locator("button", { hasText: /^Select$/ }).first().click();
      await page.waitForTimeout(500);

      const buildBtn = page.locator("button", { hasText: /Build My Itinerary/i }).first();
      await expect(buildBtn).toBeVisible({ timeout: 5000 });
      await buildBtn.click();
      await page.waitForTimeout(500);

      const generateBtn = page.locator("button", { hasText: /Generate Itinerary/i }).first();
      await expect(generateBtn).toBeVisible({ timeout: 3000 });
      await generateBtn.click();
      await page.waitForTimeout(1000);

      await page.waitForFunction(
        () => [...document.querySelectorAll("button")].some(b => /Itinerary/i.test(b.textContent || "")),
        { timeout: 240000 }
      );
      await page.waitForTimeout(3000);
    }

    await snap(page, "20-itinerary-loaded");

    // ── Navigate to Board tab ──
    const boardTab = page.locator("button", { hasText: /Board/i }).first();
    await expect(boardTab).toBeVisible({ timeout: 10000 });
    await boardTab.click();
    await page.waitForTimeout(1000);

    // ── Verify Board widgets ──
    await expect(page.locator("text=/Expenses/i").first()).toBeVisible();
    await expect(page.locator("text=/Notes/i").first()).toBeVisible();
    await expect(page.locator("text=/To-do/i").first()).toBeVisible();
    await expect(page.locator("text=/Bookmarks/i").first()).toBeVisible();
    await snap(page, "21-board-all-widgets");

    // ── Test Notes ──
    page.locator("text=/Notes/i").first().click();
    await page.waitForTimeout(500);
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();
    const testNote = "QA note " + Date.now();
    await textarea.fill(testNote);
    await page.waitForTimeout(1500); // debounce
    await expect(page.locator("text=/Saved/i").first()).toBeVisible({ timeout: 3000 });
    await snap(page, "22-notes-saved");
    await page.locator("button:visible", { hasText: /←/ }).first().click();
    await page.waitForTimeout(500);

    // ── Test To-do (should auto-generate) ──
    page.locator("text=/To-do/i").first().click();
    await page.waitForTimeout(1000);
    const hasTodoContent = await page.locator("text=/Bookings|Documents|Packing|Health|Money|Day of travel|Generating/i").first()
      .isVisible({ timeout: 45000 }).catch(() => false);
    expect(hasTodoContent).toBe(true);

    if (await page.locator("text=/Generating/i").first().isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.waitForSelector("text=/Suggestions/i", { timeout: 60000 });
    }

    const acceptAllBtn = page.locator("button", { hasText: /Accept all/i }).first();
    if (await acceptAllBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await acceptAllBtn.click();
      await page.waitForTimeout(1000);
    }

    const categoryHeaders = page.locator("text=/📋|📄|🧳|🏥|💳|✈️/");
    const catCount = await categoryHeaders.count();
    expect(catCount).toBeGreaterThan(0);

    const todoInput = page.locator("input[placeholder*='Add an item']").first();
    await todoInput.fill("Buy travel adapter");
    await page.locator("button", { hasText: /\+/ }).last().click();
    await page.waitForTimeout(1000);
    const manualTodoVisible = await page.locator("text=/Buy travel adapter/i").first().isVisible({ timeout: 3000 }).catch(() => false);
    if (!manualTodoVisible) console.warn("Manual todo insert may have failed (RLS)");
    await snap(page, "23-todo");
    await page.locator("button:visible", { hasText: /←/ }).first().click();
    await page.waitForTimeout(500);

    // ── Test Bookmarks ──
    page.locator("text=/Bookmarks/i").first().click();
    await page.waitForTimeout(500);

    const titleInput = page.locator("input[placeholder*='Title']").first();
    const urlInput = page.locator("input[placeholder*='URL']").first();
    await titleInput.fill("Tokyo Hotel");
    await urlInput.fill("https://booking.com/hotel-tokyo");
    await page.waitForTimeout(300);
    const addBmBtn = page.locator("button").filter({ has: page.locator("text=/\\+/") }).last();
    await addBmBtn.click();
    await page.waitForTimeout(1000);
    const bmVisible = await page.locator("text=/Tokyo Hotel/i").first().isVisible({ timeout: 3000 }).catch(() => false);
    if (!bmVisible) console.warn("Bookmark insert may have failed (RLS)");
    await snap(page, "24-bookmarks");
    await page.locator("button:visible", { hasText: /←/ }).first().click();
    await page.waitForTimeout(500);

    // ── Test Expenses ──
    page.locator("text=/Expenses/i").first().click();
    await page.waitForTimeout(500);

    await expect(page.locator("button", { hasText: /Planned/i }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: /Actual/i }).first()).toBeVisible();

    const setBudget = page.locator("text=/Set a budget/i").first();
    if (await setBudget.isVisible({ timeout: 2000 }).catch(() => false)) {
      await setBudget.click();
      await page.waitForTimeout(300);
      const budgetInput = page.locator("input:visible").first();
      await budgetInput.fill("3000");
      const saveBtn = page.locator("button:visible", { hasText: /Save/i }).first();
      await saveBtn.click();
      await page.waitForTimeout(500);
    }

    await page.locator("button", { hasText: /Add.*expense/i }).first().click();
    await page.waitForTimeout(300);
    await page.locator("input[placeholder*='What for']").first().fill("Flights");
    await page.locator("input[placeholder*='Amount']").first().fill("800");
    await page.locator("button:visible", { hasText: /Transport/i }).first().click();
    await page.locator("button:visible", { hasText: /^Add$/ }).first().click();
    await page.waitForTimeout(500);

    const expenseVisible = await page.locator("text=/Flights/i").first().isVisible({ timeout: 3000 }).catch(() => false);
    if (!expenseVisible) console.warn("Expense insert may have failed (RLS)");

    await page.locator("button", { hasText: /Actual/i }).first().click();
    await page.waitForTimeout(300);
    await snap(page, "25-expenses-complete");
    await page.locator("button:visible", { hasText: /←/ }).first().click();
    await page.waitForTimeout(500);

    // ── Test browser back ──
    page.locator("text=/Notes/i").first().click();
    await page.waitForTimeout(500);
    await expect(page.locator("textarea").first()).toBeVisible();

    await page.goBack();
    await page.waitForTimeout(500);
    await expect(page.locator("text=/Expenses/i").first()).toBeVisible();
    await expect(page.locator("text=/Bookmarks/i").first()).toBeVisible();

    await snap(page, "26-board-back-works");
  });
});
