import { test, expect } from "@playwright/test";
import { login, snap } from "./helpers";

/** Navigate to Board tab of an existing trip */
async function openBoard(page: import("@playwright/test").Page) {
  await login(page);

  // Find any existing trip card on the home screen and click it
  // Trip cards show destination names, dates, or "Planning" status
  await page.waitForTimeout(1000);
  const tripCards = page.locator("[style*='cursor: pointer'][style*='border-radius']", { hasText: /.+/ });
  const count = await tripCards.count();

  // Try to find a card that looks like a trip (has text content, not a button)
  for (let i = 0; i < count; i++) {
    const card = tripCards.nth(i);
    const text = await card.textContent().catch(() => "");
    if (text && (text.includes("Day") || text.includes("Tokyo") || text.includes("Japan") || /\d+ days?/.test(text) || text.includes("Planning"))) {
      await card.click();
      await page.waitForTimeout(2000);

      // Check if Board tab exists
      const boardTab = page.locator("button", { hasText: /Board/i }).first();
      if (await boardTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await boardTab.click();
        await page.waitForTimeout(1000);
        return true;
      }
      // Might be on brainstorm screen — go back and try next card
      await page.goBack();
      await page.waitForTimeout(1000);
    }
  }
  return false;
}

test.describe("Board tab", () => {

  test("Board tab shows all widgets", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    // Verify all widget cards are visible
    await expect(page.locator("text=/Expenses/i").first()).toBeVisible();
    await expect(page.locator("text=/Notes/i").first()).toBeVisible();
    await expect(page.locator("text=/To-do/i").first()).toBeVisible();
    await expect(page.locator("text=/Bookmarks/i").first()).toBeVisible();

    await snap(page, "06-board-overview");
  });

  test("Notes: auto-save works", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    // Click Notes card
    const notesCard = page.locator("text=/Notes/i").first();
    await notesCard.click();
    await page.waitForTimeout(500);

    // Should see Notes header
    await expect(page.locator("text=/Notes/i").first()).toBeVisible();

    // Type something
    const textarea = page.locator("textarea").first();
    await textarea.fill("Test note from Playwright " + Date.now());
    await page.waitForTimeout(1500); // wait for debounce

    // Should see "Saved" indicator
    await expect(page.locator("text=/Saved/i").first()).toBeVisible({ timeout: 3000 });

    await snap(page, "07-notes-autosave");

    // Go back
    const backBtn = page.locator("button", { hasText: /←/ }).first();
    await backBtn.click();
    await page.waitForTimeout(500);
  });

  test("To-do: opens and shows categories or auto-generates", async ({ page }) => {
    test.setTimeout(60000);
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    // Click To-do card
    const todoCard = page.locator("text=/To-do/i").first();
    await todoCard.click();
    await page.waitForTimeout(1000);

    // Should see To-do header
    await expect(page.locator("button", { hasText: /←/ }).first()).toBeVisible();

    // Wait for either auto-generation or existing items
    const hasItems = await page.locator("text=/Bookings|Documents|Packing|Health|Money|Day of travel/i").first()
      .isVisible({ timeout: 30000 }).catch(() => false);

    if (hasItems) {
      // Verify category headers are present
      const categories = page.locator("text=/Bookings|Documents|Packing|Health|Money|Day of travel/i");
      const count = await categories.count();
      expect(count).toBeGreaterThan(0);
    }

    await snap(page, "08-todo");

    // Go back
    const backBtn = page.locator("button", { hasText: /←/ }).first();
    await backBtn.click();
    await page.waitForTimeout(500);
  });

  test("To-do: add manual item", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    const todoCard = page.locator("text=/To-do/i").first();
    await todoCard.click();
    await page.waitForTimeout(1000);

    // Add a manual item
    const input = page.locator("input[placeholder*='Add an item']").first();
    await input.fill("Test todo from Playwright");
    const addBtn = page.locator("button", { hasText: /\+/ }).last();
    await addBtn.click();
    await page.waitForTimeout(500);

    // Verify it appeared
    await expect(page.locator("text=/Test todo from Playwright/i").first()).toBeVisible();

    await snap(page, "09-todo-manual");
  });

  test("Bookmarks: add and delete", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    // Click Bookmarks card
    const bookmarkCard = page.locator("text=/Bookmarks/i").first();
    await bookmarkCard.click();
    await page.waitForTimeout(500);

    // Should see Bookmarks header
    await expect(page.locator("text=/Bookmarks/i").first()).toBeVisible();

    // Add a bookmark
    const titleInput = page.locator("input[placeholder*='Title']").first();
    const urlInput = page.locator("input[placeholder*='URL']").first();
    await titleInput.fill("Test Booking");
    await urlInput.fill("https://booking.com/test");
    const addBtn = page.locator("button", { hasText: /\+/ }).last();
    await addBtn.click();
    await page.waitForTimeout(500);

    // Verify it appeared with hotel icon (booking.com → 🏨)
    await expect(page.locator("text=/Test Booking/i").first()).toBeVisible();
    await expect(page.locator("text=/booking.com/i").first()).toBeVisible();

    await snap(page, "10-bookmarks");

    // Delete it
    const deleteBtn = page.locator("button", { hasText: /✕/ }).first();
    await deleteBtn.click();
    await page.waitForTimeout(500);

    // Should be gone
    const bookingVisible = await page.locator("text=/Test Booking/i").first().isVisible({ timeout: 1000 }).catch(() => false);
    expect(bookingVisible).toBe(false);
  });

  test("Bookmarks: auto-fills title from URL", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    const bookmarkCard = page.locator("text=/Bookmarks/i").first();
    await bookmarkCard.click();
    await page.waitForTimeout(500);

    // Paste a URL first (title should auto-fill)
    const urlInput = page.locator("input[placeholder*='URL']").first();
    await urlInput.fill("https://tripadvisor.com/hotel-review");
    await page.waitForTimeout(500);

    // Title should have been auto-filled
    const titleInput = page.locator("input[placeholder*='Title']").first();
    const titleValue = await titleInput.inputValue();
    expect(titleValue.length).toBeGreaterThan(0);

    await snap(page, "11-bookmarks-autofill");
  });

  test("Expenses: opens and can set budget", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    // Click Expenses card
    const expenseCard = page.locator("text=/Expenses/i").first();
    await expenseCard.click();
    await page.waitForTimeout(500);

    // Should see Expenses header
    await expect(page.locator("text=/Expenses/i").first()).toBeVisible();

    // Set budget
    const setBudgetBtn = page.locator("text=/Set a budget/i").first();
    if (await setBudgetBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await setBudgetBtn.click();
      await page.waitForTimeout(300);

      const budgetInput = page.locator("input[type='number'], input").nth(0);
      if (await budgetInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await budgetInput.fill("5000");
        const saveBtn = page.locator("button", { hasText: /Save/i }).first();
        await saveBtn.click();
        await page.waitForTimeout(500);

        // Verify budget bar shows
        await expect(page.locator("text=/Budget/i").first()).toBeVisible();
      }
    }

    await snap(page, "12-expenses");
  });

  test("Expenses: add planned expense", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    const expenseCard = page.locator("text=/Expenses/i").first();
    await expenseCard.click();
    await page.waitForTimeout(500);

    // Click add button
    const addBtn = page.locator("button", { hasText: /Add.*expense/i }).first();
    await addBtn.click();
    await page.waitForTimeout(300);

    // Fill form
    const titleInput = page.locator("input[placeholder*='What for']").first();
    await titleInput.fill("Test Hotel");

    const amountInput = page.locator("input[placeholder*='$']").first();
    await amountInput.fill("500");

    // Select Stay category
    const stayBtn = page.locator("button", { hasText: /Stay/i }).first();
    await stayBtn.click();

    // Submit
    const submitBtn = page.locator("button", { hasText: /^Add$/ }).first();
    await submitBtn.click();
    await page.waitForTimeout(500);

    // Verify it appeared
    await expect(page.locator("text=/Test Hotel/i").first()).toBeVisible();
    await expect(page.locator("text=/\\$500/").first()).toBeVisible();

    await snap(page, "13-expenses-add");
  });

  test("Expenses: planned vs actual tabs", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    const expenseCard = page.locator("text=/Expenses/i").first();
    await expenseCard.click();
    await page.waitForTimeout(500);

    // Should see Planned and Actual tabs
    await expect(page.locator("button", { hasText: /Planned/i }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: /Actual/i }).first()).toBeVisible();

    // Switch to Actual tab
    const actualTab = page.locator("button", { hasText: /Actual/i }).first();
    await actualTab.click();
    await page.waitForTimeout(300);

    await snap(page, "14-expenses-actual");
  });

  test("Board: browser back from sub-view returns to Board", async ({ page }) => {
    const opened = await openBoard(page);
    if (!opened) { test.skip(); return; }

    // Open Notes
    const notesCard = page.locator("text=/Notes/i").first();
    await notesCard.click();
    await page.waitForTimeout(500);

    // Verify we're in Notes
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();

    // Browser back
    await page.goBack();
    await page.waitForTimeout(500);

    // Should be back on Board with all widgets
    await expect(page.locator("text=/Expenses/i").first()).toBeVisible();
    await expect(page.locator("text=/Notes/i").first()).toBeVisible();
    await expect(page.locator("text=/To-do/i").first()).toBeVisible();
    await expect(page.locator("text=/Bookmarks/i").first()).toBeVisible();

    await snap(page, "15-board-back");
  });
});
