import { test, expect } from "@playwright/test";
import { login, snap } from "./helpers";

test.describe("Plans (RG) flow", () => {
  test("generates exactly 4 plans", async ({ page }) => {
    test.setTimeout(180000); // 3 min — RG can take time
    await login(page);

    // Create new trip
    const createBtn = page.locator("button", { hasText: /new trip|create/i }).first();
    await createBtn.click();
    await expect(page.locator("text=/Where to/i").first()).toBeVisible({ timeout: 5000 });

    // Step 0: Add destination
    const destInput = page.locator("input[placeholder*='Bangkok']").first();
    await destInput.fill("Japan");
    await page.waitForTimeout(1500);
    // Pick from suggestions or press Enter
    const suggestion = page.locator("[style*='cursor: pointer'][style*='font-weight']", { hasText: /Japan/i }).first();
    if (await suggestion.isVisible({ timeout: 2000 }).catch(() => false)) {
      await suggestion.click();
    } else {
      await destInput.press("Enter");
    }
    await page.waitForTimeout(500);

    // Click the bottom-right Next/arrow button to advance through steps 0→1→2→3
    for (let step = 0; step < 3; step++) {
      // The "Next →" or step-advance button
      const stepBtns = page.locator("button").filter({ hasText: /next|→/i });
      const visibleBtn = stepBtns.first();
      if (await visibleBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await visibleBtn.click();
        await page.waitForTimeout(800);
      }
    }

    // Click Start Planning
    const startBtn = page.locator("button", { hasText: /start planning/i }).first();
    await expect(startBtn).toBeVisible({ timeout: 5000 });
    await startBtn.click();

    // Wait for all 4 plan cards to appear (Select buttons)
    await page.waitForFunction(
      () => [...document.querySelectorAll("button")].filter(b => b.textContent?.trim() === "Select").length >= 4,
      { timeout: 120000 }
    );
    await page.waitForTimeout(1000); // settle

    const selectBtns = page.locator("button", { hasText: /^Select$/ });
    const count = await selectBtns.count();

    await snap(page, "04-plans");
    expect(count).toBe(4);
  });

  test("select and dismiss work", async ({ page }) => {
    await login(page);

    // Find a draft trip
    const tripCard = page.locator("text=/Planning/i").first();
    if (!await tripCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip();
      return;
    }
    await tripCard.click();
    await page.waitForTimeout(2000);

    // Count initial Select buttons
    const initialCount = await page.locator("button", { hasText: /^Select$/ }).count();
    if (initialCount === 0) { test.skip(); return; }

    // Click Select on first plan
    const selectBtn = page.locator("button", { hasText: /^Select$/ }).first();
    await selectBtn.click();
    await page.waitForTimeout(300);

    // Should show "✓ Selected"
    await expect(page.locator("button", { hasText: /Selected/ }).first()).toBeVisible();

    // Dismiss first plan
    const dismissBtn = page.locator("button", { hasText: /dismiss this plan/i }).first();
    await dismissBtn.click();
    await page.waitForTimeout(500);

    // Count should decrease by 1
    const newCount = await page.locator("button", { hasText: /^Select$|Selected/ }).count();
    expect(newCount).toBe(initialCount - 1);

    await snap(page, "05-select-dismiss");
  });
});
